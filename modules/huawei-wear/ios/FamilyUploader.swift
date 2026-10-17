// Family monitoring, monitored side: builds the summary of the granted categories and `PUT`s it to `<baseUrl>/v1/family/ingest` with the device
// bearer token (docs/family-monitoring.md section 10).
//
// Two ways out, one set of rules:
//  - `uploadNow` (JS: `familyUploadNow`) sends in the foreground with a plain URLSession and answers with the outcome.
//  - `uploadAfterSync` runs after every watch sync of the background session (BackgroundController.cycle). It writes the body to a file in the
//    caches and hands that file to a background URLSession (`FamilyBackgroundUploading`), so the system finishes the upload even when iOS
//    suspends the app right after the sync. The answer comes back through `finish`, in this process or in the one iOS relaunches for it.
// The server's answer decides the outcome: 2xx is sent (the body is kept as the last payload), 401 and 403 are rejected (the token is revoked or
// no link is active: the config is dropped), anything else, or no answer, is failed and retried by the next sync.
// Not more than one request every 10 minutes unless forced, except when the watch synced again since the last request.
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// Sends a request that carries its body; the HTTP status, or nil when there was no answer (offline, timeout, TLS).
public typealias FamilySend = @Sendable (URLRequest) async -> Int?

/// How a transfer of the background session ended.
public enum FamilyTransfer: Equatable, Sendable {
    case status(Int)
    /// No answer was received.
    case failed
    /// Replaced by a newer upload, or dropped with the config; nothing to record.
    case cancelled
}

/// The system-managed upload queue: transfers continue while the app is suspended or not running. Implemented by FamilyBackgroundSession on
/// iOS; the logic tests use a fake.
public protocol FamilyBackgroundUploading: AnyObject, Sendable {
    /// Called with the name of the file given to `enqueue` (nil if the system lost it) when a transfer ends. Set before the first `enqueue` or `attach`.
    var onFinish: (@Sendable (_ file: String?, _ transfer: FamilyTransfer) -> Void)? { get set }
    /// Uploads `file` as the body of `request`. Transfers that are still pending are cancelled: the newer body supersedes them.
    func enqueue(_ request: URLRequest, file: URL)
    /// Cancels every pending transfer.
    func cancelPending()
    /// Reconnects to the session, so transfers that ended while the app was not running report their result.
    func attach()
}

/// The foreground request: an ephemeral session (nothing cached, no cookies) with short timeouts, since JS waits for the answer.
public enum FamilyNetwork {
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 40
        return URLSession(configuration: configuration)
    }()

    public static let send: FamilySend = { request in
        guard let (_, response) = try? await session.data(for: request) else { return nil }
        return (response as? HTTPURLResponse)?.statusCode
    }
}

public final class FamilyUploader: @unchecked Sendable {
    /// The shortest time between two requests when the watch did not sync in between.
    static let throttleMs: Int64 = 10 * 60_000
    static let ingestPath = "/v1/family/ingest"

    public let settings: FamilySettings
    private let store: SyncStore
    private let events: WearEvents
    private let battery: @Sendable () -> Int?
    private let send: FamilySend
    private let background: FamilyBackgroundUploading?
    private let directory: URL
    private let timeZone: TimeZone
    private let now: @Sendable () -> Date
    private let mutex = AsyncLock()

    /// `background` nil sends in the foreground there too. `directory` holds the bodies queued for the background session.
    public init(
        settings: FamilySettings, store: SyncStore, events: WearEvents, battery: @escaping @Sendable () -> Int?, send: @escaping FamilySend = FamilyNetwork.send,
        background: FamilyBackgroundUploading? = nil, directory: URL = FamilyUploader.defaultDirectory(), timeZone: TimeZone = .autoupdatingCurrent,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.settings = settings
        self.store = store
        self.events = events
        self.battery = battery
        self.send = send
        self.background = background
        self.directory = directory
        self.timeZone = timeZone
        self.now = now
        background?.onFinish = { [weak self] file, transfer in self?.finish(file: file, transfer: transfer) }
    }

    public static func defaultDirectory() -> URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("family-ingest", isDirectory: true)
    }

    // MARK: config

    /// `familyConfigure`: stores the config, or with nil drops it with the last result, the last payload and everything queued. Queued bodies are
    /// dropped on every change: a body built under the old scopes or token must not go out afterwards.
    public func configure(_ config: FamilyConfig?) {
        background?.cancelPending()
        removeBodies()
        if let config { settings.config = config } else { settings.clearAll() }
    }

    /// `familyUploadStatus`.
    public func status() -> [String: Any] {
        let config = settings.config
        return [
            "configured": config != nil,
            "enabled": config?.enabled ?? false,
            "last": settings.last?.toJS() ?? NSNull(),
            "lastPayload": settings.lastPayload ?? NSNull(),
        ]
    }

    /// Reconnects the background session when a config exists, so results of uploads that ended while the app was not running are recorded.
    public func attach() {
        if settings.config != nil { background?.attach() }
    }

    // MARK: uploads

    /// `familyUploadNow`: sends now, whatever the throttle says. Skipped when disabled, not configured or with nothing to send.
    public func uploadNow() async -> FamilyUploadResult {
        await mutex.withLock {
            let at = nowMs()
            switch prepare(force: true, at: at) {
            case .skip:
                return FamilyUploadResult(.skipped, at: at)
            case .failed(let result):
                return result
            case .ready(let ready):
                return await sendNow(ready, at: at)
            }
        }
    }

    /// After a stored watch sync: queues the upload on the background session, or sends it now when there is none. Throttled.
    public func uploadAfterSync() async {
        await mutex.withLock {
            let at = nowMs()
            guard case .ready(let ready) = prepare(force: false, at: at) else { return }
            guard let background else {
                _ = await sendNow(ready, at: at)
                return
            }
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let file = directory.appendingPathComponent("ingest-\(at).json")
                try ready.body.write(to: file, atomically: true, encoding: .utf8)
                background.enqueue(ready.request, file: file)
            } catch {
                events.error("Family upload not queued: \(error)")
                record(status: nil, body: nil, token: ready.token, at: at)
            }
        }
    }

    /// A transfer of the background session ended (here or in a process iOS relaunched for it).
    func finish(file name: String?, transfer: FamilyTransfer) {
        let file = name.map { directory.appendingPathComponent(URL(fileURLWithPath: $0).lastPathComponent) }
        defer {
            if let file { try? FileManager.default.removeItem(at: file) }
        }
        switch transfer {
        case .cancelled:
            return
        case .status(let status):
            record(status: status, body: file.flatMap { try? String(contentsOf: $0, encoding: .utf8) }, token: nil, at: nowMs())
        case .failed:
            record(status: nil, body: nil, token: nil, at: nowMs())
        }
    }

    // MARK: pieces

    private struct Ready {
        let token: String
        let request: URLRequest
        let body: String
    }

    private enum Prepared {
        case skip
        case failed(FamilyUploadResult)
        case ready(Ready)
    }

    /// The request for the current config and database, or why there is none. Marks the attempt for the throttle.
    private func prepare(force: Bool, at: Int64) -> Prepared {
        guard let config = settings.config, config.enabled else { return .skip }
        do {
            let payload = try FamilySummary.build(store: store, scopes: config.scopes, battery: battery(), timeZone: timeZone, now: now())
            guard payload.hasContent, FamilyUploader.isDue(force: force, attempt: settings.attempt, watchSyncAt: payload.watchSyncAt, nowMs: at) else {
                return .skip
            }
            guard let request = FamilyUploader.request(for: config) else {
                events.error("Family upload: '\(config.baseUrl)' is not a usable address")
                return .failed(record(status: nil, body: nil, token: config.token, at: at))
            }
            settings.attempt = FamilyAttempt(atMs: at, watchSyncAt: payload.watchSyncAt)
            return .ready(Ready(token: config.token, request: request, body: try payload.json()))
        } catch {
            events.error("Family summary not built: \(error)")
            return .failed(record(status: nil, body: nil, token: config.token, at: at))
        }
    }

    private func sendNow(_ ready: Ready, at: Int64) async -> FamilyUploadResult {
        var request = ready.request
        request.httpBody = Data(ready.body.utf8)
        return record(status: await send(request), body: ready.body, token: ready.token, at: at)
    }

    /// Keeps the answer of a request: the result, the payload when it was accepted, and the end of the config when it was rejected. `token` is the
    /// one the request was signed with (nil: unknown, the transfer was queued earlier); an answer to a token that is no longer the config's, or
    /// to a config that was cleared meanwhile, is returned but not kept.
    @discardableResult
    private func record(status: Int?, body: String?, token: String?, at: Int64) -> FamilyUploadResult {
        let outcome = FamilyUploader.outcome(status: status)
        let result = FamilyUploadResult(outcome, status: status, at: at)
        guard let config = settings.config, token == nil || token == config.token else { return result }
        settings.last = result
        if outcome == .sent, let body { settings.lastPayload = body }
        events.info("Family upload \(outcome.rawValue)" + (status.map { " (HTTP \($0))" } ?? ""))
        if outcome == .rejected {
            background?.cancelPending()
            removeBodies()
            settings.config = nil
        }
        return result
    }

    private func removeBodies() { try? FileManager.default.removeItem(at: directory) }

    private func nowMs() -> Int64 { Int64(now().timeIntervalSince1970 * 1000) }

    // MARK: rules

    /// Forced, or the watch synced since the last request, or the last request is 10 minutes old (or from the future: the clock moved back).
    static func isDue(force: Bool, attempt: FamilyAttempt?, watchSyncAt: Int64?, nowMs: Int64) -> Bool {
        guard !force, let attempt else { return true }
        return watchSyncAt != attempt.watchSyncAt || nowMs < attempt.atMs || nowMs - attempt.atMs >= throttleMs
    }

    static func outcome(status: Int?) -> FamilyUploadResult.Outcome {
        guard let status else { return .failed }
        if (200...299).contains(status) { return .sent }
        if status == 401 || status == 403 { return .rejected }
        return .failed
    }

    /// The signed request without a body: the foreground send sets it, the background session reads it from a file.
    static func request(for config: FamilyConfig) -> URLRequest? {
        guard let url = URL(string: config.baseUrl + ingestPath) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("JoyoFit", forHTTPHeaderField: "User-Agent")
        return request
    }
}

#endif

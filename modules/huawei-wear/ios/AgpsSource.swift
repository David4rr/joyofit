// Port of AgpsSource.kt and EphemerisDownload.kt: where the satellite data comes from (the public Broadcom LTO file; the watch maker's servers only
// when the user allowed them), the HTTP side (https only, bodies capped while they arrive, a plain GET with no credentials and no app
// identification) and the phone-side copies in the Caches directory.
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

/// The result of one fetch: files by the name the watch will ask for, or an `outcome` code and message saying why there are none.
public struct AgpsFetch: Sendable {
    public let files: [(name: String, data: Bytes)]
    public let source: String
    public let dataTimeMs: Int
    public let outcome: String
    public let message: String
    /// Served from the phone's copy: nothing new was downloaded, so the download time must not move.
    public let fromCache: Bool

    public init(files: [(name: String, data: Bytes)], source: String, dataTimeMs: Int, outcome: String, message: String, fromCache: Bool = false) {
        self.files = files
        self.source = source
        self.dataTimeMs = dataTimeMs
        self.outcome = outcome
        self.message = message
        self.fromCache = fromCache
    }

    public var ok: Bool { !files.isEmpty }
    public var totalSize: Int { files.reduce(0) { $0 + $1.data.count } }

    public static func failed(_ outcome: String, _ message: String) -> AgpsFetch {
        AgpsFetch(files: [], source: "", dataTimeMs: 0, outcome: outcome, message: message)
    }
}

/// Where the data comes from. Never throws for a failed download; the result says what went wrong.
public protocol AgpsSource: AnyObject, Sendable {
    /// `force` skips the phone-side copy and goes to the network.
    func fetch(_ consult: AgpsConsult, force: Bool) async -> AgpsFetch
}

public enum AgpsSources {
    public static let broadcom = "broadcom_lto"
    public static let huaweiAgnss = "huawei_agnss"
    public static let ltoFile = "gpslocation.dat"
    public static let agnssFile = "HW_AGNSS_RTCM_33"
}

/// A download the watch asked for failed (no network, HTTP error, unreadable body), or arrived as a file the watch may not be sent.
public struct AgpsFetchError: Error, CustomStringConvertible, Sendable {
    public enum Kind: Sendable { case failed, invalidFile, noNetwork }
    public let kind: Kind
    public let message: String

    public init(_ message: String, kind: Kind = .failed) {
        self.message = message
        self.kind = kind
    }

    public var description: String { message }
}

/// One HTTP body and the server's idea of when it was made (0 when it did not say).
public struct AgpsDownload: Sendable {
    public let body: Bytes
    public let lastModifiedMs: Int
}

/// The phone-side copies of downloads, by URL.
public protocol AgpsCache: AnyObject, Sendable {
    /// The cached body of `url` when it is younger than `maxAgeMs`.
    func read(_ url: String, maxAgeMs: Int) -> Bytes?
    func write(_ url: String, data: Bytes)
    func delete(_ url: String)
}

/// The real source: the public Broadcom LTO file for version 0; for the versions that name the watch maker's servers, those servers only when
/// the user allowed it (`AgpsStore.huaweiServers`), and then only the one kind that is a plain download.
public final class NetworkAgpsSource: AgpsSource, @unchecked Sendable {
    private static let huaweiAgnssBase = "https://geo-dra.platform.hicloud.com/"

    private let cache: AgpsCache
    private let store: AgpsStore
    private let log: @Sendable (String) -> Void
    private let logRaw: @Sendable (String) -> Void
    private let isOnline: @Sendable () -> Bool
    private let nowMs: @Sendable () -> Int
    private let httpGet: @Sendable (_ url: String, _ maxBytes: Int) async throws -> AgpsDownload

    public init(
        cache: AgpsCache, store: AgpsStore, log: @escaping @Sendable (String) -> Void, logRaw: @escaping @Sendable (String) -> Void,
        isOnline: @escaping @Sendable () -> Bool, nowMs: @escaping @Sendable () -> Int = { Int(Date().timeIntervalSince1970 * 1000) },
        httpGet: @escaping @Sendable (_ url: String, _ maxBytes: Int) async throws -> AgpsDownload = EphemerisNet.get
    ) {
        self.cache = cache
        self.store = store
        self.log = log
        self.logRaw = logRaw
        self.isOnline = isOnline
        self.nowMs = nowMs
        self.httpGet = httpGet
    }

    public func fetch(_ consult: AgpsConsult, force: Bool) async -> AgpsFetch {
        switch consult.version {
        case 0:
            return await fetchBroadcom(force: force)
        case 1, 2, 3:
            if !store.huaweiServers {
                return .failed(
                    AgpsOutcome.huaweiOff, "the watch asked for data from the watch maker's servers (version \(consult.version)); they are switched off"
                )
            }
            return await fetchHuawei(consult, force: force)
        default:
            return .failed(AgpsOutcome.unsupported, "download version \(consult.version) is not known")
        }
    }

    private struct Got {
        let body: Bytes
        let dataMs: Int
        let fromCache: Bool
    }

    /// The phone-side copy when it is young enough, else the network; saved for next time only when it passed `validate`.
    private func cachedGet(
        url: String, force: Bool, maxBytes: Int, source: String, label: String, unwrap: Bool, validate: (Bytes) -> String?
    ) async throws -> Got {
        if !force {
            let hit = cache.read(url, maxAgeMs: AgpsPolicy.cacheFreshMs)
            if let hit, validate(hit) == nil {
                log("\(label): from the phone's copy, \(hit.count) bytes")
                let cachedData = store.cachedDataMs
                let dataMs = (cachedData > 0 && store.cachedSource == source) ? cachedData : nowMs()
                return Got(body: hit, dataMs: dataMs, fromCache: true)
            }
            if hit != nil { cache.delete(url) }
        }
        if !isOnline() { throw AgpsFetchError("no network", kind: .noNetwork) }
        let started = nowMs()
        let download = try await httpGet(url, maxBytes)
        let body = try unwrap ? EphemerisNet.gunzipIfNeeded(download.body, maxBytes: maxBytes) : download.body
        if let problem = validate(body) { throw AgpsFetchError(problem, kind: .invalidFile) }
        log("\(label): downloaded \(body.count) bytes in \(nowMs() - started) ms")
        cache.write(url, data: body)
        return Got(body: body, dataMs: download.lastModifiedMs > 0 ? download.lastModifiedMs : nowMs(), fromCache: false)
    }

    private func fail(_ error: Error, _ label: String) -> AgpsFetch {
        if error is CancellationError { return .failed(AgpsOutcome.downloadFailed, "\(label): cancelled") }
        guard let e = error as? AgpsFetchError else { return .failed(AgpsOutcome.downloadFailed, "\(label): \(error)") }
        let outcome: String
        switch e.kind {
        case .invalidFile: outcome = AgpsOutcome.invalidFile
        case .noNetwork: outcome = AgpsOutcome.noNetwork
        case .failed: outcome = AgpsOutcome.downloadFailed
        }
        return .failed(outcome, "\(label): \(e.message)")
    }

    /// Version 0: always the fixed Broadcom address, whatever address the watch names. The file is `gpslocation.dat`.
    private func fetchBroadcom(force: Bool) async -> AgpsFetch {
        do {
            let got = try await cachedGet(
                url: EphemerisNet.ltoHost + EphemerisNet.ltoPath, force: force, maxBytes: AgpsPolicy.ltoMaxBytes, source: AgpsSources.broadcom,
                label: "LTO", unwrap: false, validate: AgpsPolicy.validateLto
            )
            return AgpsFetch(
                files: [(AgpsSources.ltoFile, got.body)], source: AgpsSources.broadcom, dataTimeMs: got.dataMs, outcome: AgpsOutcome.none, message: "",
                fromCache: got.fromCache
            )
        } catch {
            return fail(error, "LTO")
        }
    }

    /// The watch maker's servers, switched on by the user. Only the plain download kind (`HW_AGNSS`) is made; the other kinds need the maker's own
    /// decoder or an account and are declined. UNTESTED against the real server: the entry layout is `<path>/<TAG>`; the path is appended to
    /// `huaweiAgnssBase` and the answer is gunzipped when it is gzip.
    private func fetchHuawei(_ consult: AgpsConsult, force: Bool) async -> AgpsFetch {
        let entries = consult.tag.split(separator: ";", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        func lastSegment(_ entry: String) -> String { entry.lastIndex(of: "/").map { String(entry[entry.index(after: $0)...]) } ?? entry }
        guard let agnss = entries.first(where: { lastSegment($0) == "HW_AGNSS" }) else {
            let names = consult.tagNames
            return .failed(AgpsOutcome.unsupported, "the watch asked for \(names.isEmpty ? "nothing named" : names); only HW_AGNSS can be served")
        }
        // `substringBeforeLast('/', "")`: empty when the entry has no `/`; leading slashes dropped.
        var path = agnss.lastIndex(of: "/").map { String(agnss[..<$0]) } ?? ""
        while path.hasPrefix("/") { path.removeFirst() }
        if path.isEmpty { return .failed(AgpsOutcome.unsupported, "the HW_AGNSS entry has no path") }
        let url = NetworkAgpsSource.huaweiAgnssBase + path
        logRaw("HW_AGNSS url=\(url)")
        do {
            let got = try await cachedGet(
                url: url, force: force, maxBytes: AgpsPolicy.otherMaxBytes, source: AgpsSources.huaweiAgnss, label: "HW_AGNSS", unwrap: true,
                validate: AgpsPolicy.validateOther
            )
            return AgpsFetch(
                files: [(AgpsSources.agnssFile, got.body)], source: AgpsSources.huaweiAgnss, dataTimeMs: got.dataMs, outcome: AgpsOutcome.none,
                message: "", fromCache: got.fromCache
            )
        } catch {
            return fail(error, "HW_AGNSS")
        }
    }
}

/// The HTTP side of the satellite-data job. Only https, bodies capped by the caller while they arrive, a plain GET with no credentials, no cookies
/// and no app identification (the default `User-Agent` of URLSession names the app, so it is replaced).
public enum EphemerisNet {
    /// The public Broadcom LTO file (valid for 7 days) is what is downloaded unless the user allows the watch maker's servers.
    public static let ltoHost = "https://gllto.glpals.com"
    public static let ltoPath = "/7day/v6/latest/lto.dat"

    private static let readTimeoutSec: TimeInterval = 30
    private static let resourceTimeoutSec: TimeInterval = TimeInterval(AgpsPolicy.downloadTimeoutMs / 1000)

    public static func get(_ url: String, maxBytes: Int) async throws -> AgpsDownload {
        guard url.hasPrefix("https://") else { throw AgpsFetchError("refusing non-https url") }
        guard let target = URL(string: url) else { throw AgpsFetchError("bad url") }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = readTimeoutSec
        configuration.timeoutIntervalForResource = resourceTimeoutSec
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpAdditionalHeaders = ["User-Agent": "CFNetwork", "Accept": "*/*"]
        let transfer = CappedTransfer(maxBytes: maxBytes)
        let session = URLSession(configuration: configuration, delegate: transfer, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        var request = URLRequest(url: target)
        request.httpMethod = "GET"
        request.timeoutInterval = readTimeoutSec
        let task = session.dataTask(with: request)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<AgpsDownload, Error>) in
                transfer.start(continuation)
                if Task.isCancelled {
                    task.cancel()
                } else {
                    task.resume()
                }
            }
        } onCancel: {
            task.cancel()
        }
    }

    /// Collects one answer and gives up as soon as it is clearly too big.
    private final class CappedTransfer: NSObject, URLSessionDataDelegate, @unchecked Sendable {
        private let maxBytes: Int
        private let lock = NSLock()
        private var body = Data()
        private var status = 0
        private var lastModified = 0
        private var failure: AgpsFetchError?
        private var continuation: CheckedContinuation<AgpsDownload, Error>?
        private var finished = false

        init(maxBytes: Int) { self.maxBytes = maxBytes }

        func start(_ continuation: CheckedContinuation<AgpsDownload, Error>) { lock.locked { self.continuation = continuation } }

        private func fail(_ message: String) { lock.locked { if failure == nil { failure = AgpsFetchError(message) } } }

        func urlSession(
            _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
            completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
        ) {
            guard let http = response as? HTTPURLResponse else {
                fail("not an HTTP answer")
                completionHandler(.cancel)
                return
            }
            lock.locked {
                status = http.statusCode
                lastModified = EphemerisNet.parseHttpDate(http.value(forHTTPHeaderField: "Last-Modified")) ?? 0
            }
            if http.statusCode == 200 && http.expectedContentLength > Int64(maxBytes) {
                fail("response larger than \(maxBytes) bytes")
                completionHandler(.cancel)
                return
            }
            completionHandler(.allow)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            let tooBig: Bool = lock.locked {
                // An error page is read only far enough to quote its start.
                let limit = status == 200 ? maxBytes : 256
                if body.count + data.count > limit {
                    if status == 200 { return true }
                    body.append(data.prefix(limit - body.count))
                    return false
                }
                body.append(data)
                return false
            }
            if tooBig {
                fail("response larger than \(maxBytes) bytes")
                dataTask.cancel()
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            let outcome: (CheckedContinuation<AgpsDownload, Error>, Result<AgpsDownload, Error>)? = lock.locked {
                if finished { return nil }
                finished = true
                guard let continuation else { return nil }
                self.continuation = nil
                if let failure { return (continuation, .failure(failure)) }
                if let error {
                    if (error as? URLError)?.code == .cancelled { return (continuation, .failure(CancellationError())) }
                    return (continuation, .failure(AgpsFetchError("\(type(of: error)): \(error.localizedDescription)")))
                }
                if status != 200 {
                    let reason = String(String(decoding: body, as: UTF8.self).prefix(120)).trimmingCharacters(in: .whitespacesAndNewlines)
                    return (continuation, .failure(AgpsFetchError("HTTP \(status)\(reason.isEmpty ? "" : ": \(reason)")")))
                }
                return (continuation, .success(AgpsDownload(body: Bytes(body), lastModifiedMs: lastModified)))
            }
            if let (continuation, result) = outcome { continuation.resume(with: result) }
        }
    }

    /// An HTTP date (`Sun, 06 Nov 1994 08:49:37 GMT`) as unix milliseconds; nil when absent or unreadable.
    static func parseHttpDate(_ text: String?) -> Int? {
        guard let text else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
        guard let date = formatter.date(from: text.trimmingCharacters(in: .whitespaces)) else { return nil }
        return Int(date.timeIntervalSince1970 * 1000)
    }

    /// A body that starts with the gzip magic is unwrapped (capped, and its CRC and length checked); anything else is returned as it is.
    static func gunzipIfNeeded(_ data: Bytes, maxBytes: Int) throws -> Bytes {
        guard data.count >= 2, data[0] == 0x1F, data[1] == 0x8B else { return data }
        func broken(_ why: String) -> AgpsFetchError { AgpsFetchError("gunzip failed: \(why)") }
        guard data.count >= 18, data[2] == 8 else { throw broken("not a deflate gzip stream") }
        let flags = data[3]
        var position = 10
        if flags & 0x04 != 0 {
            guard position + 2 <= data.count else { throw broken("truncated header") }
            position += 2 + Int(data[position]) + Int(data[position + 1]) << 8
        }
        for bit: UInt8 in [0x08, 0x10] where flags & bit != 0 {
            while position < data.count && data[position] != 0 { position += 1 }
            position += 1
        }
        if flags & 0x02 != 0 { position += 2 }
        guard position < data.count else { throw broken("truncated header") }
        let inflated: (data: Bytes, end: Int)
        do {
            inflated = try Inflate.inflate(data, at: position, limit: maxBytes)
        } catch InflateError.tooLarge {
            throw AgpsFetchError("unzipped response larger than \(maxBytes) bytes")
        } catch {
            throw broken("\(error)")
        }
        guard inflated.end + 8 <= data.count else { throw broken("truncated trailer") }
        func le32(_ at: Int) -> UInt32 {
            UInt32(data[at]) | UInt32(data[at + 1]) << 8 | UInt32(data[at + 2]) << 16 | UInt32(data[at + 3]) << 24
        }
        guard le32(inflated.end) == CRC32.checksum(inflated.data) else { throw broken("CRC mismatch") }
        guard le32(inflated.end + 4) == UInt32(truncatingIfNeeded: inflated.data.count) else { throw broken("length mismatch") }
        return inflated.data
    }

    /// SHA-256 of the watch address without colons, lowercase hex: part of the stored file name the watch's protocol expects.
    public static func addressDigest(_ address: String) -> String {
        SHA256.hash(Array(address.replacingOccurrences(of: ":", with: "").utf8)).hexLower
    }
}

/// Downloads kept in the app's Caches directory so the watch's repeated requests (it asks again every ~20 s while it is locating) do not refetch.
/// Keyed by URL; the age is the file's modification time. iOS may delete the directory at any time: that only costs a refetch.
public final class EphemerisCache: AgpsCache, @unchecked Sendable {
    private static let pruneAgeMs = 24 * 60 * 60 * 1000
    private let directory: URL
    private let nowMs: @Sendable () -> Int

    public init(directory: URL = EphemerisCache.defaultDirectory(), nowMs: @escaping @Sendable () -> Int = { Int(Date().timeIntervalSince1970 * 1000) }) {
        self.directory = directory
        self.nowMs = nowMs
    }

    public static func defaultDirectory() -> URL {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        return caches.appendingPathComponent("agps", isDirectory: true)
    }

    private func file(_ url: String) -> URL {
        let key = String(SHA256.hash(Array(url.utf8)).hexLower.prefix(32))
        return directory.appendingPathComponent("\(key).bin")
    }

    public func read(_ url: String, maxAgeMs: Int) -> Bytes? {
        let target = file(url)
        guard let modified = (try? FileManager.default.attributesOfItem(atPath: target.path))?[.modificationDate] as? Date else { return nil }
        if nowMs() - Int(modified.timeIntervalSince1970 * 1000) > maxAgeMs { return nil }
        guard let data = try? Data(contentsOf: target), !data.isEmpty else { return nil }
        return Bytes(data)
    }

    public func write(_ url: String, data: Bytes) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data(data).write(to: file(url), options: .atomic)
            prune()
        } catch {
            // A cache that cannot be written only costs a refetch.
        }
    }

    public func delete(_ url: String) {
        try? FileManager.default.removeItem(at: file(url))
    }

    private func prune() {
        let cutoff = nowMs() - EphemerisCache.pruneAgeMs
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for name in names {
            let path = directory.appendingPathComponent(name).path
            guard let modified = (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date else { continue }
            if Int(modified.timeIntervalSince1970 * 1000) < cutoff { try? FileManager.default.removeItem(atPath: path) }
        }
    }
}

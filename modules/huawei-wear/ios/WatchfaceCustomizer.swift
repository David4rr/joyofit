// Editable watch-face configuration (`hw.app.watchface.custom` <-> `hw.watch.watchface.custom`, DataSync events 800100008 and 800100009).
// Port of WatchfaceCustomizer.kt. Huawei Health sends the query `{01 marketId}`; the watch answers, and also pushes, an 800100009 report with
// the face's current selections. Applying is the same 800100009 sent by the phone. The marketId is the face's id from the watch's face list
// (Huawei Health compares it with the 27/05 report's face id).
//
// The watch reports only the selected index of each option, not how many options exist: Huawei Health's own editor is an H5 page of the face
// that knows its option lists (`WatchFaceCallback.queryCustomConfig` just relays the watch's report to that page).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// What `WatchfaceCustomizer.apply` reports: what was sent, what the watch holds afterwards and where they differ.
public struct FaceApplyResult: Equatable, Sendable {
    /// The watch's configuration read back after the apply; nil when the read-back got no answer.
    public let config: FaceCustomization?
    /// The watch pushed its own report for the face right after the apply (Huawei Health's only ack).
    public let echoed: Bool
    /// Parts of the request that the read-back does not show; empty when everything stuck.
    public let mismatches: [String]
    public let message: String

    public var ok: Bool { config != nil && mismatches.isEmpty }

    /// `FaceApplyResult` in `HuaweiWearFaceCustom.types.ts`.
    public func toJS() -> [String: Any] {
        ["ok": ok, "echoed": echoed, "mismatches": mismatches, "message": message, "config": config.map { $0.toJS() as Any } ?? NSNull()]
    }
}

/// A value that arrives once; `wait` gives up after a timeout (or when the waiting task is cancelled) and returns nil.
final class TimedWait<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: T?
    private var continuation: CheckedContinuation<T?, Never>?
    private var timer: Task<Void, Never>?

    func complete(_ v: T) {
        let c: CheckedContinuation<T?, Never>? = lock.locked {
            if value != nil { return nil }
            value = v
            let c = continuation
            continuation = nil
            return c
        }
        timer?.cancel()
        c?.resume(returning: v)
    }

    func wait(timeoutMs: Int) async -> T? {
        await withTaskCancellationHandler {
            await withCheckedContinuation { (c: CheckedContinuation<T?, Never>) in
                lock.lock()
                if let value {
                    lock.unlock()
                    c.resume(returning: value)
                    return
                }
                if Task.isCancelled {
                    lock.unlock()
                    c.resume(returning: nil)
                    return
                }
                continuation = c
                timer = Task { [weak self] in
                    do { try await Task.sleep(nanoseconds: UInt64(max(timeoutMs, 0)) * 1_000_000) } catch { return }
                    self?.expire()
                }
                lock.unlock()
            }
        } onCancel: {
            self.expire()
        }
    }

    private func expire() {
        let c: CheckedContinuation<T?, Never>? = lock.locked {
            let c = continuation
            continuation = nil
            return c
        }
        c?.resume(returning: nil)
    }
}

public final class WatchfaceCustomizer: DataSyncFeature, @unchecked Sendable {
    public static let queryTimeoutMs = 6_000
    public static let echoWaitMs = 2_500

    public let name = "watch face customization"

    private final class Waiter: @unchecked Sendable {
        let marketId: String
        let result = TimedWait<FaceCustomization>()
        init(_ marketId: String) { self.marketId = marketId }
    }

    private let events: WearEvents
    /// The watch's face list, to check that the id is installed; nil when it could not be read.
    private let faces: @Sendable () async throws -> [WatchfaceEntry]?
    private let queryTimeoutMs: Int
    private let echoWaitMs: Int
    private let lock = NSLock()
    private var waiters: [Waiter] = []
    private var service: DataSyncService!

    public init(
        events: WearEvents, faces: @escaping @Sendable () async throws -> [WatchfaceEntry]?, queryTimeoutMs: Int = WatchfaceCustomizer.queryTimeoutMs,
        echoWaitMs: Int = WatchfaceCustomizer.echoWaitMs
    ) {
        self.events = events
        self.faces = faces
        self.queryTimeoutMs = queryTimeoutMs
        self.echoWaitMs = echoWaitMs
    }

    public func register(service: DataSyncService) {
        self.service = service
        service.onEvent(phonePkg: FaceCustomWire.phonePkg, watchPkg: FaceCustomWire.watchPkg, eventId: FaceCustomWire.eventReport) { [weak self] event in
            self?.onReport(event)
        }
    }

    /// The watch's 800100009: the reply to a query, the echo of an apply, or the user editing the face on the watch.
    private func onReport(_ event: SampleEvent) {
        guard let data = event.data else {
            note("report from the watch has no data")
            return
        }
        guard let config = FaceCustomWire.decode(data) else {
            note("report from the watch could not be read: \(DataSyncWire.describe(data))", error: true)
            return
        }
        let waiting = lock.locked { waiters.filter { $0.marketId == config.marketId } }
        note("report from the watch for \(config.describe()) (\(waiting.isEmpty ? "pushed, nobody asked" : "answers \(waiting.count) waiting request(s)"))")
        for waiter in waiting { waiter.result.complete(config) }
        if waiting.isEmpty { events.faceCustomization(config.toJS()) }
    }

    /// The 800100008 query: the face's current configuration. Throws when the watch is not ready, or does not answer in time.
    public func query(_ faceId: String) async throws -> FaceCustomization {
        try gate("query", faceId)
        try await checkInstalled("query", faceId)
        return try await readConfig(faceId)
    }

    private func readConfig(_ faceId: String) async throws -> FaceCustomization {
        let waiter = Waiter(faceId)
        lock.locked { waiters.append(waiter) }
        defer { lock.locked { waiters.removeAll { $0 === waiter } } }
        try await send("query", FaceCustomWire.eventQuery, FaceCustomWire.encodeQuery(faceId), faceId)
        guard let config = await waiter.result.wait(timeoutMs: queryTimeoutMs) else {
            try Task.checkCancellation()
            note("query \(faceId): no report within \(queryTimeoutMs) ms", error: true)
            throw WearError(.timeout, "The watch did not report a configuration for face \(faceId). It is probably not a face with editable options.")
        }
        return config
    }

    /// The 800100009 apply, then a query to read back what the watch holds. Nothing in Huawei Health acknowledges the apply except the 27/05
    /// report it uses to finish its install flow, so the read-back is the only proof here.
    public func apply(_ faceId: String, _ config: FaceCustomization) async throws -> FaceApplyResult {
        if config.marketId != faceId { throw WearError(.invalidArgument, "The configuration is for face \(config.marketId), not \(faceId)") }
        let data: Bytes
        do {
            data = try FaceCustomWire.encodeConfig(config)
        } catch let e as FaceCustomError {
            throw WearError(.invalidArgument, e.message)
        }
        try gate("apply", faceId)
        try await checkInstalled("apply", faceId)
        let echo = Waiter(faceId)
        lock.locked { waiters.append(echo) }
        var echoed = false
        do {
            try await send("apply", FaceCustomWire.eventReport, data, faceId)
            echoed = await echo.result.wait(timeoutMs: echoWaitMs) != nil
        } catch {
            lock.locked { waiters.removeAll { $0 === echo } }
            throw error
        }
        lock.locked { waiters.removeAll { $0 === echo } }
        try Task.checkCancellation()
        note("apply \(faceId): \(echoed ? "the watch pushed a report" : "no push from the watch within \(echoWaitMs) ms"), reading back")
        let after: FaceCustomization
        do {
            after = try await readConfig(faceId)
        } catch let e as WearError {
            note("apply \(faceId): read-back failed: \(e.message)", error: true)
            return FaceApplyResult(config: nil, echoed: echoed, mismatches: [], message: "Sent, but the watch did not answer the read-back, so nothing is confirmed.")
        }
        let mismatches = FaceCustomWire.differences(wanted: config, actual: after)
        let message = mismatches.isEmpty ? "The watch now reports the requested configuration." : "The watch did not take: \(mismatches.joined(separator: "; "))."
        note("apply \(faceId): \(message)")
        return FaceApplyResult(config: after, echoed: echoed, mismatches: mismatches, message: message)
    }

    private func gate(_ operation: String, _ faceId: String) throws {
        if faceId.isEmpty { throw WearError(.invalidArgument, "A face id is required") }
        if !service.connected() {
            note("\(operation) \(faceId): refused, no connected watch")
            throw WearError(.notConnected, "Not connected to a watch")
        }
        let bit = FaceCustomWire.capEvent
        let supported = service.supports(bit)
        note("\(operation) \(faceId): ExpandCapability \(bit) (DataSync events) \(supported ? "set" : "NOT set")")
        if !supported {
            throw WearError(.unsupported, "This watch does not report ExpandCapability \(bit), the one Huawei Health requires to send DataSync events.")
        }
    }

    /// Checks the id against the watch's face list. A face the list does not show is refused; flags are only logged (Huawei Health never
    /// reads them here).
    private func checkInstalled(_ operation: String, _ faceId: String) async throws {
        let list: [WatchfaceEntry]?
        do {
            list = try await faces()
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            note("\(operation) \(faceId): face list unreadable (\(error)), not checked")
            return
        }
        guard let list else {
            note("\(operation) \(faceId): face list unreadable, not checked")
            return
        }
        guard let face = list.first(where: { $0.id == faceId }) else {
            note("\(operation) \(faceId): not in the watch's face list (\(list.count) faces), refused")
            throw WearError(.invalidArgument, "Face \(faceId) is not installed on the watch")
        }
        note("\(operation) \(faceId): in the face list as '\(face.name)' type=\(face.type) (editable flag \(face.isEditable), factory \(face.isFactory)) expandedType=\(face.expandedType)")
    }

    private func send(_ what: String, _ eventId: Int, _ data: Bytes, _ faceId: String) async throws {
        let sent = try await service.sendEvent(
            phonePkg: FaceCustomWire.phonePkg, watchPkg: FaceCustomWire.watchPkg, eventId: eventId, data: data, what: "face customization \(what) \(faceId)"
        )
        if !sent { throw WearError(.disconnected, "The \(what) for face \(faceId) could not be sent. See the log for the reason.") }
    }

    private func note(_ message: String, error: Bool = false) {
        events.log(LogEntry(error ? .error : .info, "FaceCustom: \(message)"))
    }
}

#endif

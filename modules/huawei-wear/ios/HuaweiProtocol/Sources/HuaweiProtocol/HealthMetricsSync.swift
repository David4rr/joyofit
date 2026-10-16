// Port of HealthMetricsSync.kt (derived from GB's HuaweiSupportProvider.fetchActivityDataP2P): asks the watch (P2P module `datadictionarysync`,
// watch package `hw.watch.health.filesync`) for every dictionary class whose ExpandCapability gate is set, one class after the other, and stores
// the answers in `health_metrics`. Differences from GB: a class the watch does not answer within `classTimeoutMs` is given up (GB waits forever),
// each class has its own request so one silent class does not stop the rest, and the gate decisions are logged and kept in
// `health_metric_status`.
import Foundation

/// `health_metrics` and `health_metric_status`: where the rows go and what the gate checks found.
public protocol HealthMetricsStoring: DictionarySyncStore {
    /// Records the outcome of the gate check or sync of one metric; `rowsAdded` adds to the stored count when not nil.
    func setStatus(type: String, dictClass: Int, title: String, supported: Bool, gate: String, note: String?, rowsAdded: Int?) throws
}

/// What one dictionary sync did: rows stored per metric type, and the metrics that failed.
public struct HealthMetricsResult: Equatable, Sendable {
    public let rows: [String: Int]
    public let failed: [String]
    public var total: Int { rows.values.reduce(0, +) }

    public init(rows: [String: Int], failed: [String]) {
        self.rows = rows
        self.failed = failed
    }
}

public final class HealthMetricsSync: @unchecked Sendable {
    /// How long a class may take to answer before it is given up.
    public static let classTimeoutMs = 15_000
    /// How long a sync waits for the registration ping to be answered.
    public static let pingWaitMs = 6_000
    private static let pollMs = 100

    private let stack: P2PStack
    private let store: HealthMetricsStoring
    private let log: LogSink
    private let caps: DeviceCaps
    private let classTimeoutMs: Int
    private let pingWaitMs: Int

    public init(
        stack: P2PStack, store: HealthMetricsStoring, caps: DeviceCaps, log: @escaping LogSink, classTimeoutMs: Int = HealthMetricsSync.classTimeoutMs,
        pingWaitMs: Int = HealthMetricsSync.pingWaitMs
    ) {
        self.stack = stack
        self.store = store
        self.caps = caps
        self.log = log
        self.classTimeoutMs = classTimeoutMs
        self.pingWaitMs = pingWaitMs
    }

    private func note(_ message: String, error: Bool = false) { log(LogEntry(error ? .error : .info, service: 0x34, command: 0x01, message)) }

    /// Gate check only: logs and records which metrics this watch supports, no traffic.
    @discardableResult
    public func recordGates() -> [DictionarySyncHandler] {
        var supported = [DictionarySyncHandler]()
        for handler in P2PDictionarySyncService.syncHandlers() {
            let ok = handler.supports { caps.expandCapability($0) }
            note(
                "Health metric \(handler.title) (dictionary class \(handler.dataClass)): gate \(handler.gate) = \(ok) -> "
                    + (ok ? "will sync" : "skipped, the watch does not support it")
            )
            do {
                try store.setStatus(
                    type: handler.metricType, dictClass: handler.dataClass, title: handler.title, supported: ok, gate: handler.gate,
                    note: ok ? nil : "Not supported by this watch (\(handler.gate) is not set).", rowsAdded: nil
                )
            } catch {
                note("Health metric status not stored: \(error)", error: true)
            }
            if ok { supported.append(handler) }
        }
        return supported
    }

    /// Counts what a class stores, and forwards everything else to the real store.
    private final class CountingStore: DictionarySyncStore, @unchecked Sendable {
        let store: DictionarySyncStore
        private let lock = NSLock()
        private var _added = 0

        init(_ store: DictionarySyncStore) { self.store = store }

        var added: Int { lock.p2pLocked { _added } }

        func lastFetchTimestamp(_ type: String) -> Int64 { store.lastFetchTimestamp(type) }

        func persist(_ rows: [DictionaryRow]) throws {
            try store.persist(rows)
            lock.p2pLocked { _added += rows.count }
        }
    }

    private final class ClassCallback: DictionarySyncCallback, @unchecked Sendable {
        let handler: DictionarySyncHandler
        let store: DictionarySyncStore
        let counting: CountingStore
        let done = P2PWaiter<Bool>()
        let note: @Sendable (String) -> Void

        init(handler: DictionarySyncHandler, store: DictionarySyncStore, counting: CountingStore, note: @escaping @Sendable (String) -> Void) {
            self.handler = handler
            self.store = store
            self.counting = counting
            self.note = note
        }

        func lastDataSyncTimestamp(dictClass: Int) -> Int64 { handler.lastDataSyncTimestamp(store: store) }

        func onData(dictClass: Int, dictData: [DictData]) throws {
            note("Health metrics: \(handler.title): \(dictData.count) entries")
            try handler.handleData(store: counting, dictData: dictData)
        }

        func onComplete(_ complete: Bool) { done.complete(complete) }
    }

    public func sync() async throws -> HealthMetricsResult? {
        guard let service = stack.dictionary else {
            note("Health metrics: the P2P service is not available on this watch (no 34/01 in SupportedCommands); skipped")
            return nil
        }
        let handlers = recordGates()
        if handlers.isEmpty {
            note("Health metrics: the watch supports none of the dictionary classes")
            return HealthMetricsResult(rows: [:], failed: [])
        }
        // The ping sent at registration may still be in flight when a sync starts right after connect.
        let pollMs = HealthMetricsSync.pollMs
        let ready: Bool? = await p2pWithTimeout(ms: pingWaitMs) {
            while !service.isAvailable { try await Task.sleep(nanoseconds: UInt64(pollMs) * 1_000_000) }
            return true
        }
        if ready != true {
            let ping = stack.dictionaryPing
            note(
                "Health metrics: the watch app hw.watch.health.filesync is not available (ping "
                    + (ping.map { "answered \(String(format: "0x%02x", $0 & 0xFF)), 0xca needed" } ?? "not answered within \(pingWaitMs) ms") + "); skipped",
                error: true
            )
            for h in handlers {
                try store.setStatus(
                    type: h.metricType, dictClass: h.dataClass, title: h.title, supported: true, gate: h.gate,
                    note: "The watch app did not answer the P2P ping; nothing synced.", rowsAdded: nil
                )
            }
            return HealthMetricsResult(rows: [:], failed: handlers.map(\.metricType))
        }

        var rows = [String: Int]()
        var failed = [String]()
        for handler in handlers {
            let counting = CountingStore(store)
            let callback = ClassCallback(handler: handler, store: store, counting: counting, note: { [weak self] in self?.note($0) })
            note("Health metrics: syncing \(handler.title) (class \(handler.dataClass)) from \(handler.lastDataSyncTimestamp(store: store)) ms")
            service.startSync([handler.dataClass], callback: callback)
            let done = callback.done
            let outcome: Bool? = await p2pWithTimeout(ms: classTimeoutMs) { try await done.value() }
            if outcome == nil {
                service.cancelSync()
                note("Health metrics: \(handler.title): the watch did not finish within \(classTimeoutMs / 1000) s; given up", error: true)
                failed.append(handler.metricType)
            } else if outcome == false {
                failed.append(handler.metricType)
            }
            let added = counting.added
            rows[handler.metricType] = added
            let line: String?
            if outcome == nil {
                line = "The watch did not answer within \(classTimeoutMs / 1000) s."
            } else if outcome == false {
                line = "The sync of this class ended with an error (see the log)."
            } else if added == 0 {
                line = "The watch had no new entries."
            } else {
                line = nil
            }
            try store.setStatus(
                type: handler.metricType, dictClass: handler.dataClass, title: handler.title, supported: true, gate: handler.gate, note: line, rowsAdded: added
            )
            note("Health metrics: \(handler.title): \(added) rows stored" + (line.map { " (\($0))" } ?? ""))
        }
        return HealthMetricsResult(rows: rows, failed: failed)
    }
}

// Body data for the watch. Port of BodyMetrics.kt: the weight and body-fat dictionary (the watch's `{event:5}` request, answered by the diet
// feature through `sendWeight`), the resting-metabolism dictionary (the watch's 500018 request, and a push when the value changes) and the
// Health Glance card (event 80030006). Stored in the shared database's `body_metrics` table (key / value). UNVERIFIED on the Fit 4 Pro.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class BodyMetrics: DataSyncFeature, @unchecked Sendable {
    public let name = "body metrics"

    private let store: SyncStore
    private let service: DataSyncService
    private let events: WearEvents
    private let settings: WearSettings
    private let nowMs: @Sendable () -> Int64
    private let lock = NSLock()

    public init(
        store: SyncStore, service: DataSyncService, events: WearEvents, settings: WearSettings,
        nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.store = store
        self.service = service
        self.events = events
        self.settings = settings
        self.nowMs = nowMs
    }

    // MARK: storage

    public func load() -> BodyMetricsData {
        lock.locked {
            do {
                let rows: [(String, String)] = try store.read { db in
                    try db.query("SELECT key, value FROM body_metrics") { ($0.text(0) ?? "", $0.text(1) ?? "") }
                }
                let map = Dictionary(rows, uniquingKeysWith: { _, last in last })
                return BodyMetricsData(
                    weightKg: map["weight_kg"].flatMap(Double.init), weightTsMs: map["weight_ts"].flatMap(Int64.init),
                    bodyFatPct: map["body_fat_pct"].flatMap(Double.init), bodyFatTsMs: map["body_fat_ts"].flatMap(Int64.init),
                    restingKcal: map["resting_kcal"].flatMap(Int.init), systolic: map["systolic"].flatMap(Int.init),
                    diastolic: map["diastolic"].flatMap(Int.init), bpTsMs: map["bp_ts"].flatMap(Int64.init)
                )
            } catch {
                events.error("Body metrics: could not read the database: \(error)")
                return BodyMetricsData()
            }
        }
    }

    /// Overwrites only the fields `update` sets (non-nil); returns the merged result.
    public func save(_ update: BodyMetricsData) throws -> BodyMetricsData {
        let now = nowMs()
        var rows = [(String, String)]()
        if let v = update.weightKg { rows.append(("weight_kg", "\(v)")) }
        if let v = update.weightTsMs { rows.append(("weight_ts", "\(v)")) }
        if let v = update.bodyFatPct { rows.append(("body_fat_pct", "\(v)")) }
        if let v = update.bodyFatTsMs { rows.append(("body_fat_ts", "\(v)")) }
        if let v = update.restingKcal { rows.append(("resting_kcal", "\(v)")) }
        if let v = update.systolic { rows.append(("systolic", "\(v)")) }
        if let v = update.diastolic { rows.append(("diastolic", "\(v)")) }
        if let v = update.bpTsMs { rows.append(("bp_ts", "\(v)")) }
        do {
            try lock.locked {
                try store.read { db in
                    try db.transaction {
                        for (key, value) in rows {
                            try db.run(
                                "INSERT INTO body_metrics (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                                [.text(key), .text(value), .int(now)]
                            )
                        }
                    }
                }
            }
        } catch let e as SQLiteError {
            throw WearError(.storage, "Could not store the body metrics: \(e.message)", underlying: e)
        }
        return load()
    }

    /// Stored weight, else the JoyoFit profile weight (no timestamp).
    private func effectiveWeight(_ data: BodyMetricsData) -> Double? { data.weightKg ?? settings.profile?.weightKg }

    /// Latest weight (plus body fat and BMR when known) as the dictionary row the watch's `{event:5}` asks for.
    public func weightRowOrNil(nowMs: Int64? = nil) -> DictRow? {
        let now = nowMs ?? self.nowMs()
        let data = load()
        guard let weight = effectiveWeight(data) else { return nil }
        return BodyMetricsCodec.weightRow(
            weightKg: weight, tsMs: data.weightTsMs ?? now, bodyFatPct: data.bodyFatPct, basalKcal: data.restingKcal.map(Double.init), modifyMs: now
        )
    }

    // MARK: sending

    /// The watch's `{event:5}` (or a new weigh-in): 0x37/04 dictionary 10006.
    @discardableResult
    public func sendWeight(phonePkg: String, watchPkg: String, reason: String) async throws -> Bool {
        guard let row = weightRowOrNil() else {
            events.info("Body: weight not sent (\(reason)): no weight known (no weigh-in and no profile)")
            return false
        }
        events.info("Body: sending weight dictionary (\(reason))")
        return try await service.sendDictionary(phonePkg: phonePkg, watchPkg: watchPkg, dictType: BodyMetricsCodec.dictWeight, rows: [row], what: "weight dictionary")
    }

    /// The watch's 500018 request, or a push after the value changed. `startMs` / `endMs` echo the request's window when it had one.
    @discardableResult
    public func sendResting(phonePkg: String, watchPkg: String, startMs: Int64?, endMs: Int64?, reason: String) async throws -> Bool {
        guard let kcal = load().restingKcal, kcal > 0 else {
            events.info("Body: resting metabolism not sent (\(reason)): no value known")
            return false
        }
        let now = nowMs()
        let row = BodyMetricsCodec.restingRow(kcal: kcal, startMs: startMs ?? startOfDay(now), endMs: endMs ?? now, modifyMs: now)
        events.info("Body: sending resting metabolism \(kcal) kcal (\(reason))")
        return try await service.sendDictionary(
            phonePkg: phonePkg, watchPkg: watchPkg, dictType: BodyMetricsCodec.dictResting, rows: [row], what: "resting metabolism dictionary"
        )
    }

    /// Stores `update` and pushes what changed to a connected watch. Returns the merged data.
    public func set(_ update: BodyMetricsData) async throws -> BodyMetricsData {
        let before = load()
        let after = try save(update)
        events.info("Body: stored \(update.toJS().filter { !($0.value is NSNull) })")
        if service.connected() {
            if let kcal = after.restingKcal, kcal != before.restingKcal {
                try await sendResting(phonePkg: BodyMetricsCodec.phonePkg, watchPkg: BodyMetricsCodec.watchPkg, startMs: nil, endMs: nil, reason: "changed")
            }
            if (after.weightKg != nil && after.weightKg != before.weightKg) || (after.bodyFatPct != nil && after.bodyFatPct != before.bodyFatPct) {
                try await sendWeight(phonePkg: BodyMetricsCodec.phonePkg, watchPkg: BodyMetricsCodec.watchPkg, reason: "changed")
            }
        }
        return after
    }

    public func glance() -> [GlanceField] {
        let data = load()
        return BodyMetricsCodec.glance(data, weightKg: effectiveWeight(data), heightCm: settings.profile?.heightCm)
    }

    // MARK: DataSyncFeature

    public func register(service: DataSyncService) {
        service.onDictionary(phonePkg: BodyMetricsCodec.phonePkg, watchPkg: nil, dictId: BodyMetricsCodec.dictResting) { [weak self] query in
            guard let self else { return }
            let watch = query.watchPkg.isEmpty ? BodyMetricsCodec.watchPkg : query.watchPkg
            do {
                try await self.sendResting(
                    phonePkg: query.phonePkg, watchPkg: watch, startMs: query.startMs.flatMap { $0 > 0 ? $0 : nil },
                    endMs: query.endMs.flatMap { $0 > 0 ? $0 : nil }, reason: "watch request"
                )
            } catch is CancellationError {
            } catch {
                self.events.error("Body: resting metabolism not sent: \(error)")
            }
        }
        service.onEvent(phonePkg: BodyMetricsCodec.glancePhonePkg, watchPkg: nil, eventId: BodyMetricsCodec.eventGlance) { [weak self] event in
            guard let self else { return }
            let fields = self.glance()
            self.events.info("Health Glance: watch asked, answering with \(fields.map(\.key))")
            do {
                _ = try await service.sendEvent(
                    phonePkg: event.phonePkg.isEmpty ? BodyMetricsCodec.glancePhonePkg : event.phonePkg,
                    watchPkg: event.watchPkg.isEmpty ? BodyMetricsCodec.glanceWatchPkg : event.watchPkg, eventId: BodyMetricsCodec.eventGlance,
                    data: Array(BodyMetricsCodec.glanceJSON(fields).utf8), what: "health glance"
                )
            } catch is CancellationError {
            } catch {
                self.events.error("Body: health glance not sent: \(error)")
            }
        }
    }

    public func onConnected() async throws {
        // Huawei pushes the resting metabolism when it changes and the watch asks for the weight itself; send the known BMR once.
        try await sendResting(phonePkg: BodyMetricsCodec.phonePkg, watchPkg: BodyMetricsCodec.watchPkg, startMs: nil, endMs: nil, reason: "connected")
    }

    private func startOfDay(_ ms: Int64) -> Int64 {
        Int64(Calendar.current.startOfDay(for: Date(timeIntervalSince1970: Double(ms) / 1000)).timeIntervalSince1970 * 1000)
    }
}

extension BodyMetricsData {
    /// `BodyMetricsUpdate` of HuaweiWearDiet.types.ts from the JS object: only the fields that are set are stored; times are Unix ms.
    public static func parse(_ raw: [String: Any]) throws -> BodyMetricsData {
        func number(_ key: String) throws -> Double? {
            guard let value = raw[key], !(value is NSNull) else { return nil }
            switch value {
            case let d as Double where d.isFinite: return d
            case let i as Int: return Double(i)
            case let n as NSNumber where n.doubleValue.isFinite: return n.doubleValue
            default: throw WearError(.invalidArgument, "\(key) must be a number")
            }
        }
        func whole(_ key: String) throws -> Int? { try number(key).map { Int($0) } }
        func time(_ key: String) throws -> Int64? { try number(key).map { Int64($0) } }
        return BodyMetricsData(
            weightKg: try number("weightKg"), weightTsMs: try time("weightTs"), bodyFatPct: try number("bodyFatPct"), bodyFatTsMs: try time("bodyFatTs"),
            restingKcal: try whole("restingKcal"), systolic: try whole("systolic"), diastolic: try whole("diastolic"), bpTsMs: try time("bpTs")
        )
    }
}

#endif

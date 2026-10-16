// Sends the day's meals and goals to the watch's calorie card and answers its requests. Port of DietSync.kt (store + feature). The data comes from
// JS (`setDay`); the latest day lives in `diet_day` of the shared database so the background wake can answer with JS closed. The last push and its
// result live in UserDefaults (`joyofit_diet`, Android's SharedPreferences file of the same name).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// Reads and writes `diet_day`.
public final class DietStore: @unchecked Sendable {
    private let store: SyncStore
    private let lock = NSLock()

    public init(_ store: SyncStore) { self.store = store }

    private static let columns = "SELECT date, meals_json, goals_json, updated_at, pushed_at FROM diet_day"

    public func latest() throws -> DietDay? { try query(DietStore.columns + " ORDER BY date DESC LIMIT 1", []) }

    public func day(_ date: String) throws -> DietDay? { try query(DietStore.columns + " WHERE date = ?", [.text(date)]) }

    /// The newest `limit` days.
    public func recent(_ limit: Int) throws -> [DietDay] {
        let dates: [String] = try locked("read") { db in
            try db.query("SELECT date FROM diet_day ORDER BY date DESC LIMIT ?", [.int(Int64(limit))]) { $0.text(0) ?? "" }
        }
        return try dates.compactMap { try day($0) }
    }

    public func put(_ day: DietDay) throws {
        let meals = try encode(day.meals.map { $0.toJson() })
        let goals = try encode(day.goals?.toJson() ?? [:])
        try locked("store") { db in
            try db.run(
                """
                INSERT INTO diet_day (date, meals_json, goals_json, updated_at, pushed_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(date) DO UPDATE SET meals_json = excluded.meals_json, goals_json = excluded.goals_json,
                  updated_at = excluded.updated_at, pushed_at = excluded.pushed_at
                """,
                [.text(day.date), .text(meals), .text(goals), .int(day.updatedAt), day.pushedAt.map { .int($0) } ?? .null]
            )
        }
    }

    public func markPushed(_ date: String, atMs: Int64) throws {
        try locked("update") { db in try db.run("UPDATE diet_day SET pushed_at = ? WHERE date = ?", [.int(atMs), .text(date)]) }
    }

    private func locked<T>(_ verb: String, _ body: (SQLiteDatabase) throws -> T) throws -> T {
        lock.lock()
        defer { lock.unlock() }
        do {
            return try store.read(body)
        } catch let e as WearError {
            throw e
        } catch {
            throw WearError(.storage, "Could not \(verb) diet_day: \(error)")
        }
    }

    private func encode(_ object: Any) throws -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object), let text = String(data: data, encoding: .utf8) else {
            throw WearError(.storage, "Could not encode diet_day JSON")
        }
        return text
    }

    private func query(_ sql: String, _ args: [SQLValue]) throws -> DietDay? {
        let row: (String, String, String, Int64, Int64?)? = try locked("read") { db in
            try db.query(sql, args) { ($0.text(0) ?? "", $0.text(1) ?? "[]", $0.text(2) ?? "{}", $0.int64(3), $0.isNull(4) ? nil : $0.int64(4)) }.first
        }
        guard let row else { return nil }
        func parse(_ text: String) throws -> Any {
            guard let data = text.data(using: .utf8), let value = try? JSONSerialization.jsonObject(with: data) else {
                throw WearError(.storage, "diet_day holds invalid JSON")
            }
            return value
        }
        guard let array = try parse(row.1) as? [Any], let goals = try parse(row.2) as? [String: Any] else {
            throw WearError(.storage, "diet_day holds invalid JSON")
        }
        let meals = try array.map { element -> DietMeal in
            guard let o = element as? [String: Any] else { throw WearError(.storage, "diet_day holds invalid JSON") }
            return DietMeal.fromJson(o)
        }
        return DietDay(date: row.0, meals: meals, goals: DietGoals.fromJson(goals), updatedAt: row.3, pushedAt: row.4)
    }
}

public final class DietSync: DataSyncFeature, @unchecked Sendable {
    public let name = "calorie intake"

    /// How far back watch meals awaiting JoyoRogo are looked for.
    static let recentDays = 7
    private static let suiteName = "joyofit_diet"
    private enum Key {
        static let pushedAt = "pushed_at"
        static let lastResult = "last_result"
    }

    private let days: DietStore
    private let events: WearEvents
    private let settings: WearSettings
    private let defaults: UserDefaults
    private let calendar: Calendar
    private let now: @Sendable () -> Date
    /// The activity-ring calories goal, used when the day's goals carry no `activityCalGoal`.
    private let activityCalories: @Sendable () -> Int
    /// Answers the watch's request for the latest weight (event 5): `(phonePkg, watchPkg, reason)`; true when it was sent.
    private let sendWeight: @Sendable (String, String, String) async -> Bool
    private let writeLock = NSLock()
    private var service: DataSyncService!

    public init(
        store: SyncStore, events: WearEvents, settings: WearSettings, defaults: UserDefaults? = nil, calendar: Calendar = .current,
        now: @escaping @Sendable () -> Date = { Date() }, activityCalories: @escaping @Sendable () -> Int = { 300 },
        sendWeight: @escaping @Sendable (String, String, String) async -> Bool = { _, _, _ in false }
    ) {
        days = DietStore(store)
        self.events = events
        self.settings = settings
        self.defaults = defaults ?? UserDefaults(suiteName: DietSync.suiteName) ?? .standard
        self.calendar = calendar
        self.now = now
        self.activityCalories = activityCalories
        self.sendWeight = sendWeight
    }

    private func log(_ message: String) { events.log(LogEntry(.info, message)) }

    private func error(_ message: String) { events.log(LogEntry(.error, message)) }

    private var nowMs: Int64 { Int64((now().timeIntervalSince1970 * 1000).rounded(.down)) }

    // MARK: local time

    func dateOf(_ ms: Int64) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: Double(ms) / 1000))
        func pad(_ n: Int, _ width: Int) -> String {
            let s = String(n)
            return String(repeating: "0", count: max(0, width - s.count)) + s
        }
        return "\(pad(c.year ?? 0, 4))-\(pad(c.month ?? 0, 2))-\(pad(c.day ?? 0, 2))"
    }

    func startOfDaySec(_ ms: Int64) -> Int64 {
        Int64(calendar.startOfDay(for: Date(timeIntervalSince1970: Double(ms) / 1000)).timeIntervalSince1970)
    }

    /// The day to answer with: today's stored row, or (new day, app not opened yet) today with no meals and the latest goals, so the watch
    /// shows today's empty slots instead of yesterday's meals. Nil when nothing was ever stored.
    public func currentDay(nowMs: Int64? = nil) throws -> DietDay? {
        let at = nowMs ?? self.nowMs
        let today = dateOf(at)
        if let day = try days.day(today) { return day }
        guard let latest = try days.latest() else { return nil }
        return DietDay(date: today, meals: [], goals: latest.goals, updatedAt: latest.updatedAt, pushedAt: nil)
    }

    /// The kcal eaten on `date` (`YYYY-MM-DD`), nil when no row exists. For other native features (Healthy Living).
    public func intakeKcal(_ date: String) throws -> Double? { try days.day(date)?.intakeKcal }

    // MARK: JS API

    private static func isIsoDay(_ s: String) -> Bool {
        let u = Array(s.utf8)
        guard u.count == 10 else { return false }
        for (i, b) in u.enumerated() {
            if i == 4 || i == 7 { if b != UInt8(ascii: "-") { return false } } else if b < 0x30 || b > 0x39 { return false }
        }
        return true
    }

    /// Stores the day (JoyoRogo is the source of truth, but a watch meal JS has not yet confirmed is kept) and pushes it to a connected watch.
    /// Returns true when it reached the watch.
    public func setDay(date: String, meals: [DietMeal], goals newGoals: DietGoals?) async throws -> Bool {
        if !DietSync.isIsoDay(date) { throw WearError(.invalidArgument, "date must be YYYY-MM-DD, got '\(date)'") }
        for meal in meals {
            if !DietPlanner.isMealType(meal.whichMeal) {
                throw WearError(.invalidArgument, "whichMeal must be 10, 11, 20, 21, 30, 31 or 40, got \(meal.whichMeal)")
            }
            if meal.kcal < 0 || meal.kcal > 20_000 { throw WearError(.invalidArgument, "kcal out of range: \(meal.kcal)") }
        }
        if let newGoals, newGoals.dailyKcal < 0 || newGoals.dailyKcal > 20_000 {
            throw WearError(.invalidArgument, "dailyKcal out of range: \(newGoals.dailyKcal)")
        }
        let stored: (kept: Int, intake: Double, goal: Int?) = try writeLock.locked {
            let existing = try days.day(date)
            let kept = (existing?.meals ?? []).filter { kept in kept.src == "watch" && !kept.synced && !meals.contains(where: { $0.id == kept.id }) }
            let goalsToStore = try newGoals ?? existing?.goals ?? days.latest()?.goals
            try days.put(DietDay(date: date, meals: meals + kept, goals: goalsToStore, updatedAt: nowMs, pushedAt: existing?.pushedAt))
            return (kept.count, (meals + kept).reduce(0) { $0 + $1.kcal }, goalsToStore?.dailyKcal)
        }
        log("Diet: stored \(date) meals=\(meals.count)+\(stored.kept) watch-only, intake=\(Int((stored.intake + 0.5).rounded(.down))) kcal, goal=\(stored.goal.map(String.init) ?? "none")")
        return try await push("set", withConfig: true)
    }

    /// JS wrote the watch-logged meals to JoyoRogo: stop keeping them separately.
    public func markWatchMealsSynced(_ ids: [String]) throws {
        try writeLock.locked {
            for var day in try days.recent(DietSync.recentDays) {
                if !day.meals.contains(where: { ids.contains($0.id) }) { continue }
                day.meals = day.meals.map { meal in
                    var m = meal
                    if ids.contains(m.id) { m.synced = true }
                    return m
                }
                day.updatedAt = nowMs
                try days.put(day)
            }
        }
    }

    /// Watch quick-logged meals (recent days) that JS has not yet confirmed written to JoyoRogo.
    public func pendingWatchMeals() throws -> [DietMeal] {
        try days.recent(DietSync.recentDays).flatMap { $0.meals.filter { $0.src == "watch" && !$0.synced } }
    }

    /// `DietStatus` in `HuaweiWearDiet.types.ts`.
    public func status() -> [String: Any] {
        let day = try? currentDay()
        let pending = (try? pendingWatchMeals()) ?? []
        let connected = service?.connected() ?? false
        let pushedAt = Int64(defaults.integer(forKey: Key.pushedAt))
        func orNull(_ v: Any?) -> Any { v ?? NSNull() }
        var supported: Any = NSNull()
        if connected, let service {
            supported = [
                "config": service.supports(DataSyncWire.capConfig),
                "event": service.supports(DataSyncWire.capEvent),
                "point": service.supports(DataSyncWire.capPoint),
                "dictionary": service.supports(DataSyncWire.capDict),
                "extraMealSlots": service.supports(DietPlanner.capExtraMeals),
            ] as [String: Any]
        }
        return [
            "date": orNull(day?.date),
            "mealCount": orNull(day.map { $0.meals.count }),
            "intakeKcal": orNull(day?.intakeKcal),
            "goals": orNull(day?.goals?.toJS()),
            "updatedAt": orNull(day.flatMap { $0.updatedAt > 0 ? $0.updatedAt : nil }),
            "pushedAt": orNull(pushedAt > 0 ? pushedAt : nil),
            "lastResult": orNull(defaults.string(forKey: Key.lastResult)),
            "unsyncedWatchMeals": pending.count,
            "pendingWatchMeals": pending.map { $0.toJS() },
            "supported": supported,
        ]
    }

    // MARK: sending

    private func record(_ result: String) { defaults.set(result, forKey: Key.lastResult) }

    /// Config(s) then the day's point. `withConfig` false sends only the point (a watch request).
    @discardableResult
    public func push(_ reason: String, withConfig: Bool, window: (Int64, Int64)? = nil) async throws -> Bool {
        let at = nowMs
        guard let day = try currentDay(nowMs: at) else {
            log("Diet: nothing to push (\(reason)): no day stored yet")
            record("nothing stored")
            return false
        }
        if !service.connected() {
            log("Diet: not pushed (\(reason)): no connected watch; it is sent at the next connect")
            record("watch not connected")
            return false
        }
        var ok = true
        if withConfig {
            let sent = try await sendConfigs(day, at)
            ok = sent && ok
        }
        let sentPoint = try await sendPoint(day, at, window, reason)
        ok = sentPoint && ok
        if ok {
            defaults.set(at, forKey: Key.pushedAt)
            if try days.day(day.date) != nil { try days.markPushed(day.date, atMs: at) }
        }
        record(ok ? "sent (\(reason))" : "failed (\(reason)), see the log")
        return ok
    }

    private func sendConfigs(_ day: DietDay, _ at: Int64) async throws -> Bool {
        guard let goalsOfDay = day.goals else {
            log("Diet: no goals stored, config \(DietPlanner.configDiet) not sent")
            return true
        }
        let activityCal = goalsOfDay.activityCalGoal ?? activityCalories()
        let weightInit = goalsOfDay.weightInitKg ?? settings.profile?.weightKg
        var items: [ConfigItem] = [
            ConfigItem(configId: DietPlanner.configDiet, action: 1, data: DietPlanner.configJson(goalsOfDay, activityCalGoal: activityCal, weightInitKg: weightInit), modifyMs: at)
        ]
        // The weight goal is its own config.
        if let target = goalsOfDay.targetWeightKg {
            items.append(ConfigItem(configId: DietPlanner.configWeightGoal, action: 1, data: DietPlanner.weightGoalJson(target), modifyMs: at))
        }
        var ok = true
        for item in items {
            log("Diet: config \(item.configId) = \(DataSyncWire.describe(item.data))")
            let sent = try await service.sendConfig(
                phonePkg: DietPlanner.phonePkg, watchPkg: DietPlanner.watchPkg, configId: item.configId, data: item.data, action: item.action,
                modifyMs: item.modifyMs, what: "diet config \(item.configId)"
            )
            ok = sent && ok
        }
        return ok
    }

    private func sendPoint(_ day: DietDay, _ at: Int64, _ window: (Int64, Int64)?, _ reason: String) async throws -> Bool {
        let extra = service.supports(DietPlanner.capExtraMeals)
        log("Diet: ExpandCapability \(DietPlanner.capExtraMeals) (extra meal slots 11/21/31) is \(extra ? "set" : "NOT set: they fold into 40")")
        let entries = DietPlanner.entries(day: day, extraSlots: extra, todayDate: dateOf(at), todayStartSec: startOfDaySec(at))
        let json = DietPlanner.mealsJson(entries)
        log("Diet: meals (\(reason), \(entries.count) entries) = \(String(decoding: json, as: UTF8.self))")
        let start = window?.0 ?? startOfDaySec(at) * 1000
        let end = window?.1 ?? at
        return try await service.sendSamplePoint(
            phonePkg: DietPlanner.phonePkg, watchPkg: DietPlanner.watchPkg, dictType: DietPlanner.dictDiet,
            values: [PointValue(key: DietPlanner.dictDiet, value: json)], startMs: start, endMs: end,
            metadata: day.date == dateOf(at) ? DietPlanner.analysisJson(day) : nil, what: "diet meals"
        )
    }

    // MARK: watch requests

    public func register(service: DataSyncService) {
        self.service = service
        service.onEvent(phonePkg: DietPlanner.phonePkg, watchPkg: nil, eventId: DietPlanner.eventDiet) { [weak self] event in await self?.onDietEvent(event) }
        service.onEvent(phonePkg: DietPlanner.commonPkg, watchPkg: nil, eventId: DietPlanner.eventVip) { [weak self] event in await self?.onVipEvent(event) }
    }

    public func onConnected() async throws {
        try await push("connected", withConfig: true)
    }

    /// For 80030003: `{startTime, endTime, event}`.
    private func onDietEvent(_ event: SampleEvent) async {
        guard let json = DietPlanner.parseObject(event.data) else {
            log("Diet: watch event \(event.eventId) without a JSON body, ignored")
            return
        }
        let phone = event.phonePkg.isEmpty ? DietPlanner.phonePkg : event.phonePkg
        let watch = event.watchPkg.isEmpty ? DietPlanner.watchPkg : event.watchPkg
        let kind = DietJson.optInt(json, "event") ?? -1
        do {
            switch kind {
            case 1:
                // The day's meals for the clamped start / end. We hold one day, so the window only becomes start / end of the point.
                let startMs = DietJson.optLong(json, "startTime") ?? 0
                let endMs = DietJson.optLong(json, "endTime") ?? 0
                let clamped = startMs > 0 ? startOfDaySec(startMs) * 1000 : 0
                log("Diet: the watch asks for its meals (event 1, window \(startMs)..\(endMs))")
                try await push("watch request", withConfig: false, window: endMs > 0 ? (clamped, endMs) : nil)
            case 5:
                log("Diet: the watch asks for the latest weight (event 5)")
                _ = await sendWeight(phone, watch, "watch request")
            case 6:
                try await onQuickLog(json, phone, watch)
            default:
                log("Diet: watch event \(event.eventId) kind \(kind) (week report 4 and others) is not answered")
            }
        } catch is CancellationError {
            return
        } catch {
            self.error("Diet: watch event \(event.eventId) kind \(kind) failed: \(error)")
        }
    }

    private func onQuickLog(_ json: [String: Any], _ phone: String, _ watch: String) async throws {
        let at = nowMs
        let meals = DietPlanner.parseQuickLog(json, nowSec: at / 1000)
        log("Diet: the watch quick-logged \(meals.count) meal(s): \(meals.map { "\($0.whichMeal)@\($0.eatTime)=\($0.kcal) kcal" }.joined(separator: ", "))")
        var result = 0
        var failTime = meals.first?.eatTime ?? DietJson.optLong(json, "startTime") ?? 0
        do {
            if !meals.isEmpty {
                try writeLock.locked {
                    var byDate: [String: [DietMeal]] = [:]
                    var dates: [String] = []
                    for meal in meals {
                        let date = dateOf(meal.eatTime * 1000)
                        if byDate[date] == nil { dates.append(date) }
                        byDate[date, default: []].append(meal)
                    }
                    for date in dates {
                        var base = try days.day(date) ?? DietDay(date: date, meals: [], goals: try days.latest()?.goals)
                        base.meals += byDate[date] ?? []
                        base.updatedAt = at
                        try days.put(base)
                    }
                }
                events.watchMealLogged(["date": dateOf(meals[0].eatTime * 1000), "meals": meals.map { $0.toJS() }])
            }
        } catch let e as WearError {
            error("Diet: could not store the watch's meals: \(e.message)")
            result = 102
            failTime = meals.first?.eatTime ?? 0
        }
        // The reply needs ExpandCapability 215.
        if service.supports(DietPlanner.capExtraMeals) {
            _ = try await service.sendEvent(
                phonePkg: phone, watchPkg: watch, eventId: DietPlanner.eventDiet, data: DietPlanner.punchReply(resultCode: result, failTimeSec: failTime),
                what: "diet quick-log reply"
            )
        } else {
            log("Diet: ExpandCapability \(DietPlanner.capExtraMeals) not set, no quick-log reply sent (as Huawei Health)")
        }
        if result == 0 && !meals.isEmpty { try await push("watch quick-log", withConfig: false) }
    }

    /// For 80030004: only a request byte of 1 is answered, here always with "not VIP" (0).
    private func onVipEvent(_ event: SampleEvent) async {
        let asked = DietPlanner.readInt32(event.data)
        if asked != 1 {
            log("Diet: VIP flag event with request \(asked.map(String.init) ?? "none"), not answered (Huawei answers only 1)")
            return
        }
        do {
            _ = try await service.sendEvent(
                phonePkg: event.phonePkg.isEmpty ? DietPlanner.commonPkg : event.phonePkg, watchPkg: event.watchPkg.isEmpty ? DietPlanner.watchPkg : event.watchPkg,
                eventId: DietPlanner.eventVip, data: [0], what: "vip flag"
            )
        } catch {
            self.error("Diet: vip flag reply failed: \(error)")
        }
    }
}

#endif

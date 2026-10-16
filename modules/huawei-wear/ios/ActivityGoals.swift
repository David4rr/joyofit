// Activity-ring goals and reminders (Settings, Goals & reminders). Port of ActivityGoals.kt: stored on UserDefaults (the counterpart of the
// `joyofit_goals` SharedPreferences), sent over DataSync (hw.sport.config -> in.huawei.motion) on change, on every connect once the user has
// saved goals, and kept in step when the watch changes one itself. Gate: ExpandCapability 83. UNVERIFIED on the Fit 4 Pro.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class ActivityGoals: DataSyncFeature, @unchecked Sendable {
    private static let suiteName = "joyofit_goals"

    private enum Key {
        static let steps = "steps"
        static let calories = "calories"
        static let exercise = "exercise"
        static let stand = "stand"
        static let remindStand = "remind_stand"
        static let remindProgress = "remind_progress"
        static let remindReached = "remind_reached"
        static let sentAt = "sent_at"
        static let saved = "saved_by_user"
    }

    public let name = "activity goals"

    private let defaults: UserDefaults
    private let service: DataSyncService
    private let events: WearEvents
    private let settings: WearSettings
    private let nowMs: @Sendable () -> Int64
    /// The watch's configs arrive on their own tasks; each one reads, changes and writes the stored goals.
    private let storeLock = NSLock()

    public init(
        defaults: UserDefaults? = nil, service: DataSyncService, events: WearEvents, settings: WearSettings,
        nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.defaults = defaults ?? UserDefaults(suiteName: ActivityGoals.suiteName) ?? .standard
        self.service = service
        self.events = events
        self.settings = settings
        self.nowMs = nowMs
    }

    private func int(_ key: String, _ fallback: Int) -> Int { defaults.object(forKey: key) == nil ? fallback : defaults.integer(forKey: key) }

    private func flag(_ key: String) -> Bool { defaults.object(forKey: key) == nil ? true : defaults.bool(forKey: key) }

    /// Until the user saves goals, the ring's steps goal is the profile's daily step goal (the same number on the watch).
    public private(set) var goals: ActivityGoalsData {
        get {
            ActivityGoalsData(
                steps: int(Key.steps, settings.profile?.dailyStepGoal ?? ActivityGoalsData.defaultSteps),
                calories: int(Key.calories, ActivityGoalsData.defaultCalories),
                exerciseMinutes: int(Key.exercise, ActivityGoalsData.defaultExerciseMinutes),
                standHours: int(Key.stand, ActivityGoalsData.defaultStandHours),
                remindStand: flag(Key.remindStand), remindProgress: flag(Key.remindProgress), remindGoalReached: flag(Key.remindReached)
            )
        }
        set {
            defaults.set(newValue.steps, forKey: Key.steps)
            defaults.set(newValue.calories, forKey: Key.calories)
            defaults.set(newValue.exerciseMinutes, forKey: Key.exercise)
            defaults.set(newValue.standHours, forKey: Key.stand)
            defaults.set(newValue.remindStand, forKey: Key.remindStand)
            defaults.set(newValue.remindProgress, forKey: Key.remindProgress)
            defaults.set(newValue.remindGoalReached, forKey: Key.remindReached)
        }
    }

    /// Unix ms of the last complete send; 0 when never.
    public var lastSentAt: Int64 { Int64(defaults.object(forKey: Key.sentAt) as? Int ?? 0) }

    /// `ActivityGoalsStatus` of HuaweiWearDiet.types.ts.
    public func status() -> [String: Any] {
        var out = goals.toJS()
        out["configSupported"] = service.connected() ? service.supports(DataSyncWire.capConfig) as Any : NSNull()
        out["lastSentAt"] = lastSentAt > 0 ? lastSentAt as Any : NSNull()
        return out
    }

    /// Validates, stores and, when the watch is connected, sends. Returns true when it reached the watch.
    public func set(_ next: ActivityGoalsData) async throws -> Bool {
        try ActivityGoalsCodec.validate(next)
        goals = next
        defaults.set(true, forKey: Key.saved)
        events.info(
            "Goals: saved steps=\(next.steps) kcal=\(next.calories) exercise=\(next.exerciseMinutes) min stand=\(next.standHours) h reminders stand=\(next.remindStand) progress=\(next.remindProgress) reached=\(next.remindGoalReached)"
        )
        return try await send("changed")
    }

    public func send(_ reason: String) async throws -> Bool {
        let now = nowMs()
        let items = ActivityGoalsCodec.items(goals, nowSec: Int(now / 1000), nowMs: now)
        events.info("Goals: sending to the watch (\(reason))")
        // One packet per config, like Huawei Health and GB; the watch answers each, and the answers are only logged.
        var all = true
        for item in items {
            let sent = try await service.sendConfig(
                phonePkg: ActivityGoalsCodec.srcPkg, watchPkg: ActivityGoalsCodec.wearPkg, configId: item.configId, data: item.data, action: item.action,
                modifyMs: item.modifyMs, what: "activity goal \(item.configId)"
            )
            if !sent {
                all = false
                break
            }
        }
        if all { defaults.set(Int(now), forKey: Key.sentAt) }
        return all
    }

    // MARK: DataSyncFeature

    public func register(service: DataSyncService) {
        // The watch writes goals back (Huawei Health listens on hw.sport.config; GB on in.huawei.motion). Match either side.
        service.onConfig(phonePkg: nil, watchPkg: ActivityGoalsCodec.wearPkg, configId: nil) { [weak self] in self?.onWatchConfig($0) }
        service.onConfig(phonePkg: ActivityGoalsCodec.srcPkg, watchPkg: nil, configId: nil) { [weak self] in self?.onWatchConfig($0) }
    }

    public func onConnected() async throws {
        // Defaults are not pushed: a watch whose goals were set on the watch or in Huawei Health keeps them until the user saves goals here.
        if !defaults.bool(forKey: Key.saved) {
            events.info("Goals: not sent on connect, no goals saved in JoyoFit yet (Settings, Goals and reminders)")
            return
        }
        _ = try await send("connected")
    }

    func onWatchConfig(_ config: SampleConfigIn) {
        guard let item = config.items.first, let data = item.data, let tlv = try? HuaweiTLV(parsing: data), tlv.contains(0x02) else { return }
        let value = Int(tlv.asInteger(0x02, default: 0))
        storeLock.lock()
        defer { storeLock.unlock() }
        var next = goals
        let current = next
        switch item.configId {
        case ActivityGoalsCodec.steps: next.steps = value
        case ActivityGoalsCodec.calories: next.calories = value / 1000
        case ActivityGoalsCodec.exercise: next.exerciseMinutes = value
        case ActivityGoalsCodec.stand: next.standHours = value
        case ActivityGoalsCodec.reminderStand: next.remindStand = value != 0
        case ActivityGoalsCodec.reminderProgress: next.remindProgress = value != 0
        case ActivityGoalsCodec.reminderGoalReached: next.remindGoalReached = value != 0
        default: return
        }
        if next == current { return }
        goals = next
        events.info("Goals: the watch changed config \(item.configId) to \(value); stored")
    }
}

extension ActivityGoalsData {
    /// `ActivityGoals` of HuaweiWearDiet.types.ts from the JS object. A missing field keeps its Huawei Health default (as the Android Record).
    public static func parse(_ raw: [String: Any]) throws -> ActivityGoalsData {
        func whole(_ key: String, _ fallback: Int) throws -> Int {
            guard let value = raw[key], !(value is NSNull) else { return fallback }
            switch value {
            case let i as Int: return i
            case let d as Double where abs(d) < 1e15: return Int(d)
            case let n as NSNumber: return n.intValue
            default: throw WearError(.invalidArgument, "\(key) must be a number")
            }
        }
        func bool(_ key: String) throws -> Bool {
            guard let value = raw[key], !(value is NSNull) else { return true }
            if let b = value as? Bool { return b }
            throw WearError(.invalidArgument, "\(key) must be true or false")
        }
        return ActivityGoalsData(
            steps: try whole("steps", ActivityGoalsData.defaultSteps), calories: try whole("calories", ActivityGoalsData.defaultCalories),
            exerciseMinutes: try whole("exerciseMinutes", ActivityGoalsData.defaultExerciseMinutes),
            standHours: try whole("standHours", ActivityGoalsData.defaultStandHours),
            remindStand: try bool("remindStand"), remindProgress: try bool("remindProgress"), remindGoalReached: try bool("remindGoalReached")
        )
    }
}

#endif

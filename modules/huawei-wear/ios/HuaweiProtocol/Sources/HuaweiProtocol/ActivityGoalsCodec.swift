// Port of ActivityGoals.kt's data and ActivityGoalsCodec: the activity-ring goals and reminders as DataSync configs. Layouts as Huawei Health
// 17.0.8.300 behaves on the wire and Gadgetbridge's HuaweiDataSyncGoals (ids, packages, the per-goal `01 time, 02 goal` data, calories as
// kcal x 1000). Kotlin-only logic, verified against the byte vectors of the Kotlin BodyAndGoalsTest. UNVERIFIED on the Fit 4 Pro.
import Foundation

/// The activity-ring goals and reminders (Settings, Goals & reminders). Defaults match Huawei Health's.
public struct ActivityGoalsData: Equatable, Sendable {
    public static let defaultSteps = 10_000
    public static let defaultCalories = 300
    public static let defaultExerciseMinutes = 30
    public static let defaultStandHours = 12

    public var steps: Int
    /// Active kilocalories; the watch takes kcal x 1000.
    public var calories: Int
    public var exerciseMinutes: Int
    public var standHours: Int
    public var remindStand: Bool
    public var remindProgress: Bool
    public var remindGoalReached: Bool

    public init(
        steps: Int = ActivityGoalsData.defaultSteps, calories: Int = ActivityGoalsData.defaultCalories,
        exerciseMinutes: Int = ActivityGoalsData.defaultExerciseMinutes, standHours: Int = ActivityGoalsData.defaultStandHours,
        remindStand: Bool = true, remindProgress: Bool = true, remindGoalReached: Bool = true
    ) {
        self.steps = steps
        self.calories = calories
        self.exerciseMinutes = exerciseMinutes
        self.standHours = standHours
        self.remindStand = remindStand
        self.remindProgress = remindProgress
        self.remindGoalReached = remindGoalReached
    }

    /// `ActivityGoals` in HuaweiWearDiet.types.ts.
    public func toJS() -> [String: Any] {
        [
            "steps": steps, "calories": calories, "exerciseMinutes": exerciseMinutes, "standHours": standHours,
            "remindStand": remindStand, "remindProgress": remindProgress, "remindGoalReached": remindGoalReached,
        ]
    }
}

/// Pure encoders, so the byte layouts can be tested without a link.
public enum ActivityGoalsCodec {
    public static let srcPkg = "hw.sport.config"
    public static let wearPkg = "in.huawei.motion"

    public static let bundle = 900_200_002
    public static let steps = 900_200_006
    public static let calories = 900_200_007
    public static let exercise = 900_200_008
    public static let stand = 900_200_009
    public static let reminderStand = 900_200_004
    public static let reminderProgress = 900_200_010
    public static let reminderGoalReached = 900_200_011

    private static func int32(_ v: Int) -> Int32 { Int32(truncatingIfNeeded: v) }

    /// As Huawei Health and GB sendCommonData do: `01 time int32 s, 02 goal int32`.
    public static func single(nowSec: Int, goal: Int) -> Bytes {
        var tlv = HuaweiTLV()
        tlv.put(0x01, int: int32(nowSec))
        tlv.put(0x02, int: int32(goal))
        return tlv.serialize()
    }

    /// Three-goal ring set: `01 time, 82{83{04 type, 05 value} x3}` with types 1 steps, 3 exercise minutes, 4 stand hours; type and value are
    /// minimal big-endian bytes.
    public static func bundle(nowSec: Int, steps: Int, exerciseMinutes: Int, standHours: Int) -> Bytes {
        var list = HuaweiTLV()
        for (type, value) in [(1, steps), (3, exerciseMinutes), (4, standHours)] {
            var entry = HuaweiTLV()
            entry.put(0x04, bytes: minimal(type))
            entry.put(0x05, bytes: minimal(value))
            list.put(0x83, tlv: entry)
        }
        var tlv = HuaweiTLV()
        tlv.put(0x01, int: int32(nowSec))
        tlv.put(0x82, tlv: list)
        return tlv.serialize()
    }

    /// The configs one full send consists of, in the order they are sent.
    public static func items(_ goals: ActivityGoalsData, nowSec: Int, nowMs: Int64) -> [ConfigItem] {
        func item(_ id: Int, _ data: Bytes) -> ConfigItem { ConfigItem(configId: id, action: 1, data: data, modifyMs: nowMs) }
        func flag(_ on: Bool) -> Bytes { single(nowSec: nowSec, goal: on ? 1 : 0) }
        return [
            item(steps, single(nowSec: nowSec, goal: goals.steps)),
            item(calories, single(nowSec: nowSec, goal: goals.calories * 1000)),
            item(exercise, single(nowSec: nowSec, goal: goals.exerciseMinutes)),
            item(stand, single(nowSec: nowSec, goal: goals.standHours)),
            item(bundle, bundle(nowSec: nowSec, steps: goals.steps, exerciseMinutes: goals.exerciseMinutes, standHours: goals.standHours)),
            item(reminderStand, flag(goals.remindStand)),
            item(reminderProgress, flag(goals.remindProgress)),
            item(reminderGoalReached, flag(goals.remindGoalReached)),
        ]
    }

    /// `HEXUtils.a(int)`: the value as big-endian bytes, as few as it takes (at least one).
    public static func minimal(_ value: Int) -> Bytes {
        let v = UInt32(truncatingIfNeeded: value)
        var out = Bytes()
        var started = false
        for shift in [UInt32(24), 16, 8, 0] {
            let b = UInt8((v >> shift) & 0xFF)
            if b != 0 || started || shift == 0 {
                out.append(b)
                started = true
            }
        }
        return out
    }

    public static func validate(_ goals: ActivityGoalsData) throws {
        func bad(_ what: String) -> WearError { WearError(.invalidArgument, what) }
        if !(1000...100_000).contains(goals.steps) { throw bad("Steps goal must be 1000 to 100000") }
        if !(50...10_000).contains(goals.calories) { throw bad("Calories goal must be 50 to 10000 kcal") }
        if !(1...600).contains(goals.exerciseMinutes) { throw bad("Exercise goal must be 1 to 600 minutes") }
        if !(1...24).contains(goals.standHours) { throw bad("Stand goal must be 1 to 24 hours") }
    }
}

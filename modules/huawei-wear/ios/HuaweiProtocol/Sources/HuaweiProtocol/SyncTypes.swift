// What a sync produces. Mirrors the Android ActivitySync.kt / SleepSync.kt result classes.
import Foundation

public struct StepSample: Equatable, Sendable {
    public let timestamp: Int64
    public let steps: Int
    /// Small calories (cal, 1/1000 kcal), as the watch's step frames count them.
    public let calories: Int
    public let distance: Int
    public let heartRate: Int?
    public let spo2: Int?
    public let restingHeartRate: Int?

    public init(timestamp: Int64, steps: Int, calories: Int, distance: Int, heartRate: Int?, spo2: Int?, restingHeartRate: Int?) {
        self.timestamp = timestamp
        self.steps = steps
        self.calories = calories
        self.distance = distance
        self.heartRate = heartRate
        self.spo2 = spo2
        self.restingHeartRate = restingHeartRate
    }
}

/// One sleep span. `type` is GB's raw sample kind (frame sleep: the watch's state byte; TruSleep and dictionary sleep: 0x06 light,
/// 0x07 deep, 0x5656 REM, 0x5658 awake, 0x5659 nap, 1 unknown). `stage` is `light`, `deep`, `rem` or `awake`; nil when GB has none.
/// `breakBefore` is set only by `SleepCleaning.cleanUnstagedSleep` (never stored): a workout or a long awake stretch lies between this segment
/// and the one before it, so it starts a new session however close the two are. `afterWorkout` says it was a workout (an evening doze does
/// not join across one, see `SleepReport.joinsEveningDoze`).
public struct SleepSegment: Equatable, Sendable {
    public let start: Int64
    public let end: Int64
    public let type: Int
    public let stage: String?
    public let breakBefore: Bool
    public let afterWorkout: Bool

    public init(start: Int64, end: Int64, type: Int, stage: String?, breakBefore: Bool = false, afterWorkout: Bool = false) {
        self.start = start
        self.end = end
        self.type = type
        self.stage = stage
        self.breakBefore = breakBefore
        self.afterWorkout = afterWorkout
    }
}

/// The watch's own score for one night (dictionary sleep only). `start` is the time the stages start from, `end` the wake-up time.
public struct SleepScore: Equatable, Sendable {
    public let start: Int64
    public let end: Int64
    public let score: Int
    public let efficiency: Int?

    public init(start: Int64, end: Int64, score: Int, efficiency: Int?) {
        self.start = start
        self.end = end
        self.score = score
        self.efficiency = efficiency
    }
}

public struct SleepDownload: Equatable, Sendable {
    public let segments: [SleepSegment]
    public let scores: [SleepScore]

    public init(segments: [SleepSegment], scores: [SleepScore]) {
        self.segments = segments
        self.scores = scores
    }

    public static let empty = SleepDownload(segments: [], scores: [])
}

public struct SyncResult: Equatable, Sendable {
    public let from: Int64
    public let to: Int64
    public let samples: [StepSample]
    public let sleep: [SleepSegment]
    public let totalSteps: Int
    /// kcal.
    public let totalCalories: Int
    public let totalDistance: Int
    public let sleepScores: [SleepScore]

    public init(from: Int64, to: Int64, samples: [StepSample], sleep: [SleepSegment], totalSteps: Int, totalCalories: Int, totalDistance: Int, sleepScores: [SleepScore] = []) {
        self.from = from
        self.to = to
        self.samples = samples
        self.sleep = sleep
        self.totalSteps = totalSteps
        self.totalCalories = totalCalories
        self.totalDistance = totalDistance
        self.sleepScores = sleepScores
    }
}

/// Timeouts the Kotlin `Timeouts` object defines, in milliseconds.
public enum Timeouts {
    public static let connectMs = 20_000
    public static let authMs = 10_000
    public static let firstAuthMs = 30_000
    public static let hichainAuthFirstStepMs = 5_000
    public static let hichainAuthStepMs = 10_000
    public static let initMs = 2_000
    public static let queryMs = 5_000
    public static let syncCountMs = 10_000
    public static let syncDataMs = 15_000
}

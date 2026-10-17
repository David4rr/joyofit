// The pure part of the Apple Health history import (AppleHealthImporter.swift reads HealthKit and calls these): which samples are skipped,
// how HealthKit values become the rows `SqliteHuaweiImportStore` writes, and how the history is cut into windows. No HealthKit here, so the
// logic tests run on Linux.
//
// Huawei Health on iPhone writes the user's history into Apple Health; the import reads it once and stores it with `imported = 1`, the same
// rows and the same rules as the Huawei export import (HuaweiImportStore.swift): watch data wins, nothing is overwritten, a second run adds nothing.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public enum AppleHealthPlan {
    /// Prefix of the `HKMetadataKeySyncIdentifier` of every sample JoyoFit writes (HealthKitWriter), so exported data never comes back in.
    public static let ownSyncPrefix = "joyofit:"

    /// The history is read in windows this long, so memory stays bounded however many years there are.
    public static let windowSec: Int64 = 7 * 24 * 3600

    /// A sample JoyoFit wrote itself: its source is this app, or it carries one of this app's sync identifiers.
    public static func isOwnSample(sourceBundleId: String?, ownBundleId: String?, syncIdentifier: String?) -> Bool {
        if let own = ownBundleId, let source = sourceBundleId, source == own { return true }
        if let id = syncIdentifier, id.hasPrefix(ownSyncPrefix) { return true }
        return false
    }

    public static func minuteOf(_ sec: Int64) -> Int64 { sec - ((sec % 60) + 60) % 60 }

    /// Consecutive `[from, to)` windows from `fromSec` up to `toSec`, oldest first; at least one.
    public static func windows(fromSec: Int64, toSec: Int64) -> [(from: Int64, to: Int64)] {
        var result = [(from: Int64, to: Int64)]()
        var start = fromSec
        while start < toSec {
            let end = min(start + windowSec, toSec)
            result.append((from: start, to: end))
            start = end
        }
        if result.isEmpty { result.append((from: fromSec, to: toSec)) }
        return result
    }

    public static func plausibleHeartRate(_ bpm: Double) -> Int? {
        let rounded = Int(bpm.rounded())
        return (20...250).contains(rounded) ? rounded : nil
    }

    /// HealthKit stores oxygen saturation as a fraction (0.97); the database holds percent.
    public static func spo2Percent(fraction: Double) -> Int? {
        let percent = Int((fraction * 100).rounded())
        return (50...100).contains(percent) ? percent : nil
    }

    /// `HKCategoryValueSleepAnalysis` raw value to the raw kind and stage name `sleep_segments` holds (see `SleepSync`): in bed has no stage
    /// and is skipped, "asleep" without a stage and core sleep are light sleep.
    public static func sleepKind(healthKitValue: Int) -> (type: Int, stage: String)? {
        switch healthKitValue {
        case 1, 3: return (0x06, "light")
        case 2: return (0x5658, "awake")
        case 4: return (0x07, "deep")
        case 5: return (0x5656, "rem")
        default: return nil
        }
    }

    public static func sleepSegment(startSec: Int64, endSec: Int64, healthKitValue: Int) -> ImportedSleep? {
        guard endSec > startSec, let kind = sleepKind(healthKitValue: healthKitValue) else { return nil }
        return ImportedSleep(start: startSec, end: endSec, type: kind.type, stage: kind.stage)
    }
}

/// What one window of Apple Health readings becomes: one `ImportedMinute` per minute that has data. Steps add up, heart rate is the mean of
/// the minute, resting heart rate and SpO2 keep the last reading.
public struct AppleHealthMinutes {
    private var minutes = [Int64: ImportedMinute]()
    private var heartSum = [Int64: (sum: Int, count: Int)]()

    public init() {}

    private mutating func minute(_ tsSec: Int64) -> ImportedMinute {
        let key = AppleHealthPlan.minuteOf(tsSec)
        if let existing = minutes[key] { return existing }
        let created = ImportedMinute(key)
        minutes[key] = created
        return created
    }

    public mutating func steps(atSec: Int64, count: Double) {
        let n = Int(count.rounded())
        if n > 0 { minute(atSec).steps += n }
    }

    /// Returns false when the reading is implausible.
    @discardableResult
    public mutating func heartRate(atSec: Int64, bpm: Double) -> Bool {
        guard let value = AppleHealthPlan.plausibleHeartRate(bpm) else { return false }
        let key = AppleHealthPlan.minuteOf(atSec)
        _ = minute(atSec)
        let current = heartSum[key] ?? (sum: 0, count: 0)
        heartSum[key] = (sum: current.sum + value, count: current.count + 1)
        return true
    }

    @discardableResult
    public mutating func restingHeartRate(atSec: Int64, bpm: Double) -> Bool {
        guard let value = AppleHealthPlan.plausibleHeartRate(bpm) else { return false }
        minute(atSec).restingHeartRate = value
        return true
    }

    @discardableResult
    public mutating func spo2(atSec: Int64, fraction: Double) -> Bool {
        guard let value = AppleHealthPlan.spo2Percent(fraction: fraction) else { return false }
        minute(atSec).spo2 = value
        return true
    }

    public var isEmpty: Bool { minutes.isEmpty }

    /// The minutes, oldest first, with the mean heart rate filled in.
    public func rows() -> [ImportedMinute] {
        for (key, heart) in heartSum {
            if let row = minutes[key] { row.heartRate = Int((Double(heart.sum) / Double(heart.count)).rounded()) }
        }
        return minutes.keys.sorted().compactMap { minutes[$0] }
    }
}

/// HealthKit's workout activity to the sport type byte JoyoFit stores (`WorkoutSportTypes`); everything else is the catch-all workout.
public enum AppleHealthSports {
    public static let other = 255

    /// `key` is the case name of `HKWorkoutActivityType` (see `AppleHealthImporter.activityKey`).
    public static func sportType(key: String) -> Int {
        switch key {
        case "running": return 1
        case "walking": return 2
        case "cycling": return 3
        case "hiking": return 14
        case "swimming": return 6
        case "elliptical": return 134
        case "rowing": return 135
        case "stairClimbing": return 136
        case "yoga": return 137
        case "pilates": return 138
        case "functionalStrengthTraining", "traditionalStrengthTraining": return 140
        case "highIntensityIntervalTraining": return 143
        case "crossTraining": return 145
        case "boxing": return 149
        case "tennis": return 130
        case "badminton": return 129
        case "soccer": return 131
        case "basketball": return 132
        case "volleyball": return 133
        case "tableTennis": return 128
        default: return other
        }
    }

    public static func name(_ sportType: Int) -> String {
        sportType == other ? "Workout" : WorkoutSportTypes.name(sportType)
    }
}

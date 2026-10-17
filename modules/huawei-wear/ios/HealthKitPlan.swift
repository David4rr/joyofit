// Pure planning for the HealthKit export: turns stored watch rows into the samples that are written, without touching HealthKit so it runs in
// the logic tests on Linux. Port of HealthConnectPlan.kt (and HealthConnectExercise.kt for the sport table).
//
// Units, from Gadgetbridge's reading of the step frames (`GetStepDataRequest` stores the values unchanged):
//  - `steps`: steps in that minute,
//  - `distance`: metres in that minute,
//  - `calories`: small calories (cal, 1/1000 kcal) in that minute; the Android exporter writes them with `Energy.calories`, and HealthKit has
//    the same unit (`HKUnit.smallCalorie()`), so the value goes through unchanged.
//
// Every sample has a stable id (`joyofit:<kind>:<key>`), written as HKMetadataKeySyncIdentifier together with an increasing
// HKMetadataKeySyncVersion, so writing the same window again REPLACES the earlier sample instead of adding a second one, the way the Health
// Connect client record id and version do.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

/// The record types the export writes; the raw values are the names JS sees in `HealthConnectStatus.granted` / `missing`.
public enum HealthRecordType: String, CaseIterable, Sendable {
    case steps = "Steps"
    case heartRate = "HeartRate"
    case oxygenSaturation = "OxygenSaturation"
    case restingHeartRate = "RestingHeartRate"
    case distance = "Distance"
    case activeCaloriesBurned = "ActiveCaloriesBurned"
    case sleepSession = "SleepSession"
    case exerciseSession = "ExerciseSession"
}

/// What one export wrote, in samples. `toJS` is `HealthConnectExportResult` in HuaweiWear.types.ts.
public struct HealthExportCounts: Equatable, Sendable {
    public var steps = 0
    public var distance = 0
    public var calories = 0
    public var heartRate = 0
    public var spo2 = 0
    public var restingHeartRate = 0
    public var sleep = 0
    public var workouts = 0

    public init() {}

    public var total: Int { steps + distance + calories + heartRate + spo2 + restingHeartRate + sleep + workouts }

    public func toJS() -> [String: Any] {
        [
            "steps": steps, "distance": distance, "calories": calories, "heartRate": heartRate, "spo2": spo2,
            "restingHeartRate": restingHeartRate, "sleep": sleep, "workouts": workouts,
        ]
    }

    public var description: String {
        "steps=\(steps) distance=\(distance) calories=\(calories) hr=\(heartRate) spo2=\(spo2) restingHr=\(restingHeartRate) sleep=\(sleep) workouts=\(workouts)"
    }
}

/// HealthKit's sleep stage values (`HKCategoryValueSleepAnalysis`), as the raw numbers Apple defines.
public enum SleepStageKind: Int, Sendable {
    case sleeping
    case light
    case deep
    case rem
    case awake

    /// `HKCategoryValueSleepAnalysis`: 0 inBed, 1 asleepUnspecified, 2 awake, 3 asleepCore, 4 asleepDeep, 5 asleepREM. The exporter checks
    /// these numbers against the framework's own enum.
    public var healthKitValue: Int {
        switch self {
        case .sleeping: return 1
        case .light: return 3
        case .deep: return 4
        case .rem: return 5
        case .awake: return 2
        }
    }
}

/// Health Connect's exercise types, which is what the Android sport table maps to; the HealthKit writer maps each to an `HKWorkoutActivityType`.
public enum WorkoutKind: String, Sendable {
    case running, walking, biking, hiking, runningTreadmill, swimmingPool, bikingStationary, swimmingOpenWater, scubaDiving
    case tableTennis, badminton, tennis, soccer, basketball, volleyball, elliptical, rowingMachine, stairClimbingMachine
    case yoga, pilates, exerciseClass, strengthTraining, highIntensityIntervalTraining, calisthenics, martialArts, boxing
    case fencing, dancing, gymnastics, rollerHockey, frisbeeDisc, stairClimbing, handball, baseball, softball, cricket, rugby
    case iceHockey, squash, sailing, surfing, paddling, rowing, iceSkating, skating, rockClimbing, paragliding, otherWorkout
}

public enum HealthKitPlan {
    public static let idPrefix = "joyofit"

    /// A sample's timestamp is the start of its minute.
    public static let sampleSpanSec: Int64 = 60

    /// An hour of heart-rate readings is loaded together, so a re-written hour never loses its earlier minutes.
    public static let heartSeriesSec: Int64 = 3600

    public static let minBpm = 1
    public static let maxBpm = 300

    /// Sleep spans separated by more than this are different sessions (a nap vs the night).
    public static let sleepSessionGapSec: Int64 = 60 * 60

    /// Segments closer together than this belong to the same session (`SESSION_GAP_SEC` in src/features/today/stats.ts).
    public static let sessionGapSec: Int64 = 3 * 3600

    /// One value over [startSec, endSec).
    public struct Interval: Equatable, Sendable {
        public let id: String
        public let startSec: Int64
        public let endSec: Int64
        public let value: Int64
    }

    public struct Point: Equatable, Sendable {
        public let timeSec: Int64
        public let value: Int
    }

    public struct SleepStagePlan: Equatable, Sendable {
        public let startSec: Int64
        public let endSec: Int64
        public let stage: SleepStageKind
    }

    public struct SleepPlan: Equatable, Sendable {
        public let id: String
        public let startSec: Int64
        public let endSec: Int64
        public let stages: [SleepStagePlan]
    }

    public static func id(_ kind: String, _ key: Any) -> String { "\(idPrefix):\(kind):\(key)" }

    /// Per-minute steps for samples at or after `fromSec`; zero minutes are skipped.
    public static func steps(_ samples: [StepSample], fromSec: Int64) -> [Interval] {
        intervals("steps", samples, fromSec) { Int64($0.steps) }
    }

    /// Per-minute distance in metres.
    public static func distance(_ samples: [StepSample], fromSec: Int64) -> [Interval] {
        intervals("distance", samples, fromSec) { Int64($0.distance) }
    }

    /// Per-minute active energy in small calories (cal).
    public static func calories(_ samples: [StepSample], fromSec: Int64) -> [Interval] {
        intervals("calories", samples, fromSec) { Int64($0.calories) }
    }

    private static func intervals(_ kind: String, _ samples: [StepSample], _ fromSec: Int64, _ value: (StepSample) -> Int64) -> [Interval] {
        samples.compactMap { s in
            let v = value(s)
            if s.timestamp < fromSec || v <= 0 { return nil }
            return Interval(id: id(kind, s.timestamp), startSec: s.timestamp, endSec: s.timestamp + sampleSpanSec, value: v)
        }
    }

    /// Heart-rate readings in the valid range, one instantaneous HealthKit sample each (HealthKit has no per-hour series record to replace),
    /// from `fromSec` on. The id is the reading's minute.
    public static func heartRate(_ samples: [StepSample], fromSec: Int64) -> [Point] {
        samples
            .filter { s in s.timestamp >= fromSec && (minBpm...maxBpm).contains(s.heartRate ?? 0) }
            .sorted { $0.timestamp < $1.timestamp }
            .map { Point(timeSec: $0.timestamp, value: $0.heartRate!) }
    }

    /// Instantaneous SpO2 readings (percent) at or after `fromSec`.
    public static func spo2(_ samples: [StepSample], fromSec: Int64) -> [Point] {
        samples.compactMap { s in
            guard let v = s.spo2, s.timestamp >= fromSec, (1...100).contains(v) else { return nil }
            return Point(timeSec: s.timestamp, value: v)
        }
    }

    /// The latest resting heart rate of each day, keyed by the day's index from `dayOf` (the caller supplies the local-calendar day of a
    /// timestamp). Id and time are those of the latest reading.
    public static func restingHeartRate(_ samples: [StepSample], fromSec: Int64, dayOf: (Int64) -> String) -> [(String, Point)] {
        var order = [String]()
        var latest = [String: Point]()
        for s in samples.sorted(by: { $0.timestamp < $1.timestamp }) {
            guard let v = s.restingHeartRate, s.timestamp >= fromSec, (minBpm...maxBpm).contains(v) else { continue }
            let day = dayOf(s.timestamp)
            if latest[day] == nil { order.append(day) }
            latest[day] = Point(timeSec: s.timestamp, value: v)
        }
        return order.map { (id("rhr", $0), latest[$0]!) }
    }

    public static func stageKind(_ stage: String?) -> SleepStageKind {
        switch stage {
        case "light": return .light
        case "deep": return .deep
        case "rem": return .rem
        case "awake": return .awake
        default: return .sleeping
        }
    }

    /// `withoutStrayUnstaged` (SleepReport.kt): drops unstaged segments that lie within `sessionGapSec` of a staged one. The watch stores
    /// short unstaged spans around a staged night; next to real stages they only stretch the night. An unstaged nap far from any staged
    /// sleep stays.
    public static func withoutStrayUnstaged(_ segments: [SleepSegment]) -> [SleepSegment] {
        let staged = segments.filter { $0.stage != nil }
        return segments.filter { s in
            s.stage != nil || !staged.contains { t in t.start - s.end <= sessionGapSec && s.start - t.end <= sessionGapSec }
        }
    }

    /// Sleep within this of other sleep belongs to the same stretch when telling a blip from a nap (`BLIP_GAP_SEC` in stats.ts).
    public static let blipGapSec: Int64 = 3600
    /// A stretch with less sleep than this (awake excluded) is not sleep, e.g. a 1-minute HRV check (`MIN_SLEEP_SEC` in stats.ts).
    public static let minSleepSec: Int64 = 20 * 60

    /// `withoutBlips` (SleepReport.kt): drops stretches of sleep (gaps up to `blipGapSec`) holding less than `minSleepSec` asleep, the
    /// few still minutes of an HRV or stress check the watch records as sleep. Returns the kept segments sorted by start.
    public static func withoutBlips(_ segments: [SleepSegment]) -> [SleepSegment] {
        var kept = [SleepSegment]()
        var stretch = [SleepSegment]()
        var reach = Int64.min
        func close() {
            let asleep = stretch.reduce(Int64(0)) { $0 + ($1.stage == "awake" ? 0 : max(0, $1.end - $1.start)) }
            if asleep >= minSleepSec { kept.append(contentsOf: stretch) }
            stretch.removeAll()
        }
        for s in segments.sorted(by: { ($0.start, $0.end) < ($1.start, $1.end) }) {
            if !stretch.isEmpty && s.start - reach > blipGapSec { close() }
            reach = stretch.isEmpty ? s.end : max(reach, s.end)
            stretch.append(s)
        }
        close()
        return kept
    }

    /// Groups sleep spans into sessions (a gap over `sleepSessionGapSec` starts a new one) and turns each into ordered, non-overlapping stages.
    /// Where spans overlap, the earlier-starting one keeps the time. Sessions that end before `fromSec` are left out, so a window can reach back
    /// far enough to see a whole night without rewriting older ones.
    public static func sleepSessions(_ segments: [SleepSegment], fromSec: Int64) -> [SleepPlan] {
        var sessions = [SleepPlan]()
        var stages = [SleepStagePlan]()
        var cursor = Int64.min

        func close() {
            guard let first = stages.first, let last = stages.last else { return }
            if last.endSec >= fromSec { sessions.append(SleepPlan(id: id("sleep", first.startSec), startSec: first.startSec, endSec: last.endSec, stages: stages)) }
            stages = []
        }

        let sorted = withoutBlips(withoutStrayUnstaged(segments))
        for s in sorted {
            if s.end <= s.start { continue }
            if !stages.isEmpty && s.start - cursor > sleepSessionGapSec { close() }
            let start = stages.isEmpty ? s.start : max(s.start, cursor)
            if s.end <= start { continue }
            let kind = stageKind(s.stage)
            if let last = stages.last, last.stage == kind, last.endSec == start {
                stages[stages.count - 1] = SleepStagePlan(startSec: last.startSec, endSec: s.end, stage: kind)
            } else {
                stages.append(SleepStagePlan(startSec: start, endSec: s.end, stage: kind))
            }
            cursor = s.end
        }
        close()
        return sessions
    }

    /// Huawei sport type (the type byte of the workout summary) to the exercise type the Android exporter picks. The numbers are
    /// `HuaweiWorkoutGbParser.HuaweiActivityType` of Gadgetbridge; sports with no type become `otherWorkout`.
    public static func workoutKind(huaweiType: Int) -> WorkoutKind {
        switch huaweiType & 0xFF {
        case 1, 11: return .running
        case 2: return .walking
        case 3, 213: return .biking
        case 4, 14: return .hiking
        case 5: return .runningTreadmill
        case 6: return .swimmingPool
        case 7, 141: return .bikingStationary
        case 8: return .swimmingOpenWater
        case 13: return .walking
        case 25: return .scubaDiving
        case 128: return .tableTennis
        case 129, 181: return .badminton
        case 130: return .tennis
        case 131, 187: return .soccer
        case 132: return .basketball
        case 133, 188: return .volleyball
        case 134, 142: return .elliptical
        case 135: return .rowingMachine
        case 136: return .stairClimbingMachine
        case 137: return .yoga
        case 138: return .pilates
        case 139: return .exerciseClass
        case 140: return .strengthTraining
        case 143: return .highIntensityIntervalTraining
        case 145, 146, 147, 157: return .calisthenics
        case 148, 151, 159, 164, 166: return .martialArts
        case 149, 150, 158: return .boxing
        case 152: return .fencing
        case 153, 154, 155, 156, 162, 165, 167: return .dancing
        case 160, 161: return .gymnastics
        case 163: return .rollerHockey
        case 169: return .frisbeeDisc
        case 177: return .stairClimbing
        case 182: return .handball
        case 183: return .baseball
        case 184: return .softball
        case 185: return .cricket
        case 186: return .rugby
        case 204: return .iceHockey
        case 191: return .squash
        case 194: return .sailing
        case 195: return .surfing
        case 197, 198, 199, 202: return .paddling
        case 200: return .rowing
        case 203: return .iceSkating
        case 209: return .skating
        case 210: return .rockClimbing
        case 215: return .paragliding
        default: return .otherWorkout
        }
    }
}

/// A completed workout as stored in the `workouts` table. `hrPoints` and `routePoints` count its stored `workout_points` with a heart rate
/// and with a position, so a workout that gains a route or a heart-rate series after it was exported is exported again.
public struct WorkoutRow: Equatable, Sendable {
    public let start: Int64
    public let end: Int64
    public let sportType: Int
    public let name: String?
    public let distance: Int?
    public let calories: Int?
    public let avgHr: Int?
    public let maxHr: Int?
    public let hrPoints: Int
    public let routePoints: Int

    public init(
        start: Int64, end: Int64, sportType: Int, name: String?, distance: Int?, calories: Int?, avgHr: Int?, maxHr: Int?, hrPoints: Int = 0, routePoints: Int = 0
    ) {
        self.start = start
        self.end = end
        self.sportType = sportType
        self.name = name
        self.distance = distance
        self.calories = calories
        self.avgHr = avgHr
        self.maxHr = maxHr
        self.hrPoints = hrPoints
        self.routePoints = routePoints
    }

    /// `start|end|calories|distance` of a workout (plus `|h<n>` / `|r<n>` for its heart-rate and route points), so each is exported once and
    /// again only if it changes.
    public var signature: String {
        var s = "\(start)|\(end)|\(calories ?? 0)|\(distance ?? 0)"
        if hrPoints > 0 { s += "|h\(hrPoints)" }
        if routePoints > 0 { s += "|r\(routePoints)" }
        return s
    }

    public func notes() -> String? {
        var parts = [String]()
        if let d = distance, d > 0 { parts.append(String(format: "%.2f km", Double(d) / 1000.0)) }
        if let c = calories, c > 0 { parts.append("\(c) kcal") }
        if let a = avgHr, a > 0 { parts.append("avg HR \(a)") }
        if let m = maxHr, m > 0 { parts.append("max HR \(m)") }
        return parts.isEmpty ? nil : "JoyoFit: " + parts.joined(separator: ", ")
    }
}

/// HealthKit's per-type write authorization (`HKAuthorizationStatus`), as the plan needs to reason about it.
public enum HealthAuthStatus: Sendable {
    case notDetermined, denied, authorized
}

/// One heart-rate reading attached to a workout, written under `id`.
public struct WorkoutHeartReading: Equatable, Sendable {
    public let id: String
    public let timeSec: Int64
    public let bpm: Int
}

/// One position of a workout's route.
public struct WorkoutRoutePoint: Equatable, Sendable {
    public let timeSec: Int64
    public let latitude: Double
    public let longitude: Double
    /// Metres; nil when the watch gave none or a value that cannot be an altitude.
    public let altitude: Double?
}

/// Everything written for one workout: the session, the heart-rate readings attached to it and the GPS route. Every part carries an id built
/// from the workout's start, so writing the workout again replaces it.
public struct WorkoutPlan: Equatable, Sendable {
    public let id: String
    public let start: Int64
    public let end: Int64
    public let sportType: Int
    public let kind: WorkoutKind
    public let name: String?
    public let notes: String?
    /// Readings inside the workout.
    public let heartRate: [WorkoutHeartReading]
    public let route: [WorkoutRoutePoint]
    public let routeId: String

    /// The same workout without its heart-rate readings (the user did not allow writing heart rate).
    public func withoutHeartRate() -> WorkoutPlan {
        WorkoutPlan(id: id, start: start, end: end, sportType: sportType, kind: kind, name: name, notes: notes, heartRate: [], route: route, routeId: routeId)
    }
}

extension HealthKitPlan {
    /// A route needs at least this many positions to be a route.
    public static let minRoutePoints = 2

    /// Positions further than this outside the workout's own span are garbage (a garbled GPS file), not part of the route.
    public static let routeSlackSec: Int64 = 300

    /// Metres: the range the altitude of a position can have; anything else is a broken reading (modern watches send absent or broken GPS
    /// altitudes, see HuaweiGpsParser).
    public static let altitudeRange: ClosedRange<Double> = -500...9_000

    /// Oldest first; points of the same second keep their stored order.
    private static func byTime(_ points: [WorkoutPoint]) -> [WorkoutPoint] {
        points.enumerated().sorted { a, b in a.element.ts != b.element.ts ? a.element.ts < b.element.ts : a.offset < b.offset }.map { $0.element }
    }

    /// The workout's heart-rate readings: valid values inside [start, end], one per second at most (the first wins), oldest first.
    public static func workoutHeartRate(_ points: [WorkoutPoint], start: Int64, end: Int64) -> [WorkoutHeartReading] {
        var seen = Set<Int64>()
        var out = [WorkoutHeartReading]()
        for p in byTime(points) {
            guard let hr = p.hr, (minBpm...maxBpm).contains(hr), p.ts >= start, p.ts <= end, seen.insert(p.ts).inserted else { continue }
            out.append(WorkoutHeartReading(id: id("workout-hr", "\(start):\(p.ts)"), timeSec: p.ts, bpm: hr))
        }
        return out
    }

    /// The GPS route: valid positions within `routeSlackSec` of the workout, oldest first, one per second at most. Empty when fewer than
    /// `minRoutePoints` remain.
    public static func workoutRoute(_ points: [WorkoutPoint], start: Int64, end: Int64) -> [WorkoutRoutePoint] {
        var seen = Set<Int64>()
        var out = [WorkoutRoutePoint]()
        for p in byTime(points) {
            guard let lat = p.lat, let lon = p.lon, lat.isFinite, lon.isFinite, (-90.0...90.0).contains(lat), (-180.0...180.0).contains(lon),
                  p.ts >= start - routeSlackSec, p.ts <= end + routeSlackSec, seen.insert(p.ts).inserted else { continue }
            let altitude = p.alt.flatMap { altitudeRange.contains($0) ? $0 : nil }
            out.append(WorkoutRoutePoint(timeSec: p.ts, latitude: lat, longitude: lon, altitude: altitude))
        }
        return out.count >= minRoutePoints ? out : []
    }

    public static func workoutPlan(_ row: WorkoutRow, points: [WorkoutPoint]) -> WorkoutPlan {
        WorkoutPlan(
            id: id("workout", row.start), start: row.start, end: row.end, sportType: row.sportType, kind: workoutKind(huaweiType: row.sportType),
            name: row.name, notes: row.notes(), heartRate: workoutHeartRate(points, start: row.start, end: row.end),
            route: workoutRoute(points, start: row.start, end: row.end), routeId: id("workout-route", row.start)
        )
    }

    /// The ExerciseSession record type stands for workouts and their routes: it is granted once workouts may be written and the user has
    /// decided about routes (allowed or not), so a route type that was never asked shows as missing and "Allow more types" asks for it. A
    /// workout is written without its route when the route was declined.
    public static func exerciseSessionGranted(workout: HealthAuthStatus, route: HealthAuthStatus) -> Bool {
        workout == .authorized && route != .notDetermined
    }
}

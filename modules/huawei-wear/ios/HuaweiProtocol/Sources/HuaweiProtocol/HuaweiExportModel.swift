// Port of HuaweiExportModel.kt: what the parsers of a Huawei export hand to the importer and what the importer hands to the database.
import Foundation

/// One minute of `step_samples` assembled from the export; every field but `ts` is optional data.
public final class ImportedMinute {
    public let ts: Int64
    public var steps = 0
    public var distance = 0
    public var heartRate: Int?
    public var spo2: Int?
    public var restingHeartRate: Int?

    public init(_ ts: Int64) { self.ts = ts }
}

/// A `sleep_segments` row: `type` is the raw kind the watch uses (see `SleepSync`), `stage` its stage name.
public struct ImportedSleep: Equatable {
    public let start: Int64
    public let end: Int64
    public let type: Int
    public let stage: String?

    public init(start: Int64, end: Int64, type: Int, stage: String?) {
        self.start = start
        self.end = end
        self.type = type
        self.stage = stage
    }
}

/// One stress reading for `health_metrics`.
public struct ImportedStress: Equatable {
    public let ts: Int64
    public let score: Int

    public init(ts: Int64, score: Int) {
        self.ts = ts
        self.score = score
    }
}

/// A `workouts` row with its `workout_points`. Times are unix seconds, distance metres, calories kcal.
public struct ImportedWorkout {
    public let start: Int64
    public let end: Int64
    public let sportType: Int
    public let sportName: String
    public let duration: Int
    public let distance: Int
    public let calories: Int
    public let steps: Int
    public let avgHr: Int?
    public let maxHr: Int?
    public let summaryJson: String
    public let points: [WorkoutPoint]
}

/// What the parsers hand over. Timestamps are unix seconds.
public protocol HuaweiImportCollector: AnyObject {
    func heartRate(tsSec: Int64, bpm: Int)
    func restingHeartRate(tsSec: Int64, bpm: Int)
    func spo2(tsSec: Int64, percent: Int)
    func sleep(_ segment: ImportedSleep)
    func stress(_ point: ImportedStress)
    func steps(minuteSec: Int64, steps: Int, distance: Int)
    /// A sample point whose key the importer does not use.
    func unmapped(key: String)
    /// A sample point of a known key whose value is missing or implausible.
    func rejected()
}

/// Result of writing one workout.
public struct WorkoutWrite: Equatable {
    public let added: Bool
    public let points: Int

    public init(added: Bool, points: Int) {
        self.added = added
        self.points = points
    }
}

/// Where the importer writes. Every method is insert-or-ignore in spirit: watch data already in the database is never overwritten, and
/// importing the same export twice changes nothing the second time. See `SqliteHuaweiImportStore`. A throwing store ends the import.
public protocol HuaweiImportStore: AnyObject {
    /// Merges minutes into `step_samples`; returns the rows inserted or filled in.
    func writeMinutes(_ rows: [ImportedMinute]) throws -> Int
    /// Adds sleep segments that no watch-synced segment overlaps; returns the rows added.
    func writeSleep(_ segments: [ImportedSleep]) throws -> Int
    /// Adds stress readings; returns the rows added.
    func writeStress(_ points: [ImportedStress]) throws -> Int
    /// Adds the workout unless the database already has one starting within two minutes of it.
    func writeWorkout(_ workout: ImportedWorkout) throws -> WorkoutWrite
}

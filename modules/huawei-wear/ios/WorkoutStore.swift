// Writes workouts into the shared database (`workouts`, `workout_points`; migration 3 in schema/joyofit-db-migrations.json) through SyncStore's
// connection, and runs the workout phase of the activity sync. Port of WorkoutStore.kt and WearLink.syncWorkouts. A workout is replaced as a
// whole in one transaction: the row is upserted by `start` (the id stays), its old points are deleted and the new ones inserted.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class WorkoutStore: WorkoutSink {
    /// GB HuaweiWorkoutSyncManager.getStartTimeFromDb fallback: 2022-06-10 00:00:00 UTC.
    public static let defaultStartSec: Int64 = 1_654_819_200
    /// A full-history pull starts here (2000-01-01, the Kotlin `DEFAULT_START_SEC`): everything the watch still holds.
    public static let fullHistoryStartSec: Int64 = 946_684_800

    private let store: SyncStore

    public init(_ store: SyncStore) {
        self.store = store
    }

    public func isComplete(start: Int64, end: Int64) throws -> Bool {
        try store.read { db in
            try !db.query("SELECT 1 FROM workouts WHERE start = ? AND end = ? AND complete = 1", [.int(start), .int(end)]) { _ in true }.isEmpty
        }
    }

    public func save(_ record: WorkoutRecord) throws -> Bool {
        try store.read { db in
            try db.transaction {
                let wasComplete: Bool? = try db.query("SELECT complete FROM workouts WHERE start = ?", [.int(record.start)]) { $0.int(0) == 1 }.first
                try db.run(
                    """
                    INSERT INTO workouts
                      (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(start) DO UPDATE SET
                      workout_number = excluded.workout_number,
                      end = excluded.end,
                      sport_type = excluded.sport_type,
                      sport_name = excluded.sport_name,
                      duration = excluded.duration,
                      distance = excluded.distance,
                      calories = excluded.calories,
                      avg_hr = excluded.avg_hr,
                      max_hr = excluded.max_hr,
                      steps = excluded.steps,
                      summary_json = excluded.summary_json,
                      complete = excluded.complete,
                      imported = 0
                    """,
                    [
                        .int(Int64(record.number)), .int(record.start), .int(record.end), .int(Int64(record.sportType)), .text(record.sportName),
                        .int(Int64(record.duration)), .int(Int64(record.distance)), .int(Int64(record.calories)), .integer(record.avgHr),
                        .integer(record.maxHr), .int(Int64(record.steps)), .text(record.summaryJson), .int(record.complete ? 1 : 0),
                    ]
                )
                guard let id = try db.query("SELECT id FROM workouts WHERE start = ?", [.int(record.start)], { $0.int64(0) }).first else {
                    throw SQLiteError(code: -1, message: "workout row for start \(record.start) is missing right after its upsert")
                }
                try db.run("DELETE FROM workout_points WHERE workout_id = ?", [.int(id)])
                let insert = try db.prepare(
                    "INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                )
                for p in record.points {
                    insert.reset()
                    try insert.bind([
                        .int(id), .int(p.ts), p.lat.map { .double($0) } ?? .null, p.lon.map { .double($0) } ?? .null, p.alt.map { .double($0) } ?? .null,
                        .integer(p.hr), p.speed.map { .double($0) } ?? .null, .integer(p.cadence), p.stride.map { .double($0) } ?? .null, .integer(p.power),
                    ])
                    while try insert.step() {}
                }
                return wasComplete != true
            }
        }
    }

    /// Start of the next workout window, unix seconds. GB asks for everything after the newest stored workout (and from 2022-06-10 when there
    /// is none); the start of the oldest incomplete workout wins over that so it is downloaded again. Workouts imported from a Huawei export say
    /// nothing about what the watch still holds, so they do not count.
    /// `fullHistory` always starts from 2000-01-01; stored workouts upsert by start.
    public func syncStart(fullHistory: Bool = false) throws -> Int {
        if fullHistory { return Int(WorkoutStore.fullHistoryStartSec) }
        let (newestEnd, oldestIncomplete): (Int64?, Int64?) = try store.read { db in
            let newest = try db.query("SELECT MAX(end) FROM workouts WHERE imported = 0") { $0.isNull(0) ? nil : $0.int64(0) }.first ?? nil
            let incomplete = try db.query("SELECT MIN(start) FROM workouts WHERE complete = 0") { $0.isNull(0) ? nil : $0.int64(0) }.first ?? nil
            return (newest, incomplete)
        }
        let start: Int64
        if let newestEnd {
            start = oldestIncomplete.map { min($0, newestEnd + 1) } ?? newestEnd + 1
        } else {
            start = WorkoutStore.defaultStartSec
        }
        return Int(min(start, Int64(Int32.max)))
    }
}

/// The workout phase of the activity sync, run after the steps, sleep and totals are committed.
public enum WorkoutPhase {
    /// Workout sessions and their GPS tracks. Whatever fails here is logged and does not fail the sync: the steps, sleep and totals are already
    /// committed. Returns the workouts newly stored (or completed). Only cancellation propagates.
    public static func run(session: HuaweiSession, caps: DeviceCaps, syncStore: SyncStore, events: WearEvents, nowSec: Int64, fullHistory: Bool = false) async throws -> Int {
        let workouts = WorkoutStore(syncStore)
        let sync = WorkoutSync(session: session, caps: caps, log: events.sink)
        do {
            let start = try workouts.syncStart(fullHistory: fullHistory)
            try await sync.sync(startSec: start, endSec: Int(Int32(truncatingIfNeeded: nowSec)), sink: workouts)
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as WearError {
            events.error("Workout sync failed: \(e.message)")
        } catch let e as SQLiteError {
            events.error("Workout sync failed: \(e.message)")
        } catch {
            events.error("Workout sync failed: \(error)")
        }
        events.info("Workout sync: \(sync.saved) workouts stored")
        return sync.saved
    }
}

#endif

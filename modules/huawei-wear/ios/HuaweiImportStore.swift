// Writes a Huawei export import into `joyofit.db` through SyncStore's connection. Port of HuaweiImportStore.kt (SqliteHuaweiImportStore). The
// rules, in one place:
//
// - Watch data wins. Rows are inserted with `imported = 1` (migration `imported` in schema/joyofit-db-migrations.json) and never replace a row
//   that exists. A minute the watch already stored only gets heart rate, SpO2 and resting heart rate filled in where those are NULL (COALESCE),
//   never its steps, distance or calories. A sleep segment is skipped when a watch-synced one overlaps it. A workout is skipped when one starts
//   within `workoutMatchSec` of it.
// - Imported rows stay on the phone. The cloud upload, the Apple Health export and the Strava upload read `imported = 0` only, so a year of history
//   does not become an upload burst or a pile of duplicate records. When the watch later syncs the same minute, segment or workout, its write sets
//   `imported = 0` again (SyncStore.save, WorkoutStore.save) and the row travels like any watch row.
// - Idempotent. The second import of the same file changes nothing.
//
// Calories of imported minutes stay 0: the export's per-minute `calorie` scale is not known.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class SqliteHuaweiImportStore: HuaweiImportStore {
    /// The `health_metrics.type` of the stress / emotion card (`src/features/health/metrics.ts`).
    public static let stressType = "emotion"

    /// The same workout seen by the watch and by the export differs by a second or two at most.
    public static let workoutMatchSec: Int64 = 120

    private let store: SyncStore

    public init(_ store: SyncStore) { self.store = store }

    public func writeMinutes(_ rows: [ImportedMinute]) throws -> Int {
        if rows.isEmpty { return 0 }
        return try store.read { db in
            try db.transaction {
                var changed = 0
                let statement = try db.prepare(
                    """
                    INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate, imported)
                    VALUES (?, ?, 0, ?, ?, ?, ?, 1)
                    ON CONFLICT(timestamp) DO UPDATE SET
                      heart_rate = COALESCE(heart_rate, excluded.heart_rate),
                      spo2 = COALESCE(spo2, excluded.spo2),
                      resting_heart_rate = COALESCE(resting_heart_rate, excluded.resting_heart_rate),
                      steps = CASE WHEN imported = 1 AND steps = 0 THEN excluded.steps ELSE steps END,
                      distance = CASE WHEN imported = 1 AND distance = 0 THEN excluded.distance ELSE distance END
                    WHERE (heart_rate IS NULL AND excluded.heart_rate IS NOT NULL)
                       OR (spo2 IS NULL AND excluded.spo2 IS NOT NULL)
                       OR (resting_heart_rate IS NULL AND excluded.resting_heart_rate IS NOT NULL)
                       OR (imported = 1 AND steps = 0 AND excluded.steps > 0)
                       OR (imported = 1 AND distance = 0 AND excluded.distance > 0)
                    """
                )
                for m in rows {
                    statement.reset()
                    try statement.bind([
                        .int(m.ts), .int(Int64(m.steps)), .int(Int64(m.distance)), .integer(m.heartRate), .integer(m.spo2), .integer(m.restingHeartRate),
                    ])
                    while try statement.step() {}
                    changed += db.changes
                }
                return changed
            }
        }
    }

    public func writeSleep(_ segments: [ImportedSleep]) throws -> Int {
        if segments.isEmpty { return 0 }
        return try store.read { db in
            try db.transaction {
                var added = 0
                let statement = try db.prepare(
                    """
                    INSERT OR IGNORE INTO sleep_segments (start, end, type, stage, imported)
                    SELECT ?, ?, ?, ?, 1
                    WHERE NOT EXISTS (SELECT 1 FROM sleep_segments WHERE imported = 0 AND start < ? AND end > ?)
                    """
                )
                for s in segments {
                    statement.reset()
                    try statement.bind([.int(s.start), .int(s.end), .int(Int64(s.type)), .string(s.stage), .int(s.end), .int(s.start)])
                    while try statement.step() {}
                    added += db.changes
                }
                return added
            }
        }
    }

    /// Stress goes where the watch's own stress / emotion readings go, so the existing card and chart show it.
    public func writeStress(_ points: [ImportedStress]) throws -> Int {
        if points.isEmpty { return 0 }
        return try store.read { db in
            try db.transaction {
                var added = 0
                let statement = try db.prepare(
                    "INSERT OR IGNORE INTO health_metrics (type, ts, last_ts, value, values_json) VALUES ('\(SqliteHuaweiImportStore.stressType)', ?, ?, ?, ?)"
                )
                for p in points {
                    statement.reset()
                    try statement.bind([.int(p.ts), .int(p.ts), .double(Double(p.score)), .text("{\"score\":\(p.score),\"source\":\"huawei-export\"}")])
                    while try statement.step() {}
                    added += db.changes
                }
                return added
            }
        }
    }

    public func writeWorkout(_ workout: ImportedWorkout) throws -> WorkoutWrite {
        try store.read { db in
            try db.transaction {
                let exists = try !db.query(
                    "SELECT 1 FROM workouts WHERE start BETWEEN ? AND ? LIMIT 1",
                    [.int(workout.start - SqliteHuaweiImportStore.workoutMatchSec), .int(workout.start + SqliteHuaweiImportStore.workoutMatchSec)]
                ) { _ in true }.isEmpty
                if exists { return WorkoutWrite(added: false, points: 0) }
                try db.run(
                    """
                    INSERT OR IGNORE INTO workouts
                      (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
                    VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
                    """,
                    [
                        .int(workout.start), .int(workout.end), .int(Int64(workout.sportType)), .text(workout.sportName), .int(Int64(workout.duration)),
                        .int(Int64(workout.distance)), .int(Int64(workout.calories)), .integer(workout.avgHr), .integer(workout.maxHr),
                        .int(Int64(workout.steps)), .text(workout.summaryJson),
                    ]
                )
                if db.changes == 0 { return WorkoutWrite(added: false, points: 0) }
                let id = db.lastInsertRowId
                let point = try db.prepare(
                    "INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                )
                for p in workout.points {
                    point.reset()
                    try point.bind([
                        .int(id), .int(p.ts), p.lat.map { .double($0) } ?? .null, p.lon.map { .double($0) } ?? .null, p.alt.map { .double($0) } ?? .null,
                        .integer(p.hr), p.speed.map { .double($0) } ?? .null, .integer(p.cadence), p.stride.map { .double($0) } ?? .null, .integer(p.power),
                    ])
                    while try point.step() {}
                }
                return WorkoutWrite(added: true, points: workout.points.count)
            }
        }
    }
}

#endif

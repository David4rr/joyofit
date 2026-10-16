// Port of CycleStore (CycleStore.kt): the menstrual log in `joyofit.db` (`cycle_periods`, `cycle_days`, migration 6). Times are unix seconds,
// days are local `YYYY-MM-DD`. The rules a change must pass are `CycleLogRules` in the package.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class CycleStore: @unchecked Sendable {
    private let store: SyncStore

    public init(store: SyncStore) { self.store = store }

    private static func day(_ text: String?) -> CivilDate? { text.flatMap { CivilDate($0) } }

    public func periods() throws -> [LoggedPeriod] {
        try store.read { db in
            try db.query("SELECT start, end FROM cycle_periods ORDER BY start") { row in
                guard let start = CycleStore.day(row.text(0)) else { return nil }
                return LoggedPeriod(start: start, end: row.isNull(1) ? nil : CycleStore.day(row.text(1)))
            }.compactMap { $0 }
        }
    }

    /// Logged symptom days from `since` (inclusive), oldest first.
    public func days(since: CivilDate) throws -> [LoggedDay] {
        try store.read { db in
            try db.query("SELECT day, flow, cramps, modified FROM cycle_days WHERE day >= ? ORDER BY day", [.text(since.description)]) { row in
                CycleStore.day(row.text(0)).map { LoggedDay(day: $0, flow: row.int(1), cramps: row.int(2), modifiedSec: row.int64(3)) }
            }.compactMap { $0 }
        }
    }

    /// The newest change of any row, unix seconds; nil when nothing is logged.
    public func lastModified() throws -> Int64? {
        try store.read { db in
            try db.query("SELECT MAX(m) FROM (SELECT MAX(modified) AS m FROM cycle_periods UNION ALL SELECT MAX(modified) FROM cycle_days)") { row in
                row.isNull(0) ? nil : row.int64(0)
            }.first ?? nil
        }
    }

    public func startPeriod(_ day: CivilDate, nowSec: Int64) throws {
        try store.read { db in try db.run("INSERT INTO cycle_periods (start, end, modified) VALUES (?, NULL, ?)", [.text(day.description), .int(nowSec)]) }
    }

    public func endPeriod(_ day: CivilDate, nowSec: Int64) throws {
        try store.read { db in try db.run("UPDATE cycle_periods SET end = ?, modified = ? WHERE end IS NULL", [.text(day.description), .int(nowSec)]) }
    }

    public func addPeriod(start: CivilDate, end: CivilDate, nowSec: Int64) throws {
        try store.read { db in
            try db.run("INSERT INTO cycle_periods (start, end, modified) VALUES (?, ?, ?)", [.text(start.description), .text(end.description), .int(nowSec)])
        }
    }

    public func deletePeriod(_ start: CivilDate) throws {
        try store.read { db in try db.run("DELETE FROM cycle_periods WHERE start = ?", [.text(start.description)]) }
    }

    /// Saves flow and cramps of `day`. A row of 0 / 0 stays, so the watch also learns of a reset.
    public func logDay(_ day: CivilDate, flow: Int, cramps: Int, nowSec: Int64) throws {
        try store.read { db in
            try db.run(
                """
                INSERT INTO cycle_days (day, flow, cramps, modified) VALUES (?, ?, ?, ?)
                ON CONFLICT(day) DO UPDATE SET flow = excluded.flow, cramps = excluded.cramps, modified = excluded.modified
                """,
                [.text(day.description), .int(Int64(flow)), .int(Int64(cramps)), .int(nowSec)]
            )
        }
    }
}

#endif

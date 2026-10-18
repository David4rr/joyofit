// The body of `PUT /v1/family/ingest` (docs/family-monitoring.md section 10), built from the rows the sync stored in joyofit.db: the last three local
// days of the phone's time zone, only the categories the monitored person granted. A category whose scope is off is never queried, so nothing of it
// is read, let alone sent. Rows imported from Huawei Health or Apple Health (`imported = 1`) are history, not what the watch did, and are left out.
// Pure Foundation plus the database wrapper: the logic tests build it on Linux.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// One local day of the summary. A field is nil, and absent from the JSON, when its category is not granted or the day has no reading for it.
public struct FamilyDay: Equatable, Sendable, Encodable {
    /// `YYYY-MM-DD` in the phone's calendar.
    public var date: String
    public var steps: Int?
    /// Unix ms of the first sample with steps in it.
    public var firstStepAt: Int64?
    /// The lowest resting heart rate of the day.
    public var restingHr: Int?
    /// Minutes asleep in the night that ends on this date.
    public var sleepMin: Int?
    public var spo2Min: Int?
    /// SpO2 readings of the day at or below `FamilySummary.spo2LowAtOrBelow`.
    public var spo2LowCount: Int?
    /// Unix ms of the newest step or heart-rate sample of the day.
    public var lastSampleAt: Int64?

    public init(
        date: String, steps: Int? = nil, firstStepAt: Int64? = nil, restingHr: Int? = nil, sleepMin: Int? = nil, spo2Min: Int? = nil,
        spo2LowCount: Int? = nil, lastSampleAt: Int64? = nil
    ) {
        self.date = date
        self.steps = steps
        self.firstStepAt = firstStepAt
        self.restingHr = restingHr
        self.sleepMin = sleepMin
        self.spo2Min = spo2Min
        self.spo2LowCount = spo2LowCount
        self.lastSampleAt = lastSampleAt
    }

    var hasData: Bool {
        steps != nil || firstStepAt != nil || restingHr != nil || sleepMin != nil || spo2Min != nil || spo2LowCount != nil || lastSampleAt != nil
    }
}

public struct FamilyPayload: Equatable, Sendable, Encodable {
    /// Unix ms the body was built.
    public var sentAt: Int64
    /// The phone's offset from UTC in minutes at `sentAt`.
    public var tzOffsetMin: Int
    /// Unix ms of the last stored watch sync; nil with no sync or without the `sync` scope.
    public var watchSyncAt: Int64?
    public var battery: Int?
    /// Oldest first; days with nothing to report are left out.
    public var days: [FamilyDay]

    public init(sentAt: Int64, tzOffsetMin: Int, watchSyncAt: Int64?, battery: Int?, days: [FamilyDay]) {
        self.sentAt = sentAt
        self.tzOffsetMin = tzOffsetMin
        self.watchSyncAt = watchSyncAt
        self.battery = battery
        self.days = days
    }

    /// False when there is nothing to tell the server.
    public var hasContent: Bool { watchSyncAt != nil || battery != nil || !days.isEmpty }

    private enum CodingKeys: String, CodingKey {
        case sentAt, tzOffsetMin, watchSyncAt, battery, days
    }

    /// `watchSyncAt` and `battery` are `number|null` in the contract: present as null, not absent.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sentAt, forKey: .sentAt)
        try container.encode(tzOffsetMin, forKey: .tzOffsetMin)
        try container.encode(watchSyncAt, forKey: .watchSyncAt)
        try container.encode(battery, forKey: .battery)
        try container.encode(days, forKey: .days)
    }

    /// The exact body that is sent and that `familyUploadStatus().lastPayload` shows.
    public func json() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return String(decoding: try encoder.encode(self), as: UTF8.self)
    }
}

public enum FamilySummary {
    /// Today and the two days before it.
    public static let dayCount = 3
    /// A reading at or below this counts as low.
    public static let spo2LowAtOrBelow = 90
    /// A night belongs to the date it ends on: the sleep segments that end from this hour of the day before up to this hour of the date.
    static let nightBoundaryHour = 18
    /// Sleep segments are read this far before the first night, so the stray-segment and blip rules see the neighbours of a night's first segment.
    static let sleepContextSec: Int64 = 24 * 3600

    private struct Window {
        let date: String
        let startSec: Int64
        let endSec: Int64
        let nightFromSec: Int64
        let nightToSec: Int64
    }

    /// Reads the granted categories from `store`. `battery` is the watch battery the caller knows (nil if it does not).
    public static func build(
        store: SyncStore, scopes: FamilyScopes, battery: Int?, timeZone: TimeZone = .current, now: Date = Date()
    ) throws -> FamilyPayload {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let windows = lastDays(calendar: calendar, now: now)
        let days: [FamilyDay] = try store.read { db in
            var rows = windows.map { FamilyDay(date: $0.date) }
            for (i, w) in windows.enumerated() {
                let range: [SQLValue] = [.int(w.startSec), .int(w.endSec)]
                if scopes.sync {
                    let newest = try db.query(
                        "SELECT MAX(timestamp) FROM step_samples WHERE imported = 0 AND timestamp >= ? AND timestamp < ?", range
                    ) { $0.isNull(0) ? nil : $0.int64(0) * 1000 }
                    rows[i].lastSampleAt = newest.first ?? nil
                }
                if scopes.steps {
                    let steps = try db.query(
                        """
                        SELECT COUNT(*), COALESCE(SUM(steps), 0), MIN(CASE WHEN steps > 0 THEN timestamp END)
                        FROM step_samples WHERE imported = 0 AND timestamp >= ? AND timestamp < ?
                        """,
                        range
                    ) { (rows: $0.int(0), sum: $0.int(1), first: $0.isNull(2) ? nil : $0.int64(2) * 1000) }
                    if let row = steps.first, row.rows > 0 {
                        rows[i].steps = row.sum
                        rows[i].firstStepAt = row.first
                    }
                }
                if scopes.restingHr {
                    let resting = try db.query(
                        "SELECT MIN(resting_heart_rate) FROM step_samples WHERE imported = 0 AND resting_heart_rate > 0 AND timestamp >= ? AND timestamp < ?", range
                    ) { $0.optionalInt(0) }
                    rows[i].restingHr = resting.first ?? nil
                }
                if scopes.spo2 {
                    let spo2 = try db.query(
                        """
                        SELECT MIN(spo2), COALESCE(SUM(CASE WHEN spo2 <= ? THEN 1 ELSE 0 END), 0)
                        FROM step_samples WHERE imported = 0 AND spo2 BETWEEN 1 AND 100 AND timestamp >= ? AND timestamp < ?
                        """,
                        [.int(Int64(spo2LowAtOrBelow))] + range
                    ) { (min: $0.optionalInt(0), low: $0.int(1)) }
                    if let row = spo2.first, let min = row.min {
                        rows[i].spo2Min = min
                        rows[i].spo2LowCount = row.low
                    }
                }
            }
            if scopes.sleep, let first = windows.first, let last = windows.last {
                let segments = try SleepStore.load(db, endFromSec: first.nightFromSec - sleepContextSec, endBeforeSec: last.nightToSec, importedOnly: true)
                for (i, w) in windows.enumerated() {
                    rows[i].sleepMin = sleepMinutes(segments, fromSec: w.nightFromSec, toSec: w.nightToSec)
                }
            }
            return rows
        }
        var watchSyncAt: Int64?
        if scopes.sync {
            watchSyncAt = try store.read { db in
                try db.query("SELECT MAX(last_sync) FROM device") { $0.isNull(0) ? nil : $0.int64(0) * 1000 }.first ?? nil
            }
        }
        return FamilyPayload(
            sentAt: Int64(now.timeIntervalSince1970 * 1000), tzOffsetMin: timeZone.secondsFromGMT(for: now) / 60, watchSyncAt: watchSyncAt,
            battery: scopes.sync ? battery : nil, days: days.filter(\.hasData)
        )
    }

    /// The minutes asleep in the segments that end in [`fromSec`, `toSec`): the same sleep the app shows (no stray unstaged spans next to a staged
    /// night, no few-minute blips), awake time left out, overlapping segments counted once. nil when there is none.
    static func sleepMinutes(_ segments: [SleepSegment], fromSec: Int64, toSec: Int64) -> Int? {
        let kept = HealthKitPlan.withoutBlips(HealthKitPlan.withoutStrayUnstaged(segments))
            .filter { $0.end >= fromSec && $0.end < toSec && $0.stage != "awake" && $0.end > $0.start }
        if kept.isEmpty { return nil }
        var total: Int64 = 0
        var reach = Int64.min
        for s in kept.sorted(by: { $0.start < $1.start }) {
            let start = max(s.start, reach)
            if s.end > start { total += s.end - start }
            reach = max(reach, s.end)
        }
        return Int(total / 60)
    }

    /// The last `dayCount` local days, oldest first, with the night window that ends on each.
    private static func lastDays(calendar: Calendar, now: Date) -> [Window] {
        func startOfDay(offset: Int) -> Date {
            let today = calendar.startOfDay(for: now)
            return calendar.date(byAdding: .day, value: offset, to: today).map { calendar.startOfDay(for: $0) } ?? today.addingTimeInterval(Double(offset) * 86_400)
        }
        func boundary(of day: Date) -> Int64 {
            let at = calendar.date(bySettingHour: nightBoundaryHour, minute: 0, second: 0, of: day) ?? day.addingTimeInterval(Double(nightBoundaryHour) * 3600)
            return Int64(at.timeIntervalSince1970)
        }
        return (0..<dayCount).map { i in
            let offset = i - (dayCount - 1)
            let start = startOfDay(offset: offset)
            let c = calendar.dateComponents([.year, .month, .day], from: start)
            return Window(
                date: String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0),
                startSec: Int64(start.timeIntervalSince1970), endSec: Int64(startOfDay(offset: offset + 1).timeIntervalSince1970),
                nightFromSec: boundary(of: startOfDay(offset: offset - 1)), nightToSec: boundary(of: start)
            )
        }
    }
}

#endif

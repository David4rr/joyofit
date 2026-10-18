// Reads one local day of JoyoFit data out of the shared database for `HealthModelBuilder`. Port of HealthModelData.kt.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public enum HealthModelData {
    public static let defaultStepGoal = 8000

    /// `yyyyMMdd` of the local day containing `ms`, Huawei's `recordDay`.
    public static func recordDay(ofMs ms: Int64, calendar: Calendar = .current) -> Int {
        let c = calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: Double(ms) / 1000))
        return (c.year ?? 0) * 10000 + (c.month ?? 0) * 100 + (c.day ?? 0)
    }

    /// The date of a `recordDay`, nil for an impossible one (Java `LocalDate.of` throws).
    public static func date(ofRecordDay day: Int, calendar: Calendar = .current) -> Date? {
        let (y, m, d) = (day / 10000, day / 100 % 100, day % 100)
        guard let date = calendar.date(from: DateComponents(year: y, month: m, day: d)) else { return nil }
        let back = calendar.dateComponents([.year, .month, .day], from: date)
        return back.year == y && back.month == m && back.day == d ? date : nil
    }

    /// The day to answer for: the requested one, else today (a request with `recordDay` 0 or an impossible date).
    public static func load(db: SQLiteDatabase, requestedDay: Int, stepGoal: Int, nowMs: Int64, calendar: Calendar = .current) -> HealthDay {
        let start = calendar.startOfDay(for: date(ofRecordDay: requestedDay, calendar: calendar) ?? Date(timeIntervalSince1970: Double(nowMs) / 1000))
        let c = calendar.dateComponents([.year, .month, .day], from: start)
        let recordDay = (c.year ?? 0) * 10000 + (c.month ?? 0) * 100 + (c.day ?? 0)
        let from = Int64(start.timeIntervalSince1970.rounded())
        let to = Int64((calendar.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86_400)).timeIntervalSince1970.rounded())

        let steps = scalar(db, "SELECT COALESCE(SUM(steps), 0) FROM step_samples WHERE timestamp >= ? AND timestamp < ?", from, to) ?? 0
        let newest = scalar(db, "SELECT MAX(timestamp) FROM step_samples WHERE timestamp >= ? AND timestamp < ?", from, to)
        let exerciseSeconds = scalar(db, "SELECT COALESCE(SUM(duration), 0) FROM workouts WHERE start >= ? AND start < ?", from, to) ?? 0
        // A night counts on the day it ends; awake spans are not sleep.
        let sleepSeconds = cleanedSleepSeconds(db, from, to)
        let stress = scalar(db, "SELECT COUNT(*) FROM health_metrics WHERE type = 'emotion' AND ts >= ? AND ts < ?", from, to) ?? 0
        let bp = scalar(db, "SELECT COUNT(*) FROM health_metrics WHERE type = 'blood_pressure' AND ts >= ? AND ts < ?", from, to) ?? 0
        let dateText = String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)

        return HealthDay(
            recordDay: recordDay, steps: Int(truncatingIfNeeded: steps), stepGoal: stepGoal > 0 ? stepGoal : defaultStepGoal,
            exerciseMinutes: Int(exerciseSeconds / 60), sleepSeconds: sleepSeconds.map { Int(truncatingIfNeeded: $0) }, intakeKcal: intakeKcal(db, dateText),
            weightKg: nil, bloodPressure: bp > 0, stressMeasured: stress > 0, timestampMs: newest.map { $0 * 1000 } ?? min(nowMs, to * 1000)
        )
    }

    /// Sum of `kcal` over the meals of the diet day (`diet_day.meals_json`, written by the diet card); nil when the day has no row.
    public static func intakeKcal(_ db: SQLiteDatabase, _ date: String) -> Double? {
        let json: String?
        do {
            json = try db.query("SELECT meals_json FROM diet_day WHERE date = ?", [.text(date)]) { $0.isNull(0) ? nil : $0.text(0) }.first ?? nil
        } catch {
            return nil  // the table is created by the diet migration; without it there is no diet day
        }
        guard let json, let data = json.data(using: .utf8), let meals = (try? JSONSerialization.jsonObject(with: data)) as? [Any] else { return nil }
        var sum = 0.0
        for meal in meals {
            guard let object = meal as? [String: Any] else { continue }
            switch object["kcal"] {
            case let d as Double: sum += d
            case let i as Int: sum += Double(i)
            case let n as NSNumber: sum += n.doubleValue
            case let text as String: sum += Double(text) ?? 0
            default: break
            }
        }
        return sum
    }

    /// Seconds of cleaned sleep (`SleepStore`) in the segments that end in (`from`, `to`]; nil when there is none or the table is not there yet.
    private static func cleanedSleepSeconds(_ db: SQLiteDatabase, _ from: Int64, _ to: Int64) -> Int64? {
        guard let segments = try? SleepStore.load(db, endFromSec: from + 1, endBeforeSec: to + 1, importedOnly: false) else { return nil }
        let total = segments.reduce(Int64(0)) { $0 + ($1.stage == "awake" ? 0 : max(0, $1.end - $1.start)) }
        return total > 0 ? total : nil
    }

    private static func scalar(_ db: SQLiteDatabase, _ sql: String, _ args: Int64...) -> Int64? {
        do {
            return try db.query(sql, args.map { SQLValue.int($0) }) { $0.isNull(0) ? nil : $0.int64(0) }.first ?? nil
        } catch {
            return nil  // a table of a later migration is not there yet
        }
    }
}

#endif

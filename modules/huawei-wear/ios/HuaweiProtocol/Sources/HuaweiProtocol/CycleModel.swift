// Port of CycleModel.kt and CycleLogRules (CycleStore.kt): the plain average-cycle model behind the menstrual calendar, and the checks a log
// change must pass. Days are `CivilDate`s (java.time.LocalDate): a proleptic Gregorian day number, printed and parsed as `YYYY-MM-DD`.
import Foundation

/// A calendar day without a time zone, `LocalDate` of the Kotlin. `epochDay` counts days from 1970-01-01.
public struct CivilDate: Equatable, Hashable, Comparable, Sendable, CustomStringConvertible {
    public let epochDay: Int

    public init(epochDay: Int) { self.epochDay = epochDay }

    /// Howard Hinnant's days_from_civil; nil for a month or day that does not exist.
    public init?(year: Int, month: Int, day: Int) {
        guard (0...9999).contains(year), (1...12).contains(month), day >= 1, day <= CivilDate.daysIn(month: month, year: year) else { return nil }
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        self.epochDay = era * 146_097 + doe - 719_468
    }

    /// `LocalDate.parse`: exactly `YYYY-MM-DD`, a real date.
    public init?(_ text: String) {
        let parts = Array(text.utf8)
        guard parts.count == 10, parts[4] == 0x2D, parts[7] == 0x2D else { return nil }
        func digits(_ range: Range<Int>) -> Int? {
            var value = 0
            for i in range {
                guard parts[i] >= 0x30, parts[i] <= 0x39 else { return nil }
                value = value * 10 + Int(parts[i] - 0x30)
            }
            return value
        }
        guard let y = digits(0..<4), let m = digits(5..<7), let d = digits(8..<10) else { return nil }
        self.init(year: y, month: m, day: d)
    }

    private static func isLeap(_ year: Int) -> Bool { (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 }

    private static func daysIn(month: Int, year: Int) -> Int {
        switch month {
        case 2: return isLeap(year) ? 29 : 28
        case 4, 6, 9, 11: return 30
        default: return 31
        }
    }

    public var components: (year: Int, month: Int, day: Int) {
        let z = epochDay + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let day = doy - (153 * mp + 2) / 5 + 1
        let month = mp < 10 ? mp + 3 : mp - 9
        let year = yoe + era * 400 + (month <= 2 ? 1 : 0)
        return (year, month, day)
    }

    public var description: String {
        let c = components
        func pad(_ v: Int, _ n: Int) -> String { let s = String(v); return String(repeating: "0", count: max(0, n - s.count)) + s }
        return "\(pad(c.year, 4))-\(pad(c.month, 2))-\(pad(c.day, 2))"
    }

    public func plusDays(_ n: Int) -> CivilDate { CivilDate(epochDay: epochDay + n) }
    public func minusDays(_ n: Int) -> CivilDate { CivilDate(epochDay: epochDay - n) }
    public func isBefore(_ other: CivilDate) -> Bool { epochDay < other.epochDay }
    public func isAfter(_ other: CivilDate) -> Bool { epochDay > other.epochDay }

    public static func < (a: CivilDate, b: CivilDate) -> Bool { a.epochDay < b.epochDay }

    /// The local day `date` falls on in `zone` (`LocalDate.now(zone)`).
    public static func day(of date: Date, in zone: TimeZone) -> CivilDate {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return CivilDate(year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1) ?? CivilDate(epochDay: 0)
    }

    /// `atStartOfDay(zone).toEpochSecond()`: the first instant of the day (after a DST gap at midnight, the first valid one).
    public func startOfDaySeconds(in zone: TimeZone) -> Int64 {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let c = components
        let noon = calendar.date(from: DateComponents(year: c.year, month: c.month, day: c.day, hour: 12)) ?? Date(timeIntervalSince1970: Double(epochDay) * 86_400)
        return Int64(calendar.startOfDay(for: noon).timeIntervalSince1970.rounded(.down))
    }
}

/// One logged period: `end` is nil while it is still going on.
public struct LoggedPeriod: Equatable, Sendable {
    public var start: CivilDate
    public var end: CivilDate?

    public init(start: CivilDate, end: CivilDate?) {
        self.start = start
        self.end = end
    }
}

/// Symptoms the user logged for one day; flow and cramps are 0 (none) to 3 (heavy / strong).
public struct LoggedDay: Equatable, Sendable {
    public var day: CivilDate
    public var flow: Int
    public var cramps: Int
    public var modifiedSec: Int64

    public init(day: CivilDate, flow: Int, cramps: Int, modifiedSec: Int64) {
        self.day = day
        self.flow = flow
        self.cramps = cramps
        self.modifiedSec = modifiedSec
    }
}

/// One cycle as the watch's calendar wants it.
public struct CycleEntry: Equatable, Sendable {
    public var start: CivilDate
    public var end: CivilDate?
    public var fertileStart: CivilDate?
    public var fertileEnd: CivilDate?
    public var ovulation: CivilDate?
    public var lengthDays: Int
    public var logged: Bool

    public init(start: CivilDate, end: CivilDate?, fertileStart: CivilDate?, fertileEnd: CivilDate?, ovulation: CivilDate?, lengthDays: Int, logged: Bool) {
        self.start = start
        self.end = end
        self.fertileStart = fertileStart
        self.fertileEnd = fertileEnd
        self.ovulation = ovulation
        self.lengthDays = lengthDays
        self.logged = logged
    }
}

/// Day statuses Huawei Health stores per day (`menstrual_status`).
public enum CycleStatus {
    public static let periodStart = 101
    public static let periodEnd = 102
    public static let predictedStart = 301
    public static let predictedEnd = 302
    public static let fertileStart = 401
    public static let fertileEnd = 402
    public static let ovulation = 403
}

/// A plain average-cycle model, not a medical prediction. The cycle length is the mean of the last `history` start-to-start intervals between
/// 15 and 60 days (28 with fewer), the period length the mean of the last `history` finished periods (5 with none). The next period starts one
/// cycle after the last logged one; ovulation is estimated 14 days before it and the fertile window runs from 5 days before ovulation to 1 day
/// after. It cannot know about irregular cycles, stress, illness, hormones or pregnancy.
public struct CycleModel: Sendable {
    public static let defaultCycleDays = 28
    public static let defaultPeriodDays = 5
    public static let minCycleDays = 15
    public static let maxCycleDays = 60
    public static let maxPeriodDays = 14
    /// How many recent intervals / periods the averages use.
    public static let history = 6
    /// Huawei Health caps the cycle length it sends at 180 days.
    public static let maxLengthSent = 180
    public static let lutealDays = 14
    public static let fertileBefore = 5
    public static let fertileAfter = 1
    /// Predicted cycles ahead used for the watch's daily calendar.
    public static let predictedCycles = 3

    /// Local midnight of `day` in unix seconds (what Huawei Health stores as the day's start).
    public static func daySeconds(_ day: CivilDate, _ zone: TimeZone) -> Int64 { day.startOfDaySeconds(in: zone) }

    /// Kotlin's `Math.round(average)` on non-negative values: half rounds up.
    private static func roundedMean(_ values: [Int]) -> Int {
        Int((Double(values.reduce(0, +)) / Double(values.count) + 0.5).rounded(.down))
    }

    public let today: CivilDate
    /// Logged periods, oldest first.
    public let periods: [LoggedPeriod]
    public let averageCycleDays: Int
    public let averagePeriodDays: Int
    /// Whether the latest logged period has no end yet.
    public let periodOngoing: Bool

    public init(periods unsorted: [LoggedPeriod], today: CivilDate) {
        self.today = today
        let sorted = unsorted.enumerated().sorted { ($0.element.start, $0.offset) < ($1.element.start, $1.offset) }.map(\.element)
        periods = sorted
        var intervals = [Int]()
        for i in 0..<max(0, sorted.count - 1) {
            let gap = sorted[i + 1].start.epochDay - sorted[i].start.epochDay
            if gap >= CycleModel.minCycleDays && gap <= CycleModel.maxCycleDays { intervals.append(gap) }
        }
        let recentIntervals = Array(intervals.suffix(CycleModel.history))
        averageCycleDays = recentIntervals.isEmpty ? CycleModel.defaultCycleDays : CycleModel.roundedMean(recentIntervals)
        var lengths = [Int]()
        for p in sorted {
            guard let end = p.end else { continue }
            let length = end.epochDay - p.start.epochDay + 1
            if length >= 1 && length <= CycleModel.maxPeriodDays { lengths.append(length) }
        }
        let recentLengths = Array(lengths.suffix(CycleModel.history))
        averagePeriodDays = recentLengths.isEmpty ? CycleModel.defaultPeriodDays : CycleModel.roundedMean(recentLengths)
        periodOngoing = sorted.last.map { $0.end == nil } ?? false
    }

    /// The next `count` predicted period starts after the last logged one, or none before a period was logged. A prediction that is already
    /// past by at most half a cycle is moved to today (the period is late); an older one is rolled forward whole cycles.
    public func predictedStarts(_ count: Int) -> [CivilDate] {
        guard let last = periods.last, count > 0 else { return [] }
        var next = last.start.plusDays(averageCycleDays)
        if next.isBefore(today) {
            let late = today.epochDay - next.epochDay
            if late <= averageCycleDays / 2 {
                next = today
            } else {
                let cycles = (late + averageCycleDays - 1) / averageCycleDays
                next = next.plusDays(cycles * averageCycleDays)
            }
        }
        return (0..<count).map { next.plusDays($0 * averageCycleDays) }
    }

    /// Days the next period is late, 0 when it is not (or nothing is logged).
    public func daysLate() -> Int {
        guard let last = periods.last else { return 0 }
        if periodOngoing { return 0 }
        let due = last.start.plusDays(averageCycleDays)
        return today.isAfter(due) ? today.epochDay - due.epochDay : 0
    }

    private func ovulationFor(_ start: CivilDate) -> CivilDate { start.minusDays(CycleModel.lutealDays) }

    /// The cycle list Huawei Health sends in `0x32/03`: up to `history` finished cycles (oldest first), the current one, then up to `future`
    /// predicted ones.
    public func entries(history: Int, future: Int) -> [CycleEntry] {
        guard let current = periods.last else { return [] }
        let futureCount = max(future, 0)
        // The fertile window of a cycle sits before the next period start, so the current cycle and every predicted one need the start after it.
        let predicted = predictedStarts(futureCount + 1)
        var out = [CycleEntry]()
        let pastStart = max(0, periods.count - 1 - max(history, 0))
        for i in pastStart..<(periods.count - 1) {
            let period = periods[i]
            let length = min(periods[i + 1].start.epochDay - period.start.epochDay, CycleModel.maxLengthSent)
            out.append(CycleEntry(start: period.start, end: period.end, fertileStart: nil, fertileEnd: nil, ovulation: nil, lengthDays: length, logged: true))
        }
        let currentLength = min(max(predicted[0].epochDay - current.start.epochDay, 1), CycleModel.maxLengthSent)
        let currentOvulation = ovulationFor(predicted[0])
        out.append(CycleEntry(
            start: current.start, end: current.end,
            fertileStart: currentOvulation.minusDays(CycleModel.fertileBefore), fertileEnd: currentOvulation.plusDays(CycleModel.fertileAfter),
            ovulation: currentOvulation, lengthDays: currentLength, logged: true
        ))
        // The list holds the current cycle plus `future` predicted ones (Huawei Health stops at future + 1 cycles).
        for index in 0..<futureCount {
            let start = predicted[index]
            let ovulation = ovulationFor(predicted[index + 1])
            out.append(CycleEntry(
                start: start, end: start.plusDays(averagePeriodDays - 1),
                fertileStart: ovulation.minusDays(CycleModel.fertileBefore), fertileEnd: ovulation.plusDays(CycleModel.fertileAfter),
                ovulation: ovulation, lengthDays: averageCycleDays, logged: false
            ))
        }
        return out
    }

    /// The `menstrual_status` key days in [today - historyDays, today + futureDays] for the watch's daily calendar, oldest first.
    public func keyDays(historyDays: Int, futureDays: Int) -> [(day: CivilDate, status: Int)] {
        let from = today.minusDays(max(historyDays, 0))
        let to = today.plusDays(max(futureDays, 0))
        var out = [(day: CivilDate, status: Int)]()
        for p in periods {
            out.append((p.start, CycleStatus.periodStart))
            if let end = p.end { out.append((end, CycleStatus.periodEnd)) }
        }
        for start in predictedStarts(CycleModel.predictedCycles) {
            out.append((start, CycleStatus.predictedStart))
            out.append((start.plusDays(averagePeriodDays - 1), CycleStatus.predictedEnd))
            let ovulation = ovulationFor(start)
            out.append((ovulation.minusDays(CycleModel.fertileBefore), CycleStatus.fertileStart))
            out.append((ovulation, CycleStatus.ovulation))
            out.append((ovulation.plusDays(CycleModel.fertileAfter), CycleStatus.fertileEnd))
        }
        return out.filter { !$0.day.isBefore(from) && !$0.day.isAfter(to) }
            .enumerated().sorted { ($0.element.day, $0.offset) < ($1.element.day, $1.offset) }.map(\.element)
    }
}

/// What may be logged; each check returns the reason a change is refused, or nil when it is fine.
public enum CycleLogRules {
    public static let maxLevel = 3

    public static func parseDay(_ text: String) throws -> CivilDate {
        guard let day = CivilDate(text) else { throw WearError(.invalidArgument, "'\(text)' is not a date (expected YYYY-MM-DD)") }
        return day
    }

    private static func covers(_ period: LoggedPeriod, _ day: CivilDate, _ today: CivilDate) -> Bool {
        let end = period.end ?? today
        return !day.isBefore(period.start) && !day.isAfter(end)
    }

    public static func checkStart(_ periods: [LoggedPeriod], _ day: CivilDate, _ today: CivilDate) -> String? {
        if day.isAfter(today) { return "A period cannot start in the future" }
        if let open = periods.first(where: { $0.end == nil }) { return "A period started on \(open.start) is still open; end it first" }
        if let inside = periods.first(where: { covers($0, day, today) }) { return "That day is already inside the period from \(inside.start)" }
        if let later = periods.first(where: { $0.start.isAfter(day) }) {
            return "A later period (\(later.start)) is already logged; add an earlier one with both dates"
        }
        return nil
    }

    /// A finished period `start`...`end` added after the fact: inside today and overlapping no logged period.
    public static func checkRange(_ periods: [LoggedPeriod], _ start: CivilDate, _ end: CivilDate, _ today: CivilDate) -> String? {
        if end.isAfter(today) { return "A period cannot end in the future" }
        if end.isBefore(start) { return "A period cannot end before it started" }
        if let overlap = periods.first(where: { !start.isAfter($0.end ?? today) && !end.isBefore($0.start) }) {
            return "That overlaps the period from \(overlap.start)"
        }
        return nil
    }

    public static func checkEnd(_ periods: [LoggedPeriod], _ day: CivilDate, _ today: CivilDate) -> String? {
        guard let open = periods.first(where: { $0.end == nil }) else { return "There is no open period to end" }
        if day.isAfter(today) { return "A period cannot end in the future" }
        if day.isBefore(open.start) { return "A period cannot end before it started (\(open.start))" }
        return nil
    }

    public static func checkLevels(_ day: CivilDate, _ today: CivilDate, flow: Int, cramps: Int) -> String? {
        if day.isAfter(today) { return "Symptoms cannot be logged for a future day" }
        if !(0...maxLevel).contains(flow) { return "Flow must be 0 to \(maxLevel)" }
        if !(0...maxLevel).contains(cramps) { return "Cramps must be 0 to \(maxLevel)" }
        return nil
    }
}

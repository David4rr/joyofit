// Port of SleepReport.kt: the morning sleep report, a notification card on the watch, as Huawei Health 17.0.8.300 behaves on the wire.
// DataSync event 80030001, phone package `hw.unitedevice.sleepnotification`, watch package `hw.watch.health.sleep`, level 0, gated on
// ExpandCapability 84. The event data is a TLV of UTF-8 strings: 06 title, 07 description, 08 "open" label, 09 "ignore" label, 0a locale
// (`xx-YY`), 0b "open" URI, 0c "ignore" URI. The watch answers the same event id with data `01` when it showed the card.
import Foundation

/// One night as the report describes it, seconds per stage from the stored segments.
public struct SleepNight: Equatable, Sendable {
    public let start: Int64
    public let end: Int64
    public let totalSec: Int64
    public let lightSec: Int64
    public let deepSec: Int64
    public let remSec: Int64
    public let awakeSec: Int64

    public init(start: Int64, end: Int64, totalSec: Int64, lightSec: Int64, deepSec: Int64, remSec: Int64, awakeSec: Int64) {
        self.start = start
        self.end = end
        self.totalSec = totalSec
        self.lightSec = lightSec
        self.deepSec = deepSec
        self.remSec = remSec
        self.awakeSec = awakeSec
    }

    /// Whether any segment carried a decoded stage.
    public var hasStages: Bool { lightSec + deepSec + remSec + awakeSec > 0 }
}

public enum SleepReport {
    public static let eventId = 80_030_001
    public static let phonePackage = "hw.unitedevice.sleepnotification"
    public static let watchPackage = "hw.watch.health.sleep"

    public static let tagTitle = 0x06
    public static let tagDescription = 0x07
    public static let tagOpenLabel = 0x08
    public static let tagIgnoreLabel = 0x09
    public static let tagLocale = 0x0A
    public static let tagOpenUri = 0x0B
    public static let tagIgnoreUri = 0x0C

    /// Segments closer together than this belong to the same session (`SESSION_GAP_SEC` in `src/features/today/stats.ts`).
    public static let sessionGapSec: Int64 = 3 * 3600
    /// Shorter sessions are naps, not "last night".
    public static let minNightSec: Int64 = 3 * 3600
    /// A short session starting from this local hour (up to `eveningEndHour` next morning) is an evening doze (`EVENING_START_HOUR` in `stats.ts`).
    public static let eveningStartHour = 19
    /// An evening doze starts before this local hour; later starts are daytime naps (`EVENING_END_HOUR` in `stats.ts`).
    public static let eveningEndHour = 6
    /// An evening doze joins the session after it when that starts within this long after it ends (`EVENING_JOIN_GAP_SEC` in `stats.ts`).
    public static let eveningJoinGapSec: Int64 = 8 * 3600
    /// A report is only pushed this long after waking up at most.
    public static let maxAgeSec: Int64 = 8 * 3600
    /// Sleep within this of other sleep belongs to the same stretch when telling a blip from a nap (`BLIP_GAP_SEC` in `stats.ts`).
    public static let blipGapSec: Int64 = 3600
    /// A stretch with less sleep than this (awake excluded) is not sleep, e.g. a 1-minute HRV check (`MIN_SLEEP_SEC` in `stats.ts`).
    public static let minSleepSec: Int64 = 5 * 60

    /// Drops unstaged segments within `sessionGapSec` of a staged one (`withoutStrayUnstaged` in `stats.ts`).
    public static func withoutStrayUnstaged(_ segments: [SleepSegment]) -> [SleepSegment] {
        let staged = segments.filter { $0.stage != nil }
        return segments.filter { s in
            s.stage != nil || !staged.contains { t in t.start - s.end <= sessionGapSec && s.start - t.end <= sessionGapSec }
        }
    }

    /// Drops stretches of sleep (gaps up to `blipGapSec`) holding less than `minSleepSec` asleep: a watch records a few still minutes,
    /// such as an HRV or stress check, as sleep (`withoutBlips` in `stats.ts`). Returns the kept segments sorted by start.
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

    /// Whether a session that started at `prevStart`, ended at `prevEnd` and holds `prevAsleepSec` of sleep is an evening doze that the
    /// session starting at `nextStart` continues unless a workout lies between (`nextAfterWorkout`): a short session (under `minNightSec`)
    /// starting from `eveningStartHour`:00 to `eveningEndHour`:00 local time, with the next session starting within `eveningJoinGapSec`
    /// of its end (`joinsEveningDoze` in `stats.ts`).
    public static func joinsEveningDoze(prevStart: Int64, prevEnd: Int64, prevAsleepSec: Int64, nextStart: Int64, nextAfterWorkout: Bool, zone: TimeZone) -> Bool {
        if nextAfterWorkout || prevAsleepSec >= minNightSec || nextStart - prevEnd > eveningJoinGapSec { return false }
        let hour = calendar(zone).component(.hour, from: Date(timeIntervalSince1970: TimeInterval(prevStart)))
        return hour >= eveningStartHour || hour < eveningEndHour
    }

    /// The latest session of `segments`, chained with gaps up to `sessionGapSec` and cut where a segment is `breakBefore`
    /// (`lastSleepSession` in `stats.ts`). A short evening session before it joins it, see `eveningJoinGapSec`; the time between the two
    /// counts as no sleep.
    public static func lastNight(_ segments: [SleepSegment], zone: TimeZone = .current) -> SleepNight? {
        if segments.isEmpty { return nil }
        // Stable by start, like Kotlin's sortedBy.
        let sorted = withoutBlips(withoutStrayUnstaged(segments)).enumerated().sorted { a, b in
            a.element.start != b.element.start ? a.element.start < b.element.start : a.offset < b.offset
        }.map(\.element)
        guard !sorted.isEmpty else { return nil }
        var first = sorted.count - 1
        var earliest = sorted[first].start
        while first > 0 && !sorted[first].breakBefore && earliest - sorted[first - 1].end <= sessionGapSec {
            first -= 1
            earliest = min(earliest, sorted[first].start)
        }
        while first > 0 {
            // The session before: chained backwards the same way.
            var prevFirst = first - 1
            var prevStart = sorted[prevFirst].start
            while prevFirst > 0 && !sorted[prevFirst].breakBefore && prevStart - sorted[prevFirst - 1].end <= sessionGapSec {
                prevFirst -= 1
                prevStart = min(prevStart, sorted[prevFirst].start)
            }
            let prev = sorted[prevFirst..<first]
            let asleep = prev.reduce(Int64(0)) { $0 + ($1.stage == "awake" ? 0 : max(0, $1.end - $1.start)) }
            let prevEnd = prev.map(\.end).max() ?? prevStart
            if !joinsEveningDoze(prevStart: prevStart, prevEnd: prevEnd, prevAsleepSec: asleep, nextStart: earliest, nextAfterWorkout: sorted[first].afterWorkout, zone: zone) { break }
            first = prevFirst
            earliest = prevStart
        }
        var total: Int64 = 0, light: Int64 = 0, deep: Int64 = 0, rem: Int64 = 0, awake: Int64 = 0, end: Int64 = 0
        for segment in sorted[first...] {
            let seconds = max(0, segment.end - segment.start)
            total += seconds
            end = max(end, segment.end)
            switch segment.stage {
            case "light": light += seconds
            case "deep": deep += seconds
            case "rem": rem += seconds
            case "awake": awake += seconds
            default: break
            }
        }
        return SleepNight(start: earliest, end: end, totalSec: total, lightSec: light, deepSec: deep, remSec: rem, awakeSec: awake)
    }

    private static func calendar(_ zone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar
    }

    private static func localDay(_ sec: Int64, _ calendar: Calendar) -> DateComponents {
        calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: TimeInterval(sec)))
    }

    private static func dayText(_ c: DateComponents) -> String {
        String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Why not to push `night` now, nil when to push: a night, ending today, at most `maxAgeSec` ago and newer than the last one reported.
    public static func shouldPush(_ night: SleepNight, nowSec: Int64, zone: TimeZone, lastReportedEnd: Int64) -> String? {
        if night.end <= lastReportedEnd { return "already reported (session end \(night.end) <= \(lastReportedEnd))" }
        if night.totalSec < minNightSec { return "only \(night.totalSec / 60) min of sleep, a nap" }
        if nowSec - night.end > maxAgeSec { return "ended \((nowSec - night.end) / 3600) h ago, too late for a morning report" }
        let calendar = calendar(zone)
        let endDay = localDay(night.end, calendar)
        let today = localDay(nowSec, calendar)
        if endDay != today { return "the session ended on \(dayText(endDay)), not today (\(dayText(today)))" }
        return nil
    }

    /// `7 h 12 min`; minutes only below an hour.
    public static func duration(_ seconds: Int64) -> String {
        let minutes = (seconds + 30) / 60
        let h = minutes / 60
        let m = minutes % 60
        if h == 0 { return "\(m) min" }
        return "\(h) h \(m < 10 ? "0" : "")\(m) min"
    }

    public struct Message: Equatable, Sendable {
        public let title: String
        public let description: String
        public let openLabel: String
        public let ignoreLabel: String
        public let locale: String
        public let openUri: String
        public let ignoreUri: String

        public init(title: String, description: String, openLabel: String, ignoreLabel: String, locale: String, openUri: String, ignoreUri: String) {
            self.title = title
            self.description = description
            self.openLabel = openLabel
            self.ignoreLabel = ignoreLabel
            self.locale = locale
            self.openUri = openUri
            self.ignoreUri = ignoreUri
        }
    }

    private static func clock(_ sec: Int64, _ calendar: Calendar) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: TimeInterval(sec)))
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    /// The text of the card. No sleep score is made up: JoyoFit stores stages, not a score.
    public static func message(_ night: SleepNight, zone: TimeZone, language: String?, country: String?) -> Message {
        let calendar = calendar(zone)
        var text = "\(duration(night.totalSec)) asleep, \(clock(night.start, calendar)) to \(clock(night.end, calendar))."
        if night.hasStages {
            var parts: [String] = []
            if night.deepSec > 0 { parts.append("Deep \(duration(night.deepSec))") }
            if night.remSec > 0 { parts.append("REM \(duration(night.remSec))") }
            if night.lightSec > 0 { parts.append("Light \(duration(night.lightSec))") }
            if !parts.isEmpty { text += " " + parts.joined(separator: ", ") + "." }
        }
        return Message(
            title: "Sleep report", description: text, openLabel: "Open app", ignoreLabel: "Ignore",
            locale: localeTag(language: language, country: country), openUri: "joyofit://today", ignoreUri: "joyofit://today"
        )
    }

    /// `xx-YY` like `npn.e` / `CommonUtil.ab`: language and country, `en`/`US` when missing.
    public static func localeTag(language: String?, country: String?) -> String {
        let l = (language ?? "").isEmpty ? "en" : language!
        let c = (country ?? "").isEmpty ? "US" : country!
        return "\(l)-\(c)"
    }

    /// The event data: tags `06..0c` as UTF-8 TLV strings.
    public static func payload(_ message: Message) -> Bytes {
        var tlv = HuaweiTLV()
        tlv.put(tagTitle, string: message.title)
        tlv.put(tagDescription, string: message.description)
        tlv.put(tagOpenLabel, string: message.openLabel)
        tlv.put(tagIgnoreLabel, string: message.ignoreLabel)
        tlv.put(tagLocale, string: message.locale)
        tlv.put(tagOpenUri, string: message.openUri)
        tlv.put(tagIgnoreUri, string: message.ignoreUri)
        return tlv.serialize()
    }

    /// The watch's answer: shown when the data reads as the big-endian number 1 (one to four bytes, `DataSyncBytes.readInt32`).
    public static func acknowledged(_ data: Bytes?) -> Bool {
        guard let data, !data.isEmpty, data.count <= 4 else { return false }
        var n: Int32 = 0
        for b in data { n = (n << 8) | Int32(b) }
        return n == 1
    }
}

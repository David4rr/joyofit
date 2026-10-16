// Port of HuaweiMotionPathParser.kt: the `Motion path detail data` files of a Huawei export become workouts.
import Foundation

/// How a Huawei sport id of the export becomes a JoyoFit sport (the watch's own ids, see `WorkoutSportTypes`).
public enum HuaweiExportSports {
    /// The sport id for ones the export has but this table does not know: GB's catch-all `EXERCISE`.
    public static let other = 255

    /// Only the ids community converters agree on: 3 cycling, 4 running, 5 walking (m1ty/huawei2gpx, driemekasten/hhealth2zepp,
    /// JordyThien/Huawei-Health-Importer). Which other ids exist, and whether they share one id space with the watch's workout list, is
    /// unverified: everything else stays an unnamed workout and keeps its Huawei id in the summary.
    private static let known: [Int: Int] = [3: 3, 4: 1, 5: 2]

    public static func joyofitType(_ huaweiType: Int?) -> Int { huaweiType.flatMap { known[$0] } ?? other }

    public static func name(_ huaweiType: Int?) -> String {
        if let huaweiType, let mapped = known[huaweiType] { return WorkoutSportTypes.name(mapped) }
        return "Workout (Huawei type \(huaweiType.map(String.init) ?? "unknown"))"
    }
}

/// One GPS fix of a track; `startsSegment` after a pause marker.
public struct GpsFix: Equatable {
    public let ts: Int64
    public let lat: Double
    public let lon: Double
    public let alt: Double?
    public let startsSegment: Bool
}

/// One sensor reading (heart rate in bpm, barometric altitude in metres) at `ts` unix seconds.
public struct SensorReading: Equatable {
    public let ts: Int64
    public let value: Double
}

public struct MotionTrack {
    public let gps: [GpsFix]
    public let heartRates: [SensorReading]
    public let altitudes: [SensorReading]
}

/// The fields of one `Motion path detail data` object that the importer reads. Times are milliseconds.
public struct RawMotionPath {
    public var startMs: Int64?
    public var endMs: Int64?
    public var sportType: Int?
    public var totalSteps: Double?
    public var totalDistance: Double?
    public var totalCalories: Double?
    public var totalTime: Double?
    public var timeZone: String?
    /// The `HW_EXT_TRACK_DETAIL@i...` text, one record per line.
    public var attribute: String

    public init(
        startMs: Int64? = nil, endMs: Int64? = nil, sportType: Int? = nil, totalSteps: Double? = nil, totalDistance: Double? = nil,
        totalCalories: Double? = nil, totalTime: Double? = nil, timeZone: String? = nil, attribute: String
    ) {
        self.startMs = startMs
        self.endMs = endMs
        self.sportType = sportType
        self.totalSteps = totalSteps
        self.totalDistance = totalDistance
        self.totalCalories = totalCalories
        self.totalTime = totalTime
        self.timeZone = timeZone
        self.attribute = attribute
    }
}

/// The JSON files of the `Motion path detail data & description` folder: one object per tracked workout with `sportType`, `startTime`,
/// `endTime`, totals (`totalSteps`, `totalDistance` in metres, `totalCalories`, `totalTime`) and an `attribute` string,
/// `HW_EXT_TRACK_DETAIL@i` followed by one record per line:
///
///  - `tp=lbs;k=N;lat=;lon=;alt=;t=<seconds, scientific notation>;` a GPS fix. `lat=90.0;lon=-80.0` is a pause marker.
///  - `tp=h-r;k=<ms>;v=<bpm>;` heart rate, `tp=alti;k=<ms>;v=<m>;` barometric altitude, `tp=s-r` cadence (not stored).
///  - `tp=p-m`, `sec`, `rs`, `b-p-m` summaries (not used).
///
/// The object is sometimes invalid JSON. `fromBrokenText` reads the same fields straight off the raw text then: the line records do not depend
/// on the JSON around them.
public enum HuaweiMotionPathParser {
    /// Text the importer resynchronises on when a corrupt record swallowed its neighbours.
    public static let recordMarker = "{\"abnormalTrack\":"

    private static let hrRangeMin = 20
    private static let hrRangeMax = 250

    /// No human burns more than this many kcal a minute, so a larger figure is not kcal.
    private static let maxKcalPerMinute = 40.0

    /// Elevation changes under this many metres are barometer noise.
    private static let elevationNoiseM = 3.0

    /// `obj.opt(a) ?: obj.opt(b)`: the first key that is present (an explicit `null` counts as present, as `JSONObject.NULL` does).
    private static func first(_ obj: ExportRecord, _ names: String...) -> ExportJSON? {
        for name in names { if let v = obj[name] { return v } }
        return nil
    }

    public static func fromJson(_ obj: ExportRecord) -> RawMotionPath {
        let timeZone = obj.optString("timeZone", "")
        return RawMotionPath(
            startMs: HuaweiExportJson.epochMs(obj["startTime"]),
            endMs: HuaweiExportJson.epochMs(obj["endTime"]),
            sportType: HuaweiExportJson.number(obj["sportType"]).map(KotlinNumbers.roundToInt),
            totalSteps: HuaweiExportJson.number(first(obj, "totalSteps", "steps")),
            totalDistance: HuaweiExportJson.number(first(obj, "totalDistance", "distance")),
            totalCalories: HuaweiExportJson.number(first(obj, "totalCalories", "calorie", "calories")),
            totalTime: HuaweiExportJson.number(first(obj, "totalTime", "duration")),
            timeZone: timeZone.isEmpty ? nil : timeZone,
            attribute: obj.optString("attribute", "")
        )
    }

    /// Regex fallback for a record that is not valid JSON; nil when not even a start time can be found.
    public static func fromBrokenText(_ text: String) -> RawMotionPath? {
        let nsText = text as NSString
        func firstGroup(_ pattern: String) -> String? {
            guard let regex = try? NSRegularExpression(pattern: pattern),
                let match = regex.firstMatch(in: text, range: NSRange(location: 0, length: nsText.length)), match.numberOfRanges > 1
            else { return nil }
            let range = match.range(at: 1)
            return range.location == NSNotFound ? nil : nsText.substring(with: range)
        }
        func scalar(_ name: String) -> Double? {
            firstGroup("\"\(name)\"\\s*:\\s*\"?(-?[0-9][0-9.Ee+-]*)").flatMap(HuaweiExportJson.javaDouble)
        }
        let startMs = HuaweiExportJson.epochMs(scalar("startTime").map { .number($0) })
        let attribute = text.replacingOccurrences(of: "\\n", with: "\n")
        if startMs == nil && !attribute.contains("tp=lbs") { return nil }
        return RawMotionPath(
            startMs: startMs,
            endMs: HuaweiExportJson.epochMs(scalar("endTime").map { .number($0) }),
            sportType: scalar("sportType").map(KotlinNumbers.roundToInt),
            totalSteps: scalar("totalSteps"),
            totalDistance: scalar("totalDistance"),
            totalCalories: scalar("totalCalories"),
            totalTime: scalar("totalTime"),
            timeZone: firstGroup("\"timeZone\"\\s*:\\s*\"([^\"]*)\""),
            attribute: attribute
        )
    }

    private static func trimmed(_ s: ArraySlice<UInt8>) -> ArraySlice<UInt8> {
        var lo = s.startIndex
        var hi = s.endIndex
        func space(_ c: UInt8) -> Bool { c == 0x20 || (c >= 0x09 && c <= 0x0D) }
        while lo < hi, space(s[lo]) { lo += 1 }
        while hi > lo, space(s[hi - 1]) { hi -= 1 }
        return s[lo..<hi]
    }

    private static func double(_ s: ArraySlice<UInt8>?) -> Double? {
        guard let s else { return nil }
        return HuaweiExportJson.number(.string(String(decoding: s, as: UTF8.self)))
    }

    /// The fix, heart-rate and altitude records of an `attribute` text (read as UTF-8 bytes, so a tens-of-MB attribute is scanned without
    /// building a string per line).
    public static func parseTrack(_ attribute: String) -> MotionTrack {
        var gps = [GpsFix]()
        var heartRates = [SensorReading]()
        var altitudes = [SensorReading]()
        var pendingBreak = false
        let bytes = Array(attribute.utf8)
        let tp = Array("tp=".utf8)

        var lineStart = 0
        while lineStart <= bytes.count {
            var lineEnd = lineStart
            while lineEnd < bytes.count, bytes[lineEnd] != 0x0A { lineEnd += 1 }
            defer { lineStart = lineEnd + 1 }
            guard lineEnd - lineStart >= 3 else { continue }

            var at = lineStart
            var found = false
            while at + 3 <= lineEnd {
                if bytes[at] == tp[0], bytes[at + 1] == tp[1], bytes[at + 2] == tp[2] {
                    found = true
                    break
                }
                at += 1
            }
            guard found else { continue }

            // Later duplicates of a key win, as a HashMap put does.
            var fields = [(key: ArraySlice<UInt8>, value: ArraySlice<UInt8>)]()
            var partStart = at
            while partStart <= lineEnd {
                var partEnd = partStart
                while partEnd < lineEnd, bytes[partEnd] != 0x3B { partEnd += 1 }
                var eq = partStart
                while eq < partEnd, bytes[eq] != 0x3D { eq += 1 }
                if eq < partEnd && eq > partStart {
                    fields.append((trimmed(bytes[partStart..<eq]), trimmed(bytes[(eq + 1)..<partEnd])))
                }
                partStart = partEnd + 1
            }
            func field(_ name: StaticString) -> ArraySlice<UInt8>? {
                let n = name.utf8CodeUnitCount
                for f in fields.reversed() where f.key.count == n {
                    var same = true
                    for k in 0..<n where f.key[f.key.startIndex + k] != name.utf8Start[k] {
                        same = false
                        break
                    }
                    if same { return f.value }
                }
                return nil
            }

            guard let type = field("tp") else { continue }
            switch String(decoding: type, as: UTF8.self) {
            case "lbs":
                let lat = double(field("lat"))
                let lon = double(field("lon"))
                let t = double(field("t"))
                guard let lat, let lon else { continue }
                if lat == 90.0 && lon == -80.0 {
                    pendingBreak = true
                } else if let t, abs(lat) <= 90.0, abs(lon) <= 180.0, !(lat == 0.0 && lon == 0.0) {
                    let seconds = Int64(KotlinNumbers.roundToInt(t > 1e11 ? t / 1000.0 : t))
                    // 0 is "no altitude" in these fixes; the barometer series carries the real one.
                    let alt = double(field("alt")).flatMap { $0 != 0.0 ? $0 : nil }
                    gps.append(GpsFix(ts: seconds, lat: lat, lon: lon, alt: alt, startsSegment: pendingBreak))
                    pendingBreak = false
                }
            case "h-r":
                if let ms = double(field("k")), let d = double(field("v")) {
                    let bpm = KotlinNumbers.roundToInt(d)
                    if bpm >= hrRangeMin && bpm <= hrRangeMax {
                        heartRates.append(SensorReading(ts: KotlinNumbers.toLong(ms / 1000.0), value: Double(bpm)))
                    }
                }
            case "alti":
                if let ms = double(field("k")), let metres = double(field("v")) {
                    altitudes.append(SensorReading(ts: KotlinNumbers.toLong(ms / 1000.0), value: metres))
                }
            default: break
            }
        }
        return MotionTrack(gps: gps, heartRates: heartRates, altitudes: altitudes)
    }

    /// The workout `raw` describes, or nil when it has no usable start or no duration at all.
    public static func build(_ raw: RawMotionPath) -> ImportedWorkout? {
        let track = parseTrack(raw.attribute)
        var times = track.gps.map(\.ts)
        times += track.heartRates.map(\.ts)
        times += track.altitudes.map(\.ts)
        guard let start = raw.startMs.map({ $0 / 1000 }) ?? times.min() else { return nil }
        let elapsedMs = raw.endMs.map { $0 - start * 1000 }
        let movingSec = totalTimeSeconds(raw.totalTime, elapsedMs)
        var end = raw.endMs.map { $0 / 1000 } ?? times.max() ?? start
        if end <= start { end = start + (movingSec ?? 0) }
        if end <= start { return nil }
        let duration = Int(Int32(truncatingIfNeeded: end - start))

        let distance: Int
        if let total = raw.totalDistance, total > 0 {
            distance = KotlinNumbers.roundToInt(total)
        } else {
            distance = KotlinNumbers.roundToInt(trackDistance(track.gps))
        }
        let heartRates = track.heartRates.map { Int($0.value) }
        let avgHr: Int? = heartRates.isEmpty ? nil : KotlinNumbers.roundToInt(Double(heartRates.reduce(0, +)) / Double(heartRates.count))
        let maxHr = heartRates.max()
        let kind = WorkoutSportTypes.kind(HuaweiExportSports.joyofitType(raw.sportType))

        var points = [WorkoutPoint]()
        points.reserveCapacity(track.gps.count + track.heartRates.count + track.altitudes.count)
        for g in track.gps { points.append(WorkoutPoint(ts: g.ts, lat: g.lat, lon: g.lon, alt: g.alt, hr: nil)) }
        for h in track.heartRates { points.append(WorkoutPoint(ts: h.ts, lat: nil, lon: nil, alt: nil, hr: Int(h.value))) }
        for a in track.altitudes { points.append(WorkoutPoint(ts: a.ts, lat: nil, lon: nil, alt: a.value, hr: nil)) }
        // Stable: GPS fixes before sensor readings of the same second.
        let order = points.indices.sorted { points[$0].ts != points[$1].ts ? points[$0].ts < points[$1].ts : $0 < $1 }
        let sorted = order.map { points[$0] }

        return ImportedWorkout(
            start: start,
            end: end,
            sportType: HuaweiExportSports.joyofitType(raw.sportType),
            sportName: HuaweiExportSports.name(raw.sportType),
            duration: duration,
            distance: distance,
            calories: kcal(raw.totalCalories, durationSec: duration),
            steps: max(0, raw.totalSteps.map(KotlinNumbers.roundToInt) ?? 0),
            avgHr: avgHr,
            maxHr: maxHr,
            summaryJson: summaryJson(raw, kind: kind, duration: duration, distance: distance, movingSec: movingSec, track: track, heartRates: heartRates).serialized(),
            points: sorted
        )
    }

    /// Huawei's `totalCalories` is kcal in some exports and thousandths of one (small calories) in others. A figure that would be more than
    /// `maxKcalPerMinute` over the workout cannot be kcal, so it is divided by 1000. Whether other scales exist is unknown until a real export is
    /// compared with the watch's own figure.
    public static func kcal(_ raw: Double?, durationSec: Int) -> Int {
        guard let raw, raw > 0.0 else { return 0 }
        let perMinute = raw / (Double(durationSec) / 60.0)
        return KotlinNumbers.roundToInt(durationSec > 0 && perMinute > maxKcalPerMinute ? raw / 1000.0 : raw)
    }

    /// `totalTime` in seconds, reading it as the unit (ms or s) that lands closer to the elapsed time; ms without one.
    private static func totalTimeSeconds(_ totalTime: Double?, _ elapsedMs: Int64?) -> Int64? {
        guard let totalTime, totalTime > 0.0 else { return nil }
        guard let elapsedMs, elapsedMs > 0 else { return Int64(KotlinNumbers.roundToInt(totalTime / 1000.0)) }
        let asMs = abs(totalTime - Double(elapsedMs))
        let asSec = abs(totalTime * 1000.0 - Double(elapsedMs))
        return asSec < asMs ? Int64(KotlinNumbers.roundToInt(totalTime)) : Int64(KotlinNumbers.roundToInt(totalTime / 1000.0))
    }

    /// Metres along the fixes, not across a pause.
    public static func trackDistance(_ gps: [GpsFix]) -> Double {
        var total = 0.0
        if gps.count > 1 {
            for i in 1..<gps.count {
                if gps[i].startsSegment { continue }
                total += haversine(gps[i - 1].lat, gps[i - 1].lon, gps[i].lat, gps[i].lon)
            }
        }
        return total
    }

    private static func haversine(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = 6_371_000.0
        let p1 = lat1 * Double.pi / 180
        let p2 = lat2 * Double.pi / 180
        let dp = p2 - p1
        let dl = (lon2 - lon1) * Double.pi / 180
        let a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * r * atan2(a.squareRoot(), (1 - a).squareRoot())
    }

    /// Climb and descent of an altitude series, ignoring swings smaller than `elevationNoiseM`.
    public static func elevationChange(_ altitudes: [Double]) -> (gain: Double, loss: Double) {
        guard var reference = altitudes.first else { return (0.0, 0.0) }
        var gain = 0.0
        var loss = 0.0
        for a in altitudes {
            if a - reference >= elevationNoiseM {
                gain += a - reference
                reference = a
            } else if reference - a >= elevationNoiseM {
                loss += reference - a
                reference = a
            }
        }
        return (gain, loss)
    }

    private static func summaryJson(
        _ raw: RawMotionPath, kind: String, duration: Int, distance: Int, movingSec: Int64?, track: MotionTrack, heartRates: [Int]
    ) -> SummaryJSON {
        var json = SummaryObject()
        json.put("kind", kind)
        json.put("source", "huawei-export")
        if let t = raw.sportType { json.put("huaweiSportType", t) }
        if let tz = raw.timeZone { json.put("timeZone", tz) }
        if let m = movingSec { json.put("movingTimeSec", m) }
        json.put("gps", track.gps.isEmpty ? "none" : "ok")
        json.put("gpsPoints", track.gps.count)
        if duration > 0 && distance > 0 {
            let avgSpeed = Double(distance) / Double(duration)
            json.put("avgSpeed", avgSpeed)
            if WorkoutSportTypes.isPace(kind) { json.put("avgPaceSecPerKm", 1000.0 / avgSpeed) }
        }
        if let minHr = heartRates.min() { json.put("minHr", minHr) }
        if !track.altitudes.isEmpty {
            let values = track.altitudes.map(\.value)
            json.put("minAltitude", values.min()!)
            json.put("maxAltitude", values.max()!)
            json.put("avgAltitude", values.reduce(0, +) / Double(values.count))
            let (gain, loss) = elevationChange(values)
            json.put("elevationGain", gain)
            json.put("elevationLoss", loss)
        }
        return json.json
    }
}

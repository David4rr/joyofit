// Port of HuaweiHealthDetailParser.kt (the two parsers of the sample files of a Huawei export).
import Foundation

/// The JSON files of the `Health detail data & description` folder: records `{type, startTime, endTime, timeZone, deviceCode, recordId,
/// samplePoints:[{key, startTime, endTime, unit, value}]}`, times in milliseconds. The numeric `type` changes with the firmware, so a point is
/// recognised by its `key`. `value` is a number as a string (`"82.0"`) or an embedded JSON object.
///
/// | key                                                    | goes to                                  |
/// |--------------------------------------------------------|------------------------------------------|
/// | DATA_POINT_DYNAMIC_HEARTRATE                           | step_samples.heart_rate (minute row)     |
/// | DATA_POINT_REST_HEARTRATE, DATA_POINT_NEW_REST_HEARTRATE | step_samples.resting_heart_rate        |
/// | BLOOD_OXYGEN_SATURATION (`avgSaturation`)              | step_samples.spo2                        |
/// | PROFESSIONAL_SLEEP_SHALLOW/DEEP/DREAM/WAKE/NOON        | sleep_segments                           |
/// | STRESS_DATA (`score`)                                  | health_metrics type `emotion`            |
///
/// Everything else (weight, exercise intensity, water ...) is counted as unmapped and left alone.
public enum HuaweiHealthDetailParser {
    public static let keyHeartRate = "DATA_POINT_DYNAMIC_HEARTRATE"
    public static let keySpo2 = "BLOOD_OXYGEN_SATURATION"
    public static let keyStress = "STRESS_DATA"
    private static let keyRestSuffix = "REST_HEARTRATE"

    /// Longest sleep stage taken as real; the export repeats and merges spans, and a day-long one is a broken one.
    private static let maxSleepSpanSec: Int64 = 24 * 3600

    private static let sleepKinds: [String: Int] = [
        "PROFESSIONAL_SLEEP_SHALLOW": 0x06,
        "PROFESSIONAL_SLEEP_DEEP": 0x07,
        "PROFESSIONAL_SLEEP_DREAM": 0x5656,
        "PROFESSIONAL_SLEEP_WAKE": 0x5658,
        "PROFESSIONAL_SLEEP_NOON": 0x5659,
    ]

    public static func parse(_ record: ExportRecord, into out: HuaweiImportCollector) {
        guard let points = record.optArray("samplePoints") else { return }
        let recordStart = HuaweiExportJson.epochMs(record["startTime"])
        let recordEnd = HuaweiExportJson.epochMs(record["endTime"])
        for item in points {
            guard let point = item.asObject else { continue }
            let key = point.optString("key", "")
            if key.isEmpty { continue }
            let startMs = HuaweiExportJson.epochMs(point["startTime"]) ?? recordStart
            let endMs = HuaweiExportJson.epochMs(point["endTime"]) ?? recordEnd ?? startMs
            parsePoint(key, point["value"], startMs, endMs, out)
        }
    }

    private static func parsePoint(_ key: String, _ value: ExportJSON?, _ startMs: Int64?, _ endMs: Int64?, _ out: HuaweiImportCollector) {
        let sleepKind = sleepKinds[key]
        let known = sleepKind != nil || key == keyHeartRate || key == keySpo2 || key == keyStress || key.hasSuffix(keyRestSuffix)
        if !known {
            out.unmapped(key: key)
            return
        }
        guard let startMs else {
            out.rejected()
            return
        }
        let startSec = startMs / 1000
        if let sleepKind {
            let endSec = (endMs ?? startMs) / 1000
            if endSec <= startSec || endSec - startSec > maxSleepSpanSec {
                out.rejected()
            } else {
                out.sleep(ImportedSleep(start: startSec, end: endSec, type: sleepKind, stage: SleepSync.stageForRawKind(sleepKind)))
            }
        } else if key == keyHeartRate {
            if let bpm = bpm(value, 20...250) { out.heartRate(tsSec: startSec, bpm: bpm) } else { out.rejected() }
        } else if key.hasSuffix(keyRestSuffix) {
            if let bpm = bpm(value, 20...200) { out.restingHeartRate(tsSec: startSec, bpm: bpm) } else { out.rejected() }
        } else if key == keySpo2 {
            if let d = embeddedNumber(value, "avgSaturation", "saturation", "value"), (50...100).contains(KotlinNumbers.roundToInt(d)) {
                out.spo2(tsSec: startSec, percent: KotlinNumbers.roundToInt(d))
            } else {
                out.rejected()
            }
        } else if key == keyStress {
            if let d = embeddedNumber(value, "score", "stress", "value"), (1...100).contains(KotlinNumbers.roundToInt(d)) {
                out.stress(ImportedStress(ts: startSec, score: KotlinNumbers.roundToInt(d)))
            } else {
                out.rejected()
            }
        }
    }

    private static func bpm(_ value: ExportJSON?, _ range: ClosedRange<Int>) -> Int? {
        guard let d = HuaweiExportJson.number(value) else { return nil }
        let v = KotlinNumbers.roundToInt(d)
        return range.contains(v) ? v : nil
    }

    /// The plain number in `value`, or the first of `names` found in the JSON object `value` carries.
    private static func embeddedNumber(_ value: ExportJSON?, _ names: String...) -> Double? {
        if let d = HuaweiExportJson.number(value) { return d }
        guard let object = HuaweiExportJson.embeddedObject(value) else { return nil }
        for name in names {
            if let d = HuaweiExportJson.number(object[name]) { return d }
        }
        return nil
    }
}

/// The JSON files of the `Sport per minute merged data & description` folder: one record per day, `{recordDay, sportDataUserData:[{startTime,
/// endTime, sportType, sportBasicInfos:[{steps, distance (m), calorie, altitude, floor, duration, count}]}]}`. The entry starts at `startTime`;
/// its n-th info is the n-th minute (a `duration` above one skips ahead). The export repeats the same minutes in several entries, so the
/// collector keeps the largest value per minute rather than adding them up. `calorie` is not read: its scale differs by firmware (tenths,
/// hundredths or thousandths of a kcal depending on the tool you ask), and a wrong guess would put wrong calorie totals in front of the user.
public enum HuaweiSportPerMinuteParser {
    private static let maxStepsPerMinute = 400
    private static let maxMetresPerMinute = 1000

    public static func parse(_ record: ExportRecord, into out: HuaweiImportCollector) {
        guard let entries = record.optArray("sportDataUserData") else { return }
        for item in entries {
            guard let entry = item.asObject, let infos = entry.optArray("sportBasicInfos") else { continue }
            guard let firstMinuteMs = HuaweiExportJson.epochMs(entry["startTime"]) else {
                out.rejected()
                continue
            }
            var minuteMs = firstMinuteMs
            for infoItem in infos {
                guard let info = infoItem.asObject else { continue }
                let steps = HuaweiExportJson.number(info["steps"]).map(KotlinNumbers.roundToInt) ?? 0
                let distance = HuaweiExportJson.number(info["distance"]).map(KotlinNumbers.roundToInt) ?? 0
                if (0...maxStepsPerMinute).contains(steps) && (0...maxMetresPerMinute).contains(distance) {
                    if steps > 0 || distance > 0 { out.steps(minuteSec: minuteMs / 60_000 * 60, steps: steps, distance: distance) }
                } else {
                    out.rejected()
                }
                let minutes = min(60, max(1, HuaweiExportJson.number(info["duration"]).map(KotlinNumbers.roundToInt) ?? 1))
                minuteMs += Int64(minutes) * 60_000
            }
        }
    }
}

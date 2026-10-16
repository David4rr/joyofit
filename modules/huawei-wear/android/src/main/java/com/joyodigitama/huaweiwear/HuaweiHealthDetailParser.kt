package com.joyodigitama.huaweiwear

import kotlin.math.roundToInt
import org.json.JSONObject

/**
 * The JSON files of the `Health detail data & description` folder: records `{type, startTime, endTime, timeZone, deviceCode, recordId,
 * samplePoints:[{key, startTime, endTime, unit, value}]}`, times in milliseconds. The numeric `type` changes with the
 * firmware, so a point is recognised by its `key`. `value` is a number as a string (`"82.0"`) or an embedded JSON object.
 *
 * | key                                                    | goes to                                  |
 * |--------------------------------------------------------|------------------------------------------|
 * | DATA_POINT_DYNAMIC_HEARTRATE                           | step_samples.heart_rate (minute row)     |
 * | DATA_POINT_REST_HEARTRATE, DATA_POINT_NEW_REST_HEARTRATE | step_samples.resting_heart_rate        |
 * | BLOOD_OXYGEN_SATURATION (`avgSaturation`)              | step_samples.spo2                        |
 * | PROFESSIONAL_SLEEP_SHALLOW/DEEP/DREAM/WAKE/NOON        | sleep_segments                           |
 * | STRESS_DATA (`score`)                                  | health_metrics type `emotion`            |
 *
 * Everything else (weight, exercise intensity, water ...) is counted as unmapped and left alone.
 */
internal object HuaweiHealthDetailParser {
  const val KEY_HEART_RATE = "DATA_POINT_DYNAMIC_HEARTRATE"
  const val KEY_SPO2 = "BLOOD_OXYGEN_SATURATION"
  const val KEY_STRESS = "STRESS_DATA"
  private const val KEY_REST_SUFFIX = "REST_HEARTRATE"

  /** Longest sleep stage taken as real; the export repeats and merges spans, and a day-long one is a broken one. */
  private const val MAX_SLEEP_SPAN_SEC = 24 * 3600L

  private val SLEEP_KINDS: Map<String, Int> = mapOf(
    "PROFESSIONAL_SLEEP_SHALLOW" to 0x06,
    "PROFESSIONAL_SLEEP_DEEP" to 0x07,
    "PROFESSIONAL_SLEEP_DREAM" to 0x5656,
    "PROFESSIONAL_SLEEP_WAKE" to 0x5658,
    "PROFESSIONAL_SLEEP_NOON" to 0x5659,
  )

  fun parse(record: JSONObject, out: HuaweiImportCollector) {
    val points = record.optJSONArray("samplePoints") ?: return
    val recordStart = HuaweiExportJson.epochMs(record.opt("startTime"))
    val recordEnd = HuaweiExportJson.epochMs(record.opt("endTime"))
    for (i in 0 until points.length()) {
      val point = points.optJSONObject(i) ?: continue
      val key = point.optString("key", "")
      if (key.isEmpty()) continue
      val startMs = HuaweiExportJson.epochMs(point.opt("startTime")) ?: recordStart
      val endMs = HuaweiExportJson.epochMs(point.opt("endTime")) ?: recordEnd ?: startMs
      parsePoint(key, point.opt("value"), startMs, endMs, out)
    }
  }

  private fun parsePoint(key: String, value: Any?, startMs: Long?, endMs: Long?, out: HuaweiImportCollector) {
    val sleepKind = SLEEP_KINDS[key]
    val known = sleepKind != null || key == KEY_HEART_RATE || key == KEY_SPO2 || key == KEY_STRESS || key.endsWith(KEY_REST_SUFFIX)
    if (!known) {
      out.unmapped(key)
      return
    }
    if (startMs == null) {
      out.rejected()
      return
    }
    val startSec = startMs / 1000
    when {
      sleepKind != null -> {
        val endSec = (endMs ?: startMs) / 1000
        if (endSec <= startSec || endSec - startSec > MAX_SLEEP_SPAN_SEC) {
          out.rejected()
        } else {
          out.sleep(ImportedSleep(startSec, endSec, sleepKind, SleepSync.stageForRawKind(sleepKind)))
        }
      }
      key == KEY_HEART_RATE -> bpm(value, 20..250)?.let { out.heartRate(startSec, it) } ?: out.rejected()
      key.endsWith(KEY_REST_SUFFIX) -> bpm(value, 20..200)?.let { out.restingHeartRate(startSec, it) } ?: out.rejected()
      key == KEY_SPO2 -> embeddedNumber(value, "avgSaturation", "saturation", "value")
        ?.roundToInt()?.takeIf { it in 50..100 }?.let { out.spo2(startSec, it) } ?: out.rejected()
      key == KEY_STRESS -> embeddedNumber(value, "score", "stress", "value")
        ?.roundToInt()?.takeIf { it in 1..100 }?.let { out.stress(ImportedStress(startSec, it)) } ?: out.rejected()
    }
  }

  private fun bpm(value: Any?, range: IntRange): Int? = HuaweiExportJson.number(value)?.roundToInt()?.takeIf { it in range }

  /** The plain number in [value], or the first of [names] found in the JSON object [value] carries. */
  private fun embeddedNumber(value: Any?, vararg names: String): Double? {
    HuaweiExportJson.number(value)?.let { return it }
    val obj = HuaweiExportJson.embeddedObject(value) ?: return null
    for (name in names) HuaweiExportJson.number(obj.opt(name))?.let { return it }
    return null
  }
}

/**
 * The JSON files of the `Sport per minute merged data & description` folder: one record per day, `{recordDay, sportDataUserData:[{startTime,
 * endTime, sportType, sportBasicInfos:[{steps, distance (m), calorie, altitude, floor, duration, count}]}]}`. The entry
 * starts at `startTime`; its n-th info is the n-th minute (a `duration` above one skips ahead). The export repeats the
 * same minutes in several entries, so the collector keeps the largest value per minute rather than adding them up.
 * `calorie` is not read: its scale differs by firmware (tenths, hundredths or thousandths of a kcal depending on the
 * tool you ask), and a wrong guess would put wrong calorie totals in front of the user.
 */
internal object HuaweiSportPerMinuteParser {
  private const val MAX_STEPS_PER_MINUTE = 400
  private const val MAX_METRES_PER_MINUTE = 1000

  fun parse(record: JSONObject, out: HuaweiImportCollector) {
    val entries = record.optJSONArray("sportDataUserData") ?: return
    for (i in 0 until entries.length()) {
      val entry = entries.optJSONObject(i) ?: continue
      val infos = entry.optJSONArray("sportBasicInfos") ?: continue
      val firstMinuteMs = HuaweiExportJson.epochMs(entry.opt("startTime"))
      if (firstMinuteMs == null) {
        out.rejected()
        continue
      }
      var minuteMs: Long = firstMinuteMs
      for (j in 0 until infos.length()) {
        val info = infos.optJSONObject(j) ?: continue
        val steps = HuaweiExportJson.number(info.opt("steps"))?.roundToInt() ?: 0
        val distance = HuaweiExportJson.number(info.opt("distance"))?.roundToInt() ?: 0
        if (steps in 0..MAX_STEPS_PER_MINUTE && distance in 0..MAX_METRES_PER_MINUTE) {
          if (steps > 0 || distance > 0) out.steps(minuteMs / 60_000 * 60, steps, distance)
        } else {
          out.rejected()
        }
        val minutes = HuaweiExportJson.number(info.opt("duration"))?.roundToInt()?.coerceIn(1, 60) ?: 1
        minuteMs += minutes * 60_000L
      }
    }
  }
}

package com.joyodigitama.huaweiwear

import kotlin.math.roundToInt
import org.json.JSONObject

/**
 * The JSON files of the `Health detail data & description` folder: records `{type, startTime, endTime, timeZone, deviceCode, recordId,
 * samplePoints:[{key, startTime, endTime, unit, value}]}`, times in milliseconds (UTC; `timeZone` is only the zone the
 * phone was in, so nothing here shifts a time). The numeric `type` changes with the firmware, so a point is recognised
 * by its `key`. `value` is a number as a string (`"82.0"`) or an embedded JSON object.
 *
 * | key                                                    | goes to                                  |
 * |--------------------------------------------------------|------------------------------------------|
 * | DATA_POINT_DYNAMIC_HEARTRATE                           | step_samples.heart_rate (minute row)     |
 * | DATA_POINT_REST_HEARTRATE, DATA_POINT_NEW_REST_HEARTRATE | step_samples.resting_heart_rate        |
 * | BLOOD_OXYGEN_SATURATION (`avgSaturation`)              | step_samples.spo2                        |
 * | PROFESSIONAL_SLEEP_SHALLOW/DEEP/DREAM/WAKE/NOON        | sleep_segments                           |
 * | STRESS_DATA (`score`)                                  | health_metrics type `emotion`            |
 * | WEIGHT_BODYFAT_BROAD and other weight / body keys      | scale_reading (see [HuaweiWeightParser]) |
 *
 * Everything else (exercise intensity, water ...) is counted per key as unmapped and left alone.
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
    val weights = HuaweiWeightParser.Collected()
    for (i in 0 until points.length()) {
      val point = points.optJSONObject(i) ?: continue
      val key = point.optString("key", "")
      if (key.isEmpty()) continue
      val startMs = HuaweiExportJson.epochMs(point.opt("startTime")) ?: recordStart
      val endMs = HuaweiExportJson.epochMs(point.opt("endTime")) ?: recordEnd ?: startMs
      parsePoint(key, point.opt("value"), startMs, endMs, out, weights)
    }
    weights.emit(out)
  }

  private fun parsePoint(key: String, value: Any?, startMs: Long?, endMs: Long?, out: HuaweiImportCollector, weights: HuaweiWeightParser.Collected) {
    val sleepKind = SLEEP_KINDS[key]
    val weightKey = HuaweiWeightParser.isWeightKey(key)
    val known = sleepKind != null || weightKey || key == KEY_HEART_RATE || key == KEY_SPO2 || key == KEY_STRESS || key.endsWith(KEY_REST_SUFFIX)
    if (!known) {
      out.unmapped(key)
      return
    }
    if (startMs == null) {
      out.rejected(key, "no-time", null)
      return
    }
    val startSec = startMs / 1000
    when {
      sleepKind != null -> {
        val endSec = (endMs ?: startMs) / 1000
        if (endSec <= startSec || endSec - startSec > MAX_SLEEP_SPAN_SEC) {
          out.rejected(key, "bad-span", "${endSec - startSec}s")
        } else {
          out.sleep(ImportedSleep(startSec, endSec, sleepKind, SleepSync.stageForRawKind(sleepKind)))
        }
      }
      weightKey -> if (!weights.add(key, value, startMs)) out.rejected(key, "no-weight", sampleOf(value))
      key == KEY_HEART_RATE -> number(key, value, 20..250, out) { out.heartRate(startSec, it) }
      key.endsWith(KEY_REST_SUFFIX) -> number(key, value, 20..200, out) { out.restingHeartRate(startSec, it) }
      key == KEY_SPO2 -> number(key, value, 50..100, out, "avgSaturation", "averageSaturation", "saturation", "spo2", "value") { out.spo2(startSec, it) }
      key == KEY_STRESS -> number(key, value, 1..100, out, "score", "stress", "value") { out.stress(ImportedStress(startSec, it)) }
    }
  }

  /** Reads [value] (a plain number or the first of [names] in an embedded object) and hands it over or says why not. */
  private inline fun number(key: String, value: Any?, range: IntRange, out: HuaweiImportCollector, vararg names: String, accept: (Int) -> Unit) {
    val n = embeddedNumber(value, *names)
    if (n == null) {
      out.rejected(key, "no-number", sampleOf(value))
      return
    }
    val rounded = n.roundToInt()
    if (rounded in range) accept(rounded) else out.rejected(key, "out-of-range", rounded.toString())
  }

  internal fun sampleOf(value: Any?): String? = value?.toString()?.replace(Regex("\\s+"), "")?.take(40)?.ifEmpty { null }

  /** The plain number in [value], or the first of [names] found in the JSON object [value] carries. */
  private fun embeddedNumber(value: Any?, vararg names: String): Double? {
    HuaweiExportJson.number(value)?.let { return it }
    if (names.isEmpty()) return null
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
        out.rejected("sportDataUserData", "no-time", null)
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
          out.rejected("sportBasicInfos", "out-of-range", "$steps steps/$distance m")
        }
        val minutes = HuaweiExportJson.number(info.opt("duration"))?.roundToInt()?.coerceIn(1, 60) ?: 1
        minuteMs += minutes * 60_000L
      }
    }
  }
}

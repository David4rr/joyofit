package com.joyodigitama.huaweiwear

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import org.json.JSONObject

/** How a Huawei sport id of the export becomes a JoyoFit sport (the watch's own ids, see [WorkoutSportTypes]). */
internal object HuaweiExportSports {
  /** The sport id for ones the export has but this table does not know: GB's catch-all `EXERCISE`. */
  const val OTHER = 255

  /**
   * Only the ids community converters agree on: 3 cycling, 4 running, 5 walking (m1ty/huawei2gpx, driemekasten/
   * hhealth2zepp, JordyThien/Huawei-Health-Importer). Which other ids exist, and whether they share one id space with
   * the watch's workout list, is unverified: everything else stays an unnamed workout and keeps its Huawei id in the
   * summary.
   */
  private val KNOWN: Map<Int, Int> = mapOf(3 to 3, 4 to 1, 5 to 2)

  fun joyofitType(huaweiType: Int?): Int = huaweiType?.let { KNOWN[it] } ?: OTHER

  fun name(huaweiType: Int?): String =
    if (huaweiType != null && huaweiType in KNOWN) WorkoutSportTypes.name(KNOWN.getValue(huaweiType)) else "Workout (Huawei type ${huaweiType ?: "unknown"})"
}

/** One GPS fix of a track; [startsSegment] after a pause marker. */
internal class GpsFix(val ts: Long, val lat: Double, val lon: Double, val alt: Double?, val startsSegment: Boolean)

/** One sensor reading (heart rate in bpm, barometric altitude in metres) at [ts] unix seconds. */
internal class SensorReading(val ts: Long, val value: Double)

internal class MotionTrack(val gps: List<GpsFix>, val heartRates: List<SensorReading>, val altitudes: List<SensorReading>)

/** The fields of one `Motion path detail data` object that the importer reads. Times are milliseconds. */
internal class RawMotionPath(
  val startMs: Long?,
  val endMs: Long?,
  val sportType: Int?,
  val totalSteps: Double?,
  val totalDistance: Double?,
  val totalCalories: Double?,
  val totalTime: Double?,
  val timeZone: String?,
  /** The `HW_EXT_TRACK_DETAIL@i...` text, one record per line. */
  val attribute: String,
)

/**
 * The JSON files of the `Motion path detail data & description` folder: one object per tracked workout with `sportType`, `startTime`,
 * `endTime`, totals (`totalSteps`, `totalDistance` in metres, `totalCalories`, `totalTime`) and an `attribute` string,
 * `HW_EXT_TRACK_DETAIL@i` followed by one record per line:
 *
 *  - `tp=lbs;k=N;lat=;lon=;alt=;t=<seconds, scientific notation>;` a GPS fix. `lat=90.0;lon=-80.0` is a pause marker.
 *  - `tp=h-r;k=<ms>;v=<bpm>;` heart rate, `tp=alti;k=<ms>;v=<m>;` barometric altitude, `tp=s-r` cadence (not stored).
 *  - `tp=p-m`, `sec`, `rs`, `b-p-m` summaries (not used).
 *
 * The object is sometimes invalid JSON. [fromBrokenText] reads the same fields straight off the raw text then: the
 * line records do not depend on the JSON around them.
 */
internal object HuaweiMotionPathParser {
  /** Text the importer resynchronises on when a corrupt record swallowed its neighbours. */
  const val RECORD_MARKER = "{\"abnormalTrack\":"

  private const val HR_RANGE_MIN = 20
  private const val HR_RANGE_MAX = 250

  /** No human burns more than this many kcal a minute, so a larger figure is not kcal. */
  private const val MAX_KCAL_PER_MINUTE = 40.0

  /** Elevation changes under this many metres are barometer noise. */
  private const val ELEVATION_NOISE_M = 3.0

  fun fromJson(obj: JSONObject): RawMotionPath = RawMotionPath(
    startMs = HuaweiExportJson.epochMs(obj.opt("startTime")),
    endMs = HuaweiExportJson.epochMs(obj.opt("endTime")),
    sportType = HuaweiExportJson.number(obj.opt("sportType"))?.roundToInt(),
    totalSteps = HuaweiExportJson.number(obj.opt("totalSteps") ?: obj.opt("steps")),
    totalDistance = HuaweiExportJson.number(obj.opt("totalDistance") ?: obj.opt("distance")),
    totalCalories = HuaweiExportJson.number(obj.opt("totalCalories") ?: obj.opt("calorie") ?: obj.opt("calories")),
    totalTime = HuaweiExportJson.number(obj.opt("totalTime") ?: obj.opt("duration")),
    timeZone = obj.optString("timeZone", "").ifEmpty { null },
    attribute = obj.optString("attribute", ""),
  )

  /** Regex fallback for a record that is not valid JSON; null when not even a start time can be found. */
  fun fromBrokenText(text: String): RawMotionPath? {
    fun scalar(name: String): Double? =
      Regex("\"$name\"\\s*:\\s*\"?(-?[0-9][0-9.Ee+-]*)").find(text)?.groupValues?.get(1)?.toDoubleOrNull()?.takeIf { it.isFinite() }
    val startMs = HuaweiExportJson.epochMs(scalar("startTime"))
    val attribute = text.replace("\\n", "\n")
    if (startMs == null && !attribute.contains("tp=lbs")) return null
    return RawMotionPath(
      startMs = startMs,
      endMs = HuaweiExportJson.epochMs(scalar("endTime")),
      sportType = scalar("sportType")?.roundToInt(),
      totalSteps = scalar("totalSteps"),
      totalDistance = scalar("totalDistance"),
      totalCalories = scalar("totalCalories"),
      totalTime = scalar("totalTime"),
      timeZone = Regex("\"timeZone\"\\s*:\\s*\"([^\"]*)\"").find(text)?.groupValues?.get(1),
      attribute = attribute,
    )
  }

  fun parseTrack(attribute: String): MotionTrack {
    val gps = ArrayList<GpsFix>()
    val heartRates = ArrayList<SensorReading>()
    val altitudes = ArrayList<SensorReading>()
    var pendingBreak = false
    for (line in attribute.split('\n')) {
      val at = line.indexOf("tp=")
      if (at < 0) continue
      val fields = HashMap<String, String>()
      for (part in line.substring(at).split(';')) {
        val eq = part.indexOf('=')
        if (eq > 0) fields[part.substring(0, eq).trim()] = part.substring(eq + 1).trim()
      }
      when (fields["tp"]) {
        "lbs" -> {
          val lat = HuaweiExportJson.number(fields["lat"])
          val lon = HuaweiExportJson.number(fields["lon"])
          val t = HuaweiExportJson.number(fields["t"])
          if (lat == null || lon == null) continue
          if (lat == 90.0 && lon == -80.0) {
            pendingBreak = true
          } else if (t != null && abs(lat) <= 90.0 && abs(lon) <= 180.0 && !(lat == 0.0 && lon == 0.0)) {
            val seconds = (if (t > 1e11) t / 1000.0 else t).roundToInt().toLong()
            // 0 is "no altitude" in these fixes; the barometer series carries the real one.
            val alt = HuaweiExportJson.number(fields["alt"])?.takeIf { it != 0.0 }
            gps.add(GpsFix(seconds, lat, lon, alt, pendingBreak))
            pendingBreak = false
          }
        }
        "h-r" -> {
          val ms = HuaweiExportJson.number(fields["k"])
          val bpm = HuaweiExportJson.number(fields["v"])?.roundToInt()
          if (ms != null && bpm != null && bpm in HR_RANGE_MIN..HR_RANGE_MAX) heartRates.add(SensorReading((ms / 1000.0).toLong(), bpm.toDouble()))
        }
        "alti" -> {
          val ms = HuaweiExportJson.number(fields["k"])
          val metres = HuaweiExportJson.number(fields["v"])
          if (ms != null && metres != null) altitudes.add(SensorReading((ms / 1000.0).toLong(), metres))
        }
      }
    }
    return MotionTrack(gps, heartRates, altitudes)
  }

  /** The workout [raw] describes, or null when it has no usable start or no duration at all. */
  fun build(raw: RawMotionPath): ImportedWorkout? {
    val track = parseTrack(raw.attribute)
    val trackTimes = track.gps.map { it.ts } + track.heartRates.map { it.ts } + track.altitudes.map { it.ts }
    val start = raw.startMs?.div(1000) ?: trackTimes.minOrNull() ?: return null
    val elapsedMs = raw.endMs?.let { it - start * 1000 }
    val movingSec = totalTimeSeconds(raw.totalTime, elapsedMs)
    var end = raw.endMs?.div(1000) ?: trackTimes.maxOrNull() ?: start
    if (end <= start) end = start + (movingSec ?: 0L)
    if (end <= start) return null
    val duration = (end - start).toInt()

    val distance = (raw.totalDistance?.takeIf { it > 0 } ?: trackDistance(track.gps)).roundToInt()
    val heartRates = track.heartRates.map { it.value.toInt() }
    val avgHr = if (heartRates.isEmpty()) null else heartRates.average().roundToInt()
    val maxHr = heartRates.maxOrNull()
    val kind = WorkoutSportTypes.kind(HuaweiExportSports.joyofitType(raw.sportType))

    val points = ArrayList<WorkoutPoint>(track.gps.size + track.heartRates.size + track.altitudes.size)
    for (g in track.gps) points.add(WorkoutPoint(g.ts, g.lat, g.lon, g.alt, null))
    for (h in track.heartRates) points.add(WorkoutPoint(h.ts, null, null, null, h.value.toInt()))
    for (a in track.altitudes) points.add(WorkoutPoint(a.ts, null, null, a.value, null))
    // Stable: GPS fixes before sensor readings of the same second.
    val sorted = points.sortedBy { it.ts }

    return ImportedWorkout(
      start = start,
      end = end,
      sportType = HuaweiExportSports.joyofitType(raw.sportType),
      sportName = HuaweiExportSports.name(raw.sportType),
      duration = duration,
      distance = distance,
      calories = kcal(raw.totalCalories, duration),
      steps = raw.totalSteps?.roundToInt()?.coerceAtLeast(0) ?: 0,
      avgHr = avgHr,
      maxHr = maxHr,
      summaryJson = summaryJson(raw, kind, duration, distance, movingSec, track, heartRates).toString(),
      points = sorted,
    )
  }

  /**
   * Huawei's `totalCalories` is kcal in some exports and thousandths of one (small calories) in others. A figure that
   * would be more than [MAX_KCAL_PER_MINUTE] over the workout cannot be kcal, so it is divided by 1000. Whether other
   * scales exist is unknown until a real export is compared with the watch's own figure.
   */
  fun kcal(raw: Double?, durationSec: Int): Int {
    if (raw == null || raw <= 0.0) return 0
    val perMinute = raw / (durationSec / 60.0)
    return (if (durationSec > 0 && perMinute > MAX_KCAL_PER_MINUTE) raw / 1000.0 else raw).roundToInt()
  }

  /** `totalTime` in seconds, reading it as the unit (ms or s) that lands closer to the elapsed time; ms without one. */
  private fun totalTimeSeconds(totalTime: Double?, elapsedMs: Long?): Long? {
    if (totalTime == null || totalTime <= 0.0) return null
    if (elapsedMs == null || elapsedMs <= 0) return (totalTime / 1000.0).roundToInt().toLong()
    val asMs = abs(totalTime - elapsedMs)
    val asSec = abs(totalTime * 1000.0 - elapsedMs)
    return if (asSec < asMs) totalTime.roundToInt().toLong() else (totalTime / 1000.0).roundToInt().toLong()
  }

  /** Metres along the fixes, not across a pause. */
  fun trackDistance(gps: List<GpsFix>): Double {
    var total = 0.0
    for (i in 1 until gps.size) {
      if (gps[i].startsSegment) continue
      total += haversine(gps[i - 1].lat, gps[i - 1].lon, gps[i].lat, gps[i].lon)
    }
    return total
  }

  private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val r = 6_371_000.0
    val p1 = Math.toRadians(lat1)
    val p2 = Math.toRadians(lat2)
    val dp = p2 - p1
    val dl = Math.toRadians(lon2 - lon1)
    val a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))
  }

  /** Climb and descent of an altitude series, ignoring swings smaller than [ELEVATION_NOISE_M]. */
  fun elevationChange(altitudes: List<Double>): Pair<Double, Double> {
    if (altitudes.isEmpty()) return 0.0 to 0.0
    var reference = altitudes[0]
    var gain = 0.0
    var loss = 0.0
    for (a in altitudes) {
      if (a - reference >= ELEVATION_NOISE_M) {
        gain += a - reference
        reference = a
      } else if (reference - a >= ELEVATION_NOISE_M) {
        loss += reference - a
        reference = a
      }
    }
    return gain to loss
  }

  private fun summaryJson(
    raw: RawMotionPath,
    kind: String,
    duration: Int,
    distance: Int,
    movingSec: Long?,
    track: MotionTrack,
    heartRates: List<Int>,
  ): JSONObject {
    val json = JSONObject()
    json.put("kind", kind)
    json.put("source", "huawei-export")
    raw.sportType?.let { json.put("huaweiSportType", it) }
    raw.timeZone?.let { json.put("timeZone", it) }
    movingSec?.let { json.put("movingTimeSec", it) }
    json.put("gps", if (track.gps.isEmpty()) "none" else "ok")
    json.put("gpsPoints", track.gps.size)
    if (duration > 0 && distance > 0) {
      val avgSpeed = distance.toDouble() / duration
      json.put("avgSpeed", avgSpeed)
      if (WorkoutSportTypes.isPace(kind)) json.put("avgPaceSecPerKm", 1000.0 / avgSpeed)
    }
    heartRates.minOrNull()?.let { json.put("minHr", it) }
    if (track.altitudes.isNotEmpty()) {
      val values = track.altitudes.map { it.value }
      json.put("minAltitude", values.min())
      json.put("maxAltitude", values.max())
      json.put("avgAltitude", values.average())
      val (gain, loss) = elevationChange(values)
      json.put("elevationGain", gain)
      json.put("elevationLoss", loss)
    }
    return json
  }
}

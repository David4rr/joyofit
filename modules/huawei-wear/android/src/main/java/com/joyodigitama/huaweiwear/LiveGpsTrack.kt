package com.joyodigitama.huaweiwear

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** One fix of the phone's GPS, as [LiveWorkout] follows a workout the watch runs. Pure data, so the arithmetic below runs on the JVM. */
internal class TrackFix(
  val timeMs: Long,
  val lat: Double,
  val lon: Double,
  val altitudeM: Double?,
  val accuracyM: Float?,
  val speedMps: Float?,
  val bearingDeg: Float?,
)

/**
 * Distance, climb and current speed of a workout from the phone's own GPS, for the figures the watch does not send (a band
 * without a GPS of its own reports no distance or pace until the phone's fixes reach it, and some never report a climb).
 * Fed with the fixes of the stretch the workout is RUNNING; the pauses are simply not fed.
 *  - Fixes worse than [MAX_ACCURACY_M] are dropped, and a step shorter than [MIN_STEP_M] from the last kept fix is jitter (the
 *    kept fix does not move, so a slow drift still adds up once it is past the threshold).
 *  - A jump faster than [MAX_SPEED_MPS] is a bad fix.
 *  - The climb runs on a smoothed altitude (GPS altitude jumps by metres) with a [RISE_HYSTERESIS_M] dead band, so noise does not
 *    add up to metres of "climb" while standing still.
 *  - The current speed is the distance of the last [SPEED_WINDOW_MS], once at least [SPEED_MIN_SPAN_MS] of it is known.
 */
internal class TrackAccumulator {
  var distanceM = 0.0
    private set
  var riseM = 0.0
    private set

  private var last: TrackFix? = null
  private var smoothedAlt: Double? = null
  private var referenceAlt: Double? = null
  private val window = ArrayDeque<Pair<Long, Double>>()

  /** Metres per second over the recent window, null while there is not enough of it (or the person stands still: then 0). */
  val speedMps: Double?
    get() {
      val newest = window.lastOrNull() ?: return null
      val oldest = window.first()
      val span = newest.first - oldest.first
      if (span < SPEED_MIN_SPAN_MS) return null
      return (newest.second - oldest.second) / (span / 1000.0)
    }

  /** Seconds per kilometre of [speedMps]; null when unknown or when standing (below [MIN_PACE_SPEED_MPS], a pace would be meaningless). */
  val paceSecPerKm: Int?
    get() {
      val v = speedMps ?: return null
      return if (v >= MIN_PACE_SPEED_MPS) (1000.0 / v).toInt() else null
    }

  fun reset() {
    distanceM = 0.0
    riseM = 0.0
    last = null
    smoothedAlt = null
    referenceAlt = null
    window.clear()
  }

  /** The workout was paused (or only starts now): the next fix begins a new stretch, nothing is added for the way in between. */
  fun gap() {
    last = null
    window.clear()
  }

  /** Takes a fix of the running workout; false when it was dropped. */
  fun add(fix: TrackFix): Boolean {
    if (fix.accuracyM != null && fix.accuracyM > MAX_ACCURACY_M) return false
    val prev = last
    if (prev == null) {
      last = fix
      window.addLast(fix.timeMs to distanceM)
      takeAltitude(fix)
      return true
    }
    val dtS = (fix.timeMs - prev.timeMs) / 1000.0
    if (dtS <= 0.0) return false
    val step = haversineM(prev.lat, prev.lon, fix.lat, fix.lon)
    if (step / dtS > MAX_SPEED_MPS) return false
    // The altitude and the speed window follow every good fix, the distance only a real step.
    takeAltitude(fix)
    if (step < MIN_STEP_M) {
      window.addLast(fix.timeMs to distanceM)
      trim(fix.timeMs)
      return true
    }
    distanceM += step
    last = fix
    window.addLast(fix.timeMs to distanceM)
    trim(fix.timeMs)
    return true
  }

  private fun trim(nowMs: Long) {
    while (window.size > 2 && nowMs - window.first().first > SPEED_WINDOW_MS) window.removeFirst()
  }

  private fun takeAltitude(fix: TrackFix) {
    val alt = fix.altitudeM ?: return
    val smooth = smoothedAlt?.let { it + ALT_ALPHA * (alt - it) } ?: alt
    smoothedAlt = smooth
    val ref = referenceAlt
    if (ref == null) {
      referenceAlt = smooth
    } else if (smooth - ref >= RISE_HYSTERESIS_M) {
      riseM += smooth - ref
      referenceAlt = smooth
    } else if (ref - smooth >= RISE_HYSTERESIS_M) {
      referenceAlt = smooth
    }
  }

  companion object {
    const val MAX_ACCURACY_M = 30f
    const val MIN_STEP_M = 3.0
    const val MAX_SPEED_MPS = 30.0
    const val ALT_ALPHA = 0.25
    const val RISE_HYSTERESIS_M = 3.0
    const val SPEED_WINDOW_MS = 10_000L
    const val SPEED_MIN_SPAN_MS = 3_000L

    /** Below this (about 1:00:00 per km) the person is standing and no pace is shown. */
    const val MIN_PACE_SPEED_MPS = 0.28

    private const val EARTH_RADIUS_M = 6_371_008.8

    fun haversineM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
      val p1 = Math.toRadians(lat1)
      val p2 = Math.toRadians(lat2)
      val dLat = p2 - p1
      val dLon = Math.toRadians(lon2 - lon1)
      val a = sin(dLat / 2) * sin(dLat / 2) + cos(p1) * cos(p2) * sin(dLon / 2) * sin(dLon / 2)
      return 2 * EARTH_RADIUS_M * asin(sqrt(a.coerceIn(0.0, 1.0)))
    }
  }
}

/**
 * Whether a watch that gives no sign of when its workout starts (it does not answer the `17/03` poll and sends no `17/11`
 * report) has been started: [FIXES] fixes in a row at a walking pace or faster. The person standing on the watch's GO screen does
 * not move, so this does not start the clock early the way the first GPS request used to; a watch that does talk never needs it.
 */
internal class MotionStart {
  private var run = 0

  /** True once the person has been moving for [FIXES] good fixes in a row. */
  fun onFix(speedMps: Float?, accuracyM: Float?): Boolean {
    val moving = speedMps != null && speedMps >= MIN_SPEED_MPS && (accuracyM == null || accuracyM <= TrackAccumulator.MAX_ACCURACY_M)
    run = if (moving) run + 1 else 0
    return run >= FIXES
  }

  fun reset() {
    run = 0
  }

  companion object {
    const val FIXES = 3
    const val MIN_SPEED_MPS = 1.0f
  }
}

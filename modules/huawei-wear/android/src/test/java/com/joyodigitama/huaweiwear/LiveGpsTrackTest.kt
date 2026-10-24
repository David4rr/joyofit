package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveGpsTrackTest {
  private val metersPerDegree = 111_194.93

  private fun fix(sec: Int, northM: Double, alt: Double? = 100.0, accuracy: Float? = 5f, speed: Float? = 3f) =
    TrackFix(1_000_000L + sec * 1000L, 10.0 + northM / metersPerDegree, 20.0, alt, accuracy, speed, null)

  @Test
  fun distanceAddsUpAlongARun() {
    val track = TrackAccumulator()
    for (s in 0..20) assertTrue(track.add(fix(s, s * 3.0)))
    assertEquals(60.0, track.distanceM, 0.5)
  }

  @Test
  fun jitterOnTheSpotAddsNothing() {
    val track = TrackAccumulator()
    for (s in 0..30) track.add(fix(s, if (s % 2 == 0) 0.0 else 1.5))
    assertEquals(0.0, track.distanceM, 0.001)
  }

  @Test
  fun aSlowDriftStillAddsUpOnceItIsPastTheStepThreshold() {
    val track = TrackAccumulator()
    // 1 m per second: each step alone is jitter, but the kept fix stays put until the way from it passes 3 m.
    for (s in 0..30) track.add(fix(s, s * 1.0))
    assertEquals(30.0, track.distanceM, 3.1)
  }

  @Test
  fun aBadFixIsDropped() {
    val track = TrackAccumulator()
    track.add(fix(0, 0.0))
    assertFalse(track.add(fix(1, 3.0, accuracy = 80f)))
    assertEquals(0.0, track.distanceM, 0.001)
  }

  @Test
  fun aJumpIsDropped() {
    val track = TrackAccumulator()
    track.add(fix(0, 0.0))
    // 500 m in a second.
    assertFalse(track.add(fix(1, 500.0)))
    assertEquals(0.0, track.distanceM, 0.001)
  }

  @Test
  fun aGapDoesNotJoinTheStretchesOnEitherSide() {
    val track = TrackAccumulator()
    for (s in 0..10) track.add(fix(s, s * 3.0))
    val before = track.distanceM
    track.gap()
    // The person walked 400 m while the workout was paused.
    for (s in 300..310) track.add(fix(s, 400.0 + (s - 300) * 3.0))
    assertEquals(before + 30.0, track.distanceM, 0.5)
  }

  @Test
  fun paceFollowsTheRecentSpeed() {
    val track = TrackAccumulator()
    for (s in 0..20) track.add(fix(s, s * 3.0))
    val pace = track.paceSecPerKm
    assertNotNull(pace)
    assertEquals(333.0, pace!!.toDouble(), 5.0)
  }

  @Test
  fun standingStillHasNoPace() {
    val track = TrackAccumulator()
    for (s in 0..20) track.add(fix(s, 0.0))
    assertNull(track.paceSecPerKm)
  }

  @Test
  fun noPaceBeforeEnoughOfTheWindowIsKnown() {
    val track = TrackAccumulator()
    track.add(fix(0, 0.0))
    track.add(fix(1, 3.0))
    assertNull(track.paceSecPerKm)
  }

  @Test
  fun climbCountsARealRiseButNotNoise() {
    val ramp = TrackAccumulator()
    for (s in 0..40) ramp.add(fix(s, s * 3.0, alt = 100.0 + s * 0.5))
    // 20 m up, the smoothing lags a little behind.
    assertTrue("rise ${ramp.riseM}", ramp.riseM in 14.0..20.5)

    val flat = TrackAccumulator()
    for (s in 0..40) flat.add(fix(s, s * 3.0, alt = 100.0 + if (s % 2 == 0) 1.5 else -1.5))
    assertEquals(0.0, flat.riseM, 0.001)
  }

  @Test
  fun descendingDoesNotCountAndTheNextClimbStartsFromTheBottom() {
    val track = TrackAccumulator()
    for (s in 0..30) track.add(fix(s, s * 3.0, alt = 100.0 - s * 0.5))
    assertEquals(0.0, track.riseM, 0.001)
    for (s in 31..70) track.add(fix(s, s * 3.0, alt = 85.0 + (s - 30) * 0.5))
    assertTrue("rise ${track.riseM}", track.riseM in 11.0..20.5)
  }

  @Test
  fun motionStartNeedsThreeMovingFixesInARow() {
    val m = MotionStart()
    assertFalse(m.onFix(2.5f, 5f))
    assertFalse(m.onFix(2.5f, 5f))
    assertTrue(m.onFix(2.5f, 5f))
  }

  @Test
  fun standingOnTheGoScreenNeverStartsIt() {
    val m = MotionStart()
    repeat(100) { assertFalse(m.onFix(0.2f, 5f)) }
  }

  @Test
  fun aSlowFixOrABadOneBreaksTheRun() {
    val m = MotionStart()
    m.onFix(2.5f, 5f)
    m.onFix(2.5f, 5f)
    assertFalse(m.onFix(0.3f, 5f))
    assertFalse(m.onFix(2.5f, 5f))
    assertFalse(m.onFix(2.5f, 80f))
    assertFalse(m.onFix(null, 5f))
  }
}

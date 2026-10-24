package com.joyodigitama.huaweiwear

import java.time.LocalDateTime
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as `eveningDoze.test.ts`: a short session starting after 19:00 joins the session that follows within 8 h. */
class EveningDozeTest {
  private val zone = ZoneOffset.ofHours(7)
  private val min = 60L

  /** Unix seconds of `HH:MM` on 2026-10-[day], local time of [zone]. */
  private fun at(day: Int, clock: String): Long {
    val (h, m) = clock.split(":").map { it.toInt() }
    return LocalDateTime.of(2026, 10, day, h, m).toEpochSecond(zone)
  }

  private fun seg(day: Int, from: String, toDay: Int, to: String, breakBefore: Boolean = false, afterWorkout: Boolean = false) =
    SleepSegment(at(day, from), at(toDay, to), 6, null, breakBefore, afterWorkout)

  @Test
  fun salimsDozeBeforeTheNightIsPartOfTheNight() {
    val night = SleepReport.lastNight(listOf(seg(23, "21:55", 23, "22:42"), seg(24, "02:00", 24, "05:13")), zone)!!
    assertEquals(at(23, "21:55"), night.start)
    assertEquals(at(24, "05:13"), night.end)
    assertEquals(47 * min + 193 * min, night.totalSec)
    assertTrue(night.totalSec >= SleepReport.MIN_NIGHT_SEC)
  }

  @Test
  fun anAfternoonNapStaysItsOwnSession() {
    val last = SleepReport.lastNight(listOf(seg(23, "14:00", 23, "15:00"), seg(24, "02:00", 24, "05:13")), zone)!!
    assertEquals(at(24, "02:00"), last.start)
    val nap = SleepReport.lastNight(listOf(seg(23, "14:00", 23, "15:00")), zone)!!
    assertEquals(at(23, "14:00"), nap.start)
    assertTrue(nap.totalSec < SleepReport.MIN_NIGHT_SEC)
  }

  @Test
  fun aDozeWithNothingWithinEightHoursAfterItStaysANap() {
    val last = SleepReport.lastNight(listOf(seg(23, "21:55", 23, "22:42"), seg(24, "06:43", 24, "10:00")), zone)!!
    assertEquals(at(24, "06:43"), last.start)
    val alone = SleepReport.lastNight(listOf(seg(23, "21:55", 23, "22:42")), zone)!!
    assertEquals(at(23, "21:55"), alone.start)
    assertTrue(alone.totalSec < SleepReport.MIN_NIGHT_SEC)
  }

  @Test
  fun aWorkoutBetweenDozeAndNightKeepsThemApart() {
    val last = SleepReport.lastNight(listOf(seg(23, "21:55", 23, "22:42"), seg(24, "02:00", 24, "05:13", breakBefore = true, afterWorkout = true)), zone)!!
    assertEquals(at(24, "02:00"), last.start)
  }

  @Test
  fun theGapMarkOfTheCleaningStepDoesNotKeepThemApart() {
    val cleaned = SleepCleaning.cleanUnstagedSleep(listOf(seg(23, "21:55", 23, "22:42"), seg(24, "02:00", 24, "05:13")), SleepEvidence.NONE)
    assertTrue(cleaned[1].breakBefore)
    assertEquals(at(23, "21:55"), SleepReport.lastNight(cleaned, zone)!!.start)
  }
}

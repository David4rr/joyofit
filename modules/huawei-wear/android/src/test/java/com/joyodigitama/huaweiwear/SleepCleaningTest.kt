package com.joyodigitama.huaweiwear

import com.joyodigitama.huaweiwear.SleepCleaning.MIN_RUN_SEC
import com.joyodigitama.huaweiwear.SleepCleaning.workoutSpan
import java.time.LocalDateTime
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as `cleanSleep.test.ts`, with the fixtures reconstructed from the screenshots of the Watch Fit 2 user. */
class SleepCleaningTest {
  private val h = 3600L
  private val min = 60L

  /** Unix seconds of `HH:MM[:SS]` on 2026-10-[day], Western Indonesia Time (UTC+7), as the user's phone showed it. */
  private fun wib(day: Int, clock: String): Long {
    val parts = clock.split(':').map { it.toInt() }
    return LocalDateTime.of(2026, 10, day, parts[0], parts[1], parts.getOrElse(2) { 0 }).toEpochSecond(ZoneOffset.ofHours(7))
  }

  /** `TruSleep` state ranges as `SleepSync.segmentsFromState` stores them: raw kind 6, no stage. */
  private fun state(start: Long, end: Long) = SleepSegment(start, end, 6, null)

  private fun ranges(vararg rows: Triple<Int, String, Int>): List<SleepSegment> =
    rows.map { (day, clock, minutes) -> wib(day, clock).let { state(it, it + minutes * min) } }

  private fun evidence(
    workouts: List<TimeSpan> = emptyList(),
    spots: List<TimeSpan> = emptyList(),
    active: List<Long> = emptyList(),
  ) = SleepEvidence(workouts, spots, active)

  private fun clean(segments: List<SleepSegment>, evidence: SleepEvidence = SleepEvidence.NONE) =
    SleepCleaning.cleanUnstagedSleep(segments, evidence)

  /** Every minute of `[start, end)` as the watch's step table would hold it for a run. */
  private fun minutes(start: Long, end: Long): List<Long> = (start until end step min).toList()

  private fun key(s: SleepSegment) = listOf(s.start, s.end, s.type.toLong(), s.stage, s.breakBefore)

  private fun assertSame(expected: List<SleepSegment>, actual: List<SleepSegment>) =
    assertEquals(expected.map(::key), actual.map(::key))

  private fun withBreak(s: SleepSegment) = SleepSegment(s.start, s.end, s.type, s.stage, breakBefore = true)

  private fun totalSec(segments: List<SleepSegment>) = segments.sumOf { it.end - it.start }

  /** Friday 16 Oct, "Nap, 18:50 to 20:24, 7 min asleep": four fragments of 1 to 3 minutes. */
  private val hrvNap = ranges(
    Triple(16, "18:50", 1),
    Triple(16, "19:17", 2),
    Triple(16, "19:22", 1),
    Triple(16, "20:21", 3),
  )

  /** Saturday 17 Oct, "Nap, 06:06 to 09:05, 1 h 50 min asleep", 17 stage changes; the 33 minute block at 06:37 has the length of a morning workout. */
  private val morningFragments = ranges(
    Triple(17, "06:06", 5),
    Triple(17, "06:12", 3),
    Triple(17, "06:16", 3),
    Triple(17, "06:20", 4),
    Triple(17, "06:37", 33),
    Triple(17, "07:16", 1),
    Triple(17, "07:20", 2),
    Triple(17, "07:24", 4),
    Triple(17, "07:34", 3),
    Triple(17, "07:40", 4),
    Triple(17, "07:45", 16),
    Triple(17, "08:02", 1),
    Triple(17, "08:08", 3),
    Triple(17, "08:12", 1),
    Triple(17, "08:15", 2),
    Triple(17, "08:26", 19),
    Triple(17, "08:55", 4),
    Triple(17, "09:03", 2),
  )

  /** Sunday 18 Oct, "Night, 22:41 to 06:38, Sleep (no stages), 5 h 25 min", 22 stage changes; at 04:34 a block of 32 minutes: the morning run he started from the watch. */
  private val nightWithRun = ranges(
    Triple(17, "22:41", 7),
    Triple(18, "00:00", 239),
    Triple(18, "04:03", 5),
    Triple(18, "04:12", 1),
    Triple(18, "04:16", 3),
    Triple(18, "04:21", 1),
    Triple(18, "04:31", 2),
    Triple(18, "04:34", 32),
    Triple(18, "05:07", 2),
    Triple(18, "05:12", 2),
    Triple(18, "05:19", 1),
    Triple(18, "05:22", 3),
    Triple(18, "05:26", 5),
    Triple(18, "05:34", 1),
    Triple(18, "05:37", 1),
    Triple(18, "05:39", 2),
    Triple(18, "05:45", 5),
    Triple(18, "06:03", 1),
    Triple(18, "06:05", 2),
    Triple(18, "06:19", 5),
    Triple(18, "06:27", 2),
    Triple(18, "06:32", 2),
    Triple(18, "06:37", 1),
  )

  private val run = workoutSpan(wib(18, "04:34:05"), wib(18, "05:06:40"), 31 * min)

  @Test
  fun fixturesAreTheScreenshots() {
    assertEquals(5 * h + 25 * min, totalSec(nightWithRun))
    assertEquals(h + 50 * min, totalSec(morningFragments))
    assertEquals(7 * min, totalSec(hrvNap))
  }

  // HRV and stress checks recorded as sleep

  @Test
  fun theHrvNapOf16OctIsNotSleepAtAll() {
    val cleaned = clean(hrvNap)
    assertTrue(cleaned.isEmpty())
    assertTrue(NightHrv.nights(cleaned).isEmpty())
    assertNull(SleepReport.lastNight(cleaned))
  }

  @Test
  fun theMorningOf17OctKeepsTheBlockAndOneChainOfPiecesAMinuteApart() {
    // 07:40 + 07:45 + 08:02: 21 minutes with gaps of one minute, a run. Every other run holds 15 minutes or less.
    val f = morningFragments
    assertSame(listOf(f[4], f[9], f[10], f[11]), clean(f))
  }

  @Test
  fun withTheWorkoutThatBlockWasTheRestIsA21MinuteNap() {
    val f = morningFragments
    val cleaned = clean(f, evidence(workouts = listOf(workoutSpan(wib(17, "06:37"), wib(17, "07:10"), 33 * min))))
    assertSame(listOf(f[9], f[10], f[11]), cleaned)
    assertEquals(21 * min, NightHrv.nights(cleaned).single().asleepSec)
  }

  @Test
  fun aSpotHrvMeasurementInTheMiddleOfA25MinuteRangeLeavesTwoPiecesTooShortToBeSleep() {
    val start = wib(16, "15:00")
    val range = state(start, start + 25 * min)
    val spot = TimeSpan(start + 12 * min, start + 13 * min)
    assertSame(listOf(range), clean(listOf(range)))
    assertTrue(clean(listOf(range), evidence(spots = listOf(spot))).isEmpty())
  }

  // A workout started from the watch

  @Test
  fun withTheRunStoredTheNightIs0000To0359() {
    val cleaned = clean(nightWithRun, evidence(workouts = listOf(run)))
    assertSame(listOf(state(wib(18, "00:00"), wib(18, "03:59"))), cleaned)

    val night = NightHrv.nights(cleaned).single()
    assertEquals(wib(18, "00:00"), night.start)
    assertEquals(wib(18, "03:59"), night.end)
    assertEquals(239 * min, night.asleepSec)
    assertTrue(night.asleepSec >= SleepReport.MIN_NIGHT_SEC)
    assertEquals(239 * min, SleepReport.lastNight(cleaned)!!.totalSec)
  }

  @Test
  fun withOnlyTheStepsOfTheRunTheResultIsTheSame() {
    val cleaned = clean(nightWithRun, evidence(active = minutes(wib(18, "04:34"), wib(18, "05:06"))))
    assertSame(listOf(state(wib(18, "00:00"), wib(18, "03:59"))), cleaned)
  }

  @Test
  fun sleepOnBothSidesOfAWorkoutIsTwoSessionsInEveryBuilder() {
    val before = state(wib(18, "23:00"), wib(19, "04:30"))
    val after = state(wib(19, "05:30"), wib(19, "08:00"))
    val workout = workoutSpan(wib(19, "04:40"), wib(19, "05:20"), 40 * min)
    val cleaned = clean(listOf(before, after), evidence(workouts = listOf(workout)))
    assertSame(listOf(before, withBreak(after)), cleaned)

    // NightHrv.nights, oldest first.
    val nights = NightHrv.nights(cleaned)
    assertEquals(listOf(listOf(before.start, before.end, 330 * min), listOf(after.start, after.end, 150 * min)), nights.map { listOf(it.start, it.end, it.asleepSec) })

    // Today's report: only what follows the run.
    val last = SleepReport.lastNight(cleaned)!!
    assertEquals(after.start, last.start)
    assertEquals(150 * min, last.totalSec)

    // Health Connect: the gap between the two is exactly the hour that alone would not split them.
    assertEquals(1, HealthConnectPlan.sleepSessions(listOf(before, after), 0).size)
    val sessions = HealthConnectPlan.sleepSessions(cleaned, 0)
    assertEquals(listOf(before.start, after.start), sessions.map { it.startSec })
    assertEquals(listOf(before.end, after.end), sessions.map { it.endSec })
  }

  @Test
  fun aWorkoutInsideOneRangeCutsItAndTheSecondPieceStartsASession() {
    val range = state(wib(18, "00:00"), wib(18, "07:00"))
    val workout = workoutSpan(wib(18, "04:34"), wib(18, "05:06"), 32 * min)
    val cleaned = clean(listOf(range), evidence(workouts = listOf(workout)))
    assertSame(
      listOf(state(wib(18, "00:00"), wib(18, "04:34")), withBreak(state(wib(18, "05:06"), wib(18, "07:00")))),
      cleaned,
    )
  }

  @Test
  fun aWorkoutBetweenAStagedNightAndAStagelessRunStartsASessionToo() {
    val staged = SleepSegment(wib(18, "23:00"), wib(19, "06:30"), 6, "light")
    val nap = state(wib(19, "11:00"), wib(19, "12:00"))
    val workout = workoutSpan(wib(19, "09:00"), wib(19, "10:00"), h)
    assertSame(listOf(staged, withBreak(nap)), clean(listOf(staged, nap), evidence(workouts = listOf(workout))))
    assertSame(listOf(staged, nap), clean(listOf(staged, nap)))
  }

  @Test
  fun aWorkoutRowWithoutAUsableEndFallsBackToItsDuration() {
    val range = state(wib(18, "00:00"), wib(18, "07:00"))
    val span = workoutSpan(wib(18, "03:00"), 0, 30 * min)
    assertEquals(wib(18, "03:30"), span.end)
    val cleaned = clean(listOf(range), evidence(workouts = listOf(span)))
    assertEquals(listOf(wib(18, "03:30")), cleaned.filter { it.breakBefore }.map { it.start })
  }

  @Test
  fun theBreakSurvivesTheStrayAndBlipRules() {
    val before = state(wib(18, "23:00"), wib(19, "04:30"))
    val after = state(wib(19, "05:30"), wib(19, "08:00"))
    val cleaned = clean(listOf(before, after), evidence(workouts = listOf(workoutSpan(wib(19, "04:40"), wib(19, "05:20"), 40 * min))))
    val kept = withoutBlips(withoutStrayUnstaged(cleaned))
    assertSame(listOf(before, withBreak(after)), kept)
  }

  // Minimum sleep and long awake gaps

  @Test
  fun aNapNeedsTwentyMinutesOfContinuousSleep() {
    val at = wib(16, "14:00")
    assertTrue(clean(listOf(state(at, at + MIN_RUN_SEC - min))).isEmpty())
    assertEquals(1, clean(listOf(state(at, at + MIN_RUN_SEC))).size)
  }

  @Test
  fun fragmentsAFewMinutesApartAddUpToARunOnlyWhenTheGapsAreShort() {
    val at = wib(16, "14:00")
    val close = listOf(state(at, at + 10 * min), state(at + 11 * min, at + 22 * min))
    val far = listOf(state(at, at + 10 * min), state(at + 15 * min, at + 26 * min))
    assertEquals(2, clean(close).size)
    assertTrue(clean(far).isEmpty())
  }

  @Test
  fun aMinuteOfStepsInsideANightDoesNotSplitIt() {
    val range = state(wib(18, "23:00"), wib(19, "06:00"))
    val trip = wib(19, "02:10")
    val cleaned = clean(listOf(range), evidence(active = listOf(trip)))
    assertSame(listOf(state(range.start, trip), state(trip + min, range.end)), cleaned)
    val nights = NightHrv.nights(cleaned)
    assertEquals(1, nights.size)
    assertEquals(7 * h - min, nights[0].asleepSec)
  }

  @Test
  fun halfAnHourOfWalkingInsideARangeEndsTheNightThere() {
    val range = state(wib(18, "23:00"), wib(19, "06:00"))
    val cleaned = clean(listOf(range), evidence(active = minutes(wib(19, "02:00"), wib(19, "02:30"))))
    assertSame(listOf(state(range.start, wib(19, "02:00")), state(wib(19, "02:30"), range.end)), cleaned)
  }

  @Test
  fun moreThanAnHourWithNothingRecordedBetweenTwoRunsIsTwoSessions() {
    val a = state(wib(18, "23:00"), wib(19, "02:00"))
    val b = state(wib(19, "03:30"), wib(19, "06:00"))
    val cleaned = clean(listOf(a, b))
    assertSame(listOf(a, withBreak(b)), cleaned)
    assertEquals(2, NightHrv.nights(cleaned).size)
  }

  @Test
  fun halfAnHourWithNothingRecordedIsStillOneSession() {
    val a = state(wib(18, "23:00"), wib(19, "02:00"))
    val b = state(wib(19, "02:30"), wib(19, "06:00"))
    val cleaned = clean(listOf(a, b))
    assertSame(listOf(a, b), cleaned)
    assertEquals(1, NightHrv.nights(cleaned).size)
  }

  @Test
  fun twoOverlappingStagelessRangesOfOneNightCountOnce() {
    val a = state(wib(18, "23:00"), wib(19, "05:00"))
    val b = SleepSegment(wib(19, "01:00"), wib(19, "06:00"), 1, null)
    assertEquals(7 * h, totalSec(clean(listOf(a, b))))
  }

  // Watches with stages

  private val stagedNight = listOf(
    SleepSegment(wib(18, "23:00"), wib(19, "02:00"), 6, "light"),
    SleepSegment(wib(19, "02:00"), wib(19, "04:00"), 7, "deep"),
    SleepSegment(wib(19, "04:00"), wib(19, "04:03"), 0x5658, "awake"),
    SleepSegment(wib(19, "04:03"), wib(19, "06:30"), 0x5656, "rem"),
  )

  @Test
  fun stagedSegmentsComeBackAsStoredWithEveryKindOfEvidenceOverThem() {
    val all = evidence(
      workouts = listOf(workoutSpan(wib(19, "03:00"), wib(19, "03:40"), 40 * min)),
      spots = listOf(TimeSpan(wib(19, "01:00"), wib(19, "01:01"))),
      active = minutes(wib(19, "04:10"), wib(19, "04:40")),
    )
    val cleaned = clean(stagedNight, all)
    assertSame(stagedNight, cleaned)
    // The same objects: nothing is copied, so nothing can lose a field.
    assertTrue(cleaned.zip(stagedNight).all { (a, b) -> a === b })
  }

  @Test
  fun aShortStagedNapIsLeftToTheFiveMinuteBlipRuleNotTheTwentyMinuteOne() {
    val nap = SleepSegment(wib(19, "14:00"), wib(19, "14:12"), 6, "light")
    assertSame(listOf(nap), clean(listOf(nap)))
    assertTrue(NightHrv.nights(stagedNight + nap).any { it.asleepSec == 12 * min })
  }

  @Test
  fun stagelessFragmentsNextToAStagedNightAreStillDroppedByTheStrayRule() {
    val stray = state(wib(19, "06:35"), wib(19, "07:10"))
    val nights = NightHrv.nights(clean(stagedNight + stray))
    assertEquals(1, nights.size)
    assertEquals(wib(19, "06:30"), nights[0].end)
  }

  @Test
  fun anInputWithoutStagelessSegmentsIsOnlySorted() {
    val shuffled = listOf(stagedNight[2], stagedNight[0], stagedNight[3], stagedNight[1])
    assertSame(stagedNight, clean(shuffled))
  }

  // Health Connect sessions an earlier build wrote

  @Test
  fun theSessionAnEarlierBuildWroteOnTheFakeNightIsStale() {
    val raw = nightWithRun
    val cleaned = clean(raw, evidence(workouts = listOf(run)))
    val plan = HealthConnectPlan.sleepSessions(cleaned, 0)
    assertEquals(listOf("joyofit:sleep:${wib(18, "00:00")}"), plan.map { it.id })
    // The old plan had the 7 minute session at 22:41 as well, and the one from 00:00 (same id, rewritten in place).
    assertEquals(listOf("joyofit:sleep:${wib(17, "22:41")}"), HealthConnectPlan.staleSleepIds(raw, plan, 0))
  }

  @Test
  fun aStagedNightHasNothingStale() {
    val plan = HealthConnectPlan.sleepSessions(clean(stagedNight, evidence(workouts = listOf(workoutSpan(wib(19, "03:00"), wib(19, "03:40"), 40 * min)))), 0)
    assertTrue(HealthConnectPlan.staleSleepIds(stagedNight, plan, 0).isEmpty())
  }

  @Test
  fun aNapMadeOfStressChecksIsStaleOnlyWhenItEndsInTheWindow() {
    val plan = HealthConnectPlan.sleepSessions(clean(morningFragments, evidence(workouts = listOf(workoutSpan(wib(17, "06:37"), wib(17, "07:10"), 33 * min)))), 0)
    // The old plan wrote the 06:06 block of fragments (one session with the workout's block in it).
    val stale = HealthConnectPlan.staleSleepIds(morningFragments, plan, 0)
    assertTrue("joyofit:sleep:${wib(17, "06:06")}" in stale)
    assertTrue(HealthConnectPlan.staleSleepIds(morningFragments, plan, wib(17, "23:00")).isEmpty())
  }

  // Night HRV rows

  private fun night(start: Long, end: Long) = NightSpan(start, end, listOf(TimeSpan(start, end)))

  @Test
  fun nightHrvRowsOfANightThatIsStillANightStay() {
    val staged = night(wib(18, "23:00"), wib(19, "06:30"))
    val rows = listOf(TimeSpan(staged.start, staged.end), TimeSpan(staged.start + h, staged.end - h))
    assertTrue(SleepRulesRepair.staleNightRows(rows, listOf(staged)).isEmpty())
  }

  @Test
  fun nightHrvRowsOnAFakeNightOrWiderThanTheNightAreDeleted() {
    val real = night(wib(18, "00:00"), wib(18, "03:59"))
    val fake = TimeSpan(wib(17, "22:41"), wib(18, "06:38"))
    val onNothing = TimeSpan(wib(16, "18:50"), wib(16, "20:24"))
    val kept = TimeSpan(real.start, real.end)
    assertEquals(listOf(fake, onNothing), SleepRulesRepair.staleNightRows(listOf(fake, onNothing, kept), listOf(real)))
  }

  @Test
  fun aRowOnANightThatShrankToANapIsDeleted() {
    val nap = night(wib(17, "07:40"), wib(17, "08:03"))
    val row = TimeSpan(nap.start, nap.end)
    assertEquals(listOf(row), SleepRulesRepair.staleNightRows(listOf(row), listOf(nap)))
  }

  @Test
  fun theRowsOfNightsRebuiltFromTheCleanedSleepAreTheOnesTheNightHrvStepStores() {
    val nights = NightHrv.nights(clean(nightWithRun, evidence(workouts = listOf(run))))
    assertEquals(1, nights.size)
    val oldRow = TimeSpan(wib(17, "22:41"), wib(18, "06:38"))
    val newRow = TimeSpan(nights[0].start, nights[0].end)
    assertEquals(listOf(oldRow), SleepRulesRepair.staleNightRows(listOf(oldRow, newRow), nights))
    assertFalse(newRow in SleepRulesRepair.staleNightRows(listOf(oldRow, newRow), nights))
  }

  @Test
  fun theRepairRunsOncePerRulesVersion() {
    assertEquals(2, SleepCleaning.SLEEP_RULES_VERSION)
    assertTrue("never repaired", SleepRulesRepair.due(0))
    assertTrue("repaired under the rules before", SleepRulesRepair.due(SleepCleaning.SLEEP_RULES_VERSION - 1))
    assertFalse("repaired under these rules", SleepRulesRepair.due(SleepCleaning.SLEEP_RULES_VERSION))
  }
}

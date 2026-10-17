package com.joyodigitama.huaweiwear

import java.time.Instant
import java.time.ZoneId
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FamilySummaryTest {
  private val utc = ZoneId.of("UTC")
  private val jakarta = ZoneId.of("Asia/Jakarta")
  private val losAngeles = ZoneId.of("America/Los_Angeles")
  private val all = FamilyScopes(sync = true, steps = true, sleep = true, restingHr = true, spo2 = true)

  private fun sec(iso: String) = Instant.parse(iso).epochSecond

  private fun ms(iso: String) = Instant.parse(iso).toEpochMilli()

  private fun segment(from: String, to: String, stage: String? = "light") = SleepSegment(sec(from), sec(to), 0, stage)

  /** Rows by unix second; every method honours `[fromSec, toSec)` like the SQL does, and records that it was called. */
  private class FakeSource(
    val steps: List<FamilyStepRow> = emptyList(),
    val resting: Map<Long, Int> = emptyMap(),
    val spo2: Map<Long, Int> = emptyMap(),
    val sleep: List<SleepSegment> = emptyList(),
    val syncSec: Long? = null,
  ) : FamilySource {
    val calls = mutableSetOf<String>()

    override fun watchSyncSec(): Long? {
      calls += "sync"
      return syncSec
    }

    override fun newestSampleSec(fromSec: Long, toSec: Long): Long? {
      calls += "newest"
      return steps.map { it.timestamp }.filter { it in fromSec until toSec }.maxOrNull()
    }

    override fun stepSamples(fromSec: Long, toSec: Long): List<FamilyStepRow> {
      calls += "steps"
      return steps.filter { it.timestamp in fromSec until toSec }
    }

    override fun restingHeartRate(fromSec: Long, toSec: Long): Int? {
      calls += "restingHr"
      return resting.filterKeys { it in fromSec until toSec }.values.filter { it > 0 }.minOrNull()
    }

    override fun spo2Readings(fromSec: Long, toSec: Long): List<Int> {
      calls += "spo2"
      return spo2.filterKeys { it in fromSec until toSec }.values.toList()
    }

    override fun sleepSegments(fromSec: Long, toSec: Long): List<SleepSegment> {
      calls += "sleep"
      return sleep.filter { it.end in fromSec until toSec }
    }
  }

  private fun FamilyPayload.day(date: String) = days.single { it.date == date }

  @Test
  fun coversTheLastThreeLocalDaysOfThePhonesZone() {
    // 18:30 UTC on Oct 17 is already Oct 18 in Jakarta, still Oct 17 in Los Angeles.
    val now = ms("2026-10-17T18:30:00Z")
    val source = FakeSource(steps = listOf(FamilyStepRow(sec("2026-10-17T16:59:00Z"), 10), FamilyStepRow(sec("2026-10-17T17:00:00Z"), 20)))

    val jakartaPayload = FamilySummary.build(now, jakarta, all, source, null)
    assertEquals(420, jakartaPayload.tzOffsetMin)
    assertEquals(10, jakartaPayload.day("2026-10-17").steps)
    assertEquals(20, jakartaPayload.day("2026-10-18").steps)

    val laPayload = FamilySummary.build(now, losAngeles, all, source, null)
    assertEquals(-420, laPayload.tzOffsetMin)
    assertEquals(30, laPayload.day("2026-10-17").steps)
    assertEquals(listOf("2026-10-17"), laPayload.days.map { it.date })
  }

  @Test
  fun listsOnlyDaysWithDataOldestFirst() {
    val now = ms("2026-10-17T12:00:00Z")
    val source = FakeSource(
      steps = listOf(FamilyStepRow(sec("2026-10-15T08:00:00Z"), 5), FamilyStepRow(sec("2026-10-17T08:00:00Z"), 7), FamilyStepRow(sec("2026-10-14T08:00:00Z"), 99)),
    )
    val payload = FamilySummary.build(now, utc, all, source, null)
    assertEquals(listOf("2026-10-15", "2026-10-17"), payload.days.map { it.date })
  }

  @Test
  fun stepsFirstStepAndLastSample() {
    val now = ms("2026-10-17T12:00:00Z")
    val source = FakeSource(
      steps = listOf(
        FamilyStepRow(sec("2026-10-17T05:00:00Z"), 0),
        FamilyStepRow(sec("2026-10-17T06:10:00Z"), 12),
        FamilyStepRow(sec("2026-10-17T06:11:00Z"), 8),
        FamilyStepRow(sec("2026-10-17T09:00:00Z"), 0),
      ),
    )
    val day = FamilySummary.build(now, utc, all, source, null).day("2026-10-17")
    assertEquals(20, day.steps)
    assertEquals(ms("2026-10-17T06:10:00Z"), day.firstStepAt)
    assertEquals(ms("2026-10-17T09:00:00Z"), day.lastSampleAt)
  }

  @Test
  fun aDayOfZeroStepsHasNoFirstStep() {
    val now = ms("2026-10-17T12:00:00Z")
    val source = FakeSource(steps = listOf(FamilyStepRow(sec("2026-10-17T05:00:00Z"), 0)))
    val day = FamilySummary.build(now, utc, all, source, null).day("2026-10-17")
    assertEquals(0, day.steps)
    assertNull(day.firstStepAt)
  }

  @Test
  fun restingHeartRateIsTheLowestOfTheDay() {
    val now = ms("2026-10-17T12:00:00Z")
    val source = FakeSource(resting = mapOf(sec("2026-10-17T03:00:00Z") to 58, sec("2026-10-17T04:00:00Z") to 54, sec("2026-10-16T04:00:00Z") to 50))
    val payload = FamilySummary.build(now, utc, all, source, null)
    assertEquals(54, payload.day("2026-10-17").restingHr)
    assertEquals(50, payload.day("2026-10-16").restingHr)
  }

  @Test
  fun spo2MinimumAndLowCountIgnoreMissingReadings() {
    val now = ms("2026-10-17T12:00:00Z")
    val source = FakeSource(
      spo2 = mapOf(
        sec("2026-10-17T01:00:00Z") to 97,
        sec("2026-10-17T02:00:00Z") to 89,
        sec("2026-10-17T03:00:00Z") to 90,
        sec("2026-10-17T04:00:00Z") to 95,
        sec("2026-10-17T05:00:00Z") to 0,
      ),
    )
    val day = FamilySummary.build(now, utc, all, source, null).day("2026-10-17")
    assertEquals(89, day.spo2Min)
    assertEquals(2, day.spo2LowCount)
  }

  @Test
  fun sleepIsTheNightEndingOnTheDateBetween18And18Local() {
    val now = ms("2026-10-18T09:00:00Z")
    val source = FakeSource(
      sleep = listOf(
        // Ends Oct 17 05:00: the night of Oct 17.
        segment("2026-10-16T23:00:00Z", "2026-10-17T05:00:00Z"),
        // A 3 minute blip far from other sleep is not sleep.
        segment("2026-10-17T10:00:00Z", "2026-10-17T10:03:00Z"),
        // Ends exactly 18:00 on Oct 17: belongs to the next date's window.
        segment("2026-10-17T16:30:00Z", "2026-10-17T18:00:00Z"),
        segment("2026-10-17T23:30:00Z", "2026-10-18T02:00:00Z", "deep"),
        // Awake time inside the night is not slept.
        segment("2026-10-18T02:00:00Z", "2026-10-18T02:20:00Z", "awake"),
        segment("2026-10-18T02:20:00Z", "2026-10-18T06:30:00Z"),
      ),
    )
    val payload = FamilySummary.build(now, utc, all, source, null)
    assertEquals(360, payload.day("2026-10-17").sleepMin)
    assertEquals(150 + 250 + 90, payload.day("2026-10-18").sleepMin)
    assertTrue(payload.days.none { it.date == "2026-10-16" })
  }

  @Test
  fun sleepWindowFollowsThePhonesZone() {
    // 20:00 UTC is 03:00 on Oct 18 in Jakarta; its Oct 17 window closes at 11:00 UTC.
    val now = ms("2026-10-17T20:00:00Z")
    val source = FakeSource(
      sleep = listOf(
        segment("2026-10-17T10:00:00Z", "2026-10-17T10:59:00Z"),
        segment("2026-10-17T11:00:00Z", "2026-10-17T12:00:00Z"),
      ),
    )
    val payload = FamilySummary.build(now, jakarta, all, source, null)
    assertEquals(59, payload.day("2026-10-17").sleepMin)
    assertEquals(60, payload.day("2026-10-18").sleepMin)
  }

  @Test
  fun scopesThatAreNotGrantedAreNeverReadNorSent() {
    val now = ms("2026-10-17T12:00:00Z")
    val source = FakeSource(
      steps = listOf(FamilyStepRow(sec("2026-10-17T06:00:00Z"), 100)),
      resting = mapOf(sec("2026-10-17T03:00:00Z") to 55),
      spo2 = mapOf(sec("2026-10-17T03:00:00Z") to 88),
      sleep = listOf(segment("2026-10-16T23:00:00Z", "2026-10-17T06:00:00Z")),
      syncSec = sec("2026-10-17T11:00:00Z"),
    )

    val nothing = FamilyScopes(sync = false, steps = false, sleep = false, restingHr = false, spo2 = false)
    val none = FamilySummary.build(now, utc, nothing, source, 80)
    assertTrue(source.calls.isEmpty())
    assertTrue(none.isEmpty)
    assertNull(none.watchSyncAt)
    assertNull(none.battery)

    for (granted in listOf("steps", "sleep", "restingHr", "spo2", "sync")) {
      val scopes = FamilyScopes(sync = granted == "sync", steps = granted == "steps", sleep = granted == "sleep", restingHr = granted == "restingHr", spo2 = granted == "spo2")
      val spy = FakeSource(source.steps, source.resting, source.spo2, source.sleep, source.syncSec)
      val day = FamilySummary.build(now, utc, scopes, spy, 80).days.single()
      val sent = day.toJson()
      val expected = when (granted) {
        "steps" -> setOf("date", "steps", "firstStepAt")
        "sleep" -> setOf("date", "sleepMin")
        "restingHr" -> setOf("date", "restingHr")
        "spo2" -> setOf("date", "spo2Min", "spo2LowCount")
        else -> setOf("date", "lastSampleAt")
      }
      assertEquals(granted, expected, sent.keys().asSequence().toSet())
      val expectedCalls = when (granted) {
        "sync" -> setOf("sync", "newest")
        else -> setOf(granted)
      }
      assertEquals(granted, expectedCalls, spy.calls)
    }
  }

  @Test
  fun syncScopeCarriesWatchSyncAndBattery() {
    val now = ms("2026-10-17T12:00:00Z")
    val source = FakeSource(syncSec = sec("2026-10-17T11:00:00Z"))
    val payload = FamilySummary.build(now, utc, FamilyScopes(sync = true, steps = false, sleep = false, restingHr = false, spo2 = false), source, 64)
    assertEquals(ms("2026-10-17T11:00:00Z"), payload.watchSyncAt)
    assertEquals(64, payload.battery)
    assertEquals(now, payload.sentAt)
    assertFalse(payload.isEmpty)
    assertTrue(payload.days.isEmpty())
  }

  @Test
  fun emptyDatabaseHasNothingToSend() {
    val now = ms("2026-10-17T12:00:00Z")
    val payload = FamilySummary.build(now, utc, all, FakeSource(), null)
    assertTrue(payload.days.isEmpty())
    assertTrue(payload.isEmpty)
  }

  @Test
  fun bodyHasTheContractShape() {
    val now = ms("2026-10-17T12:00:00Z")
    val source = FakeSource(steps = listOf(FamilyStepRow(sec("2026-10-17T06:00:00Z"), 100)))
    val body = JSONObject(FamilySummary.build(now, jakarta, all, source, null).toJson())
    assertEquals(setOf("sentAt", "tzOffsetMin", "watchSyncAt", "battery", "days"), body.keys().asSequence().toSet())
    assertEquals(now, body.getLong("sentAt"))
    assertEquals(420, body.getInt("tzOffsetMin"))
    assertTrue(body.isNull("watchSyncAt"))
    assertTrue(body.isNull("battery"))
    val days = body.getJSONArray("days")
    assertEquals(1, days.length())
    assertEquals("2026-10-17", days.getJSONObject(0).getString("date"))
    assertEquals(100, days.getJSONObject(0).getInt("steps"))
  }

  @Test
  fun serverAnswersMapToOutcomes() {
    assertEquals(FamilyOutcome.SENT, familyOutcomeForStatus(200))
    assertEquals(FamilyOutcome.REJECTED, familyOutcomeForStatus(401))
    assertEquals(FamilyOutcome.REJECTED, familyOutcomeForStatus(403))
    assertEquals(FamilyOutcome.FAILED, familyOutcomeForStatus(500))
    assertEquals(FamilyOutcome.FAILED, familyOutcomeForStatus(429))
  }

  @Test
  fun throttleWaitsTenMinutesUnlessForcedOrTheWatchSynced() {
    val interval = FamilyUploader.MIN_INTERVAL_MS
    val posted = 1_000_000L
    assertFalse(familyShouldPost(false, posted + interval - 1, posted, 5L, 5L))
    assertTrue(familyShouldPost(false, posted + interval, posted, 5L, 5L))
    assertTrue(familyShouldPost(false, posted + 1, posted, 5L, 6L))
    assertTrue(familyShouldPost(false, posted + 1, posted, null, 6L))
    assertTrue(familyShouldPost(true, posted + 1, posted, 5L, 5L))
    assertFalse(familyShouldPost(false, 5L, 0L, null, null))
    assertTrue(familyShouldPost(false, interval, 0L, null, null))
  }
}

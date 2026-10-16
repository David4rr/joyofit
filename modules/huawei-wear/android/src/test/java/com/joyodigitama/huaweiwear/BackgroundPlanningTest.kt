package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Test

class BackgroundPlanningTest {
  @Test
  fun backoffDoublesUpToFiveMinutes() {
    var backoff = BackgroundController.INITIAL_BACKOFF_MS
    val seen = ArrayList<Long>()
    repeat(8) {
      seen.add(backoff)
      backoff = nextBackoff(backoff)
    }
    assertEquals(listOf(5_000L, 10_000L, 20_000L, 40_000L, 80_000L, 160_000L, 300_000L, 300_000L), seen)
  }

  @Test
  fun firstSyncAsksForEverythingTheWatchHolds() {
    assertEquals(0L, syncWindowStart(null))
  }

  @Test
  fun laterSyncsOverlapByOneHour() {
    assertEquals(500_000L - 3600, syncWindowStart(500_000L))
    assertEquals(0L, syncWindowStart(100L))
  }

  @Test
  fun shortWindowIsOneSlice() {
    assertEquals(listOf(900_000L to 1_000_000L), syncSlices(900_000L, 1_000_000L))
  }

  @Test
  fun longHistoryIsOneHeadSliceThenFortnights() {
    val now = 100_000_000L
    val slices = syncSlices(0L, now)
    assertEquals(0L to now - SYNC_HEAD_SEC, slices.first())
    assertEquals(now, slices.last().second)
    for (i in 1 until slices.size) assertEquals(slices[i - 1].second, slices[i].first)
    assertEquals(true, slices.drop(1).all { it.second - it.first <= SYNC_SLICE_SEC })
  }
}

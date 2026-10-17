package com.joyodigitama.huaweiwear

/** [FamilySource] over the sync database: the rows the watch synced, `imported = 0` only. */
internal class FamilyStoreSource(private val store: SyncStore) : FamilySource {
  override fun watchSyncSec(): Long? = store.read { db ->
    db.rawQuery("SELECT MAX(last_sync) FROM device", null).use { if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null }
  }

  override fun newestSampleSec(fromSec: Long, toSec: Long): Long? = store.read { db ->
    db.rawQuery(
      "SELECT MAX(timestamp) FROM step_samples WHERE imported = 0 AND timestamp >= ? AND timestamp < ?",
      range(fromSec, toSec),
    ).use { if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null }
  }

  override fun stepSamples(fromSec: Long, toSec: Long): List<FamilyStepRow> = store.read { db ->
    db.rawQuery(
      "SELECT timestamp, steps FROM step_samples WHERE imported = 0 AND timestamp >= ? AND timestamp < ? ORDER BY timestamp",
      range(fromSec, toSec),
    ).use {
      val rows = ArrayList<FamilyStepRow>(it.count)
      while (it.moveToNext()) rows.add(FamilyStepRow(it.getLong(0), it.getInt(1)))
      rows
    }
  }

  override fun restingHeartRate(fromSec: Long, toSec: Long): Int? = store.read { db ->
    db.rawQuery(
      "SELECT MIN(resting_heart_rate) FROM step_samples WHERE imported = 0 AND timestamp >= ? AND timestamp < ? AND resting_heart_rate > 0",
      range(fromSec, toSec),
    ).use { if (it.moveToFirst() && !it.isNull(0)) it.getInt(0) else null }
  }

  override fun spo2Readings(fromSec: Long, toSec: Long): List<Int> = store.read { db ->
    db.rawQuery(
      "SELECT spo2 FROM step_samples WHERE imported = 0 AND timestamp >= ? AND timestamp < ? AND spo2 > 0",
      range(fromSec, toSec),
    ).use {
      val readings = ArrayList<Int>(it.count)
      while (it.moveToNext()) readings.add(it.getInt(0))
      readings
    }
  }

  override fun sleepSegments(fromSec: Long, toSec: Long): List<SleepSegment> = store.read { db ->
    db.rawQuery(
      "SELECT start, end, type, stage FROM sleep_segments WHERE imported = 0 AND end >= ? AND end < ? ORDER BY start",
      range(fromSec, toSec),
    ).use {
      val segments = ArrayList<SleepSegment>(it.count)
      while (it.moveToNext()) segments.add(SleepSegment(it.getLong(0), it.getLong(1), it.getInt(2), if (it.isNull(3)) null else it.getString(3)))
      segments
    }
  }

  private fun range(fromSec: Long, toSec: Long) = arrayOf(fromSec.toString(), toSec.toString())
}

package com.joyodigitama.huaweiwear

/**
 * Writes an import into `joyofit.db` through [SyncStore]'s connection. The rules, in one place:
 *
 * - **Watch data wins.** Rows are inserted with `imported = 1` (migration `imported` in
 *   `schema/joyofit-db-migrations.json`) and never replace a row that exists. A minute the watch already stored only
 *   gets heart rate, SpO2 and resting heart rate filled in where those are NULL (`COALESCE`), never its steps,
 *   distance or calories. A sleep segment is skipped when a watch-synced one overlaps it. A workout is skipped when
 *   one starts within [WORKOUT_MATCH_SEC] of it.
 * - **Imported rows stay on the phone.** The cloud upload, the Health Connect export and the Strava upload read
 *   `imported = 0` only, so a year of history does not become an upload burst or a pile of duplicate records.
 *   When the watch later syncs the same minute, segment or workout, its write sets `imported = 0` again and the
 *   row travels like any watch row.
 * - **Idempotent.** The second import of the same file changes nothing.
 *
 * Calories of imported minutes stay 0: the export's per-minute `calorie` scale is not known.
 */
internal class SqliteHuaweiImportStore(private val openDb: () -> WearDatabase) : HuaweiImportStore {
  override fun writeMinutes(rows: Collection<ImportedMinute>): Int {
    if (rows.isEmpty()) return 0
    val db = openDb()
    var changed = 0
    db.beginTransaction()
    try {
      val statement = db.compileStatement(
        """INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate, imported)
           VALUES (?, ?, 0, ?, ?, ?, ?, 1)
           ON CONFLICT(timestamp) DO UPDATE SET
             heart_rate = COALESCE(heart_rate, excluded.heart_rate),
             spo2 = COALESCE(spo2, excluded.spo2),
             resting_heart_rate = COALESCE(resting_heart_rate, excluded.resting_heart_rate),
             steps = CASE WHEN imported = 1 AND steps = 0 THEN excluded.steps ELSE steps END,
             distance = CASE WHEN imported = 1 AND distance = 0 THEN excluded.distance ELSE distance END
           WHERE (heart_rate IS NULL AND excluded.heart_rate IS NOT NULL)
              OR (spo2 IS NULL AND excluded.spo2 IS NOT NULL)
              OR (resting_heart_rate IS NULL AND excluded.resting_heart_rate IS NOT NULL)
              OR (imported = 1 AND steps = 0 AND excluded.steps > 0)
              OR (imported = 1 AND distance = 0 AND excluded.distance > 0)""",
      )
      try {
        for (m in rows) {
          statement.clearBindings()
          statement.bindLong(1, m.ts)
          statement.bindLong(2, m.steps.toLong())
          statement.bindLong(3, m.distance.toLong())
          m.heartRate?.let { statement.bindLong(4, it.toLong()) } ?: statement.bindNull(4)
          m.spo2?.let { statement.bindLong(5, it.toLong()) } ?: statement.bindNull(5)
          m.restingHeartRate?.let { statement.bindLong(6, it.toLong()) } ?: statement.bindNull(6)
          changed += statement.executeUpdateDelete()
        }
      } finally {
        statement.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return changed
  }

  override fun writeSleep(segments: List<ImportedSleep>): Int {
    if (segments.isEmpty()) return 0
    val db = openDb()
    var added = 0
    db.beginTransaction()
    try {
      val statement = db.compileStatement(
        """INSERT OR IGNORE INTO sleep_segments (start, end, type, stage, imported)
           SELECT ?, ?, ?, ?, 1
           WHERE NOT EXISTS (SELECT 1 FROM sleep_segments WHERE imported = 0 AND start < ? AND end > ?)""",
      )
      try {
        for (s in segments) {
          statement.clearBindings()
          statement.bindLong(1, s.start)
          statement.bindLong(2, s.end)
          statement.bindLong(3, s.type.toLong())
          s.stage?.let { statement.bindString(4, it) } ?: statement.bindNull(4)
          statement.bindLong(5, s.end)
          statement.bindLong(6, s.start)
          added += statement.executeUpdateDelete()
        }
      } finally {
        statement.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return added
  }

  /** Stress goes where the watch's own stress / emotion readings go, so the existing card and chart show it. */
  override fun writeStress(points: List<ImportedStress>): Int {
    if (points.isEmpty()) return 0
    val db = openDb()
    var added = 0
    db.beginTransaction()
    try {
      val statement = db.compileStatement(
        "INSERT OR IGNORE INTO health_metrics (type, ts, last_ts, value, values_json) VALUES ('$STRESS_TYPE', ?, ?, ?, ?)",
      )
      try {
        for (p in points) {
          statement.clearBindings()
          statement.bindLong(1, p.ts)
          statement.bindLong(2, p.ts)
          statement.bindDouble(3, p.score.toDouble())
          statement.bindString(4, """{"score":${p.score},"source":"huawei-export"}""")
          added += statement.executeUpdateDelete()
        }
      } finally {
        statement.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return added
  }

  override fun writeWorkout(workout: ImportedWorkout): WorkoutWrite {
    val db = openDb()
    db.beginTransaction()
    try {
      if (workoutExists(db, workout.start)) {
        db.setTransactionSuccessful()
        return WorkoutWrite(added = false, points = 0)
      }
      val insert = db.compileStatement(
        """INSERT OR IGNORE INTO workouts
             (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
           VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)""",
      )
      val id = try {
        insert.bindLong(1, workout.start)
        insert.bindLong(2, workout.end)
        insert.bindLong(3, workout.sportType.toLong())
        insert.bindString(4, workout.sportName)
        insert.bindLong(5, workout.duration.toLong())
        insert.bindLong(6, workout.distance.toLong())
        insert.bindLong(7, workout.calories.toLong())
        workout.avgHr?.let { insert.bindLong(8, it.toLong()) } ?: insert.bindNull(8)
        workout.maxHr?.let { insert.bindLong(9, it.toLong()) } ?: insert.bindNull(9)
        insert.bindLong(10, workout.steps.toLong())
        insert.bindString(11, workout.summaryJson)
        insert.executeInsert()
      } finally {
        insert.close()
      }
      if (id < 0) {
        db.setTransactionSuccessful()
        return WorkoutWrite(added = false, points = 0)
      }
      val point = db.compileStatement(
        "INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      try {
        for (p in workout.points) {
          point.clearBindings()
          point.bindLong(1, id)
          point.bindLong(2, p.ts)
          p.lat?.let { point.bindDouble(3, it) } ?: point.bindNull(3)
          p.lon?.let { point.bindDouble(4, it) } ?: point.bindNull(4)
          p.alt?.let { point.bindDouble(5, it) } ?: point.bindNull(5)
          p.hr?.let { point.bindLong(6, it.toLong()) } ?: point.bindNull(6)
          p.speed?.let { point.bindDouble(7, it) } ?: point.bindNull(7)
          p.cadence?.let { point.bindLong(8, it.toLong()) } ?: point.bindNull(8)
          p.stride?.let { point.bindDouble(9, it) } ?: point.bindNull(9)
          p.power?.let { point.bindLong(10, it.toLong()) } ?: point.bindNull(10)
          point.executeInsert()
        }
      } finally {
        point.close()
      }
      db.setTransactionSuccessful()
      return WorkoutWrite(added = true, points = workout.points.size)
    } finally {
      db.endTransaction()
    }
  }

  /**
   * Weigh-ins go where the Bluetooth scale's go (`scale_reading`, `src/features/scale/store.ts`, created by JS when the
   * database opens; the same statement runs here so an import before the first JS start still works), under the
   * scale id [WEIGH_IN_SCALE_ID] and with `rogo_state = 'skipped'`: a history is not pushed to JoyoRogo as a burst of
   * check-ins. Skipped when a weigh-in already sits within a minute at about the same weight (the same weighing from the
   * scale and from Huawei Health, or this export imported twice).
   */
  override fun writeWeighIns(weighIns: List<ImportedWeighIn>): Int {
    if (weighIns.isEmpty()) return 0
    val db = openDb()
    var added = 0
    db.beginTransaction()
    try {
      db.execSQL(
        """CREATE TABLE IF NOT EXISTS scale_reading (
             id INTEGER PRIMARY KEY AUTOINCREMENT, scale_id TEXT NOT NULL, taken_at INTEGER NOT NULL, weight_kg REAL NOT NULL,
             impedance_ohm REAL, reported TEXT, estimate TEXT, rogo_state TEXT NOT NULL DEFAULT 'pending', rogo_error TEXT)""",
      )
      db.execSQL("CREATE INDEX IF NOT EXISTS scale_reading_taken_at ON scale_reading (taken_at)")
      val statement = db.compileStatement(
        """INSERT INTO scale_reading (scale_id, taken_at, weight_kg, impedance_ohm, reported, rogo_state)
           SELECT ?, ?, ?, ?, ?, 'skipped'
           WHERE NOT EXISTS (SELECT 1 FROM scale_reading WHERE taken_at BETWEEN ? AND ? AND ABS(weight_kg - ?) < 0.3)""",
      )
      try {
        for (w in weighIns) {
          statement.clearBindings()
          statement.bindString(1, WEIGH_IN_SCALE_ID)
          statement.bindLong(2, w.tsMs)
          statement.bindDouble(3, w.weightKg)
          w.impedanceOhm?.let { statement.bindDouble(4, it) } ?: statement.bindNull(4)
          w.reportedJson?.let { statement.bindString(5, it) } ?: statement.bindNull(5)
          statement.bindLong(6, w.tsMs - 60_000)
          statement.bindLong(7, w.tsMs + 60_000)
          statement.bindDouble(8, w.weightKg)
          added += statement.executeUpdateDelete()
        }
      } finally {
        statement.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return added
  }

  private fun workoutExists(db: WearDatabase, start: Long): Boolean =
    db.rawQuery(
      "SELECT 1 FROM workouts WHERE start BETWEEN ? AND ? LIMIT 1",
      arrayOf((start - WORKOUT_MATCH_SEC).toString(), (start + WORKOUT_MATCH_SEC).toString()),
    ).use { it.moveToFirst() }

  companion object {
    /** The `health_metrics.type` of the stress / emotion card (`src/features/health/metrics.ts`). */
    const val STRESS_TYPE = "emotion"

    /** `scale_reading.scale_id` of weigh-ins read from the export; no `scale` row belongs to it. */
    const val WEIGH_IN_SCALE_ID = "huawei-health-export"

    /** The same workout seen by the watch and by the export differs by a second or two at most. */
    const val WORKOUT_MATCH_SEC = 120L
  }
}

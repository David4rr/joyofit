package com.joyodigitama.huaweiwear

/** One minute of `step_samples` assembled from the export; every field but [ts] is optional data. */
internal class ImportedMinute(val ts: Long) {
  var steps = 0
  var distance = 0
  var heartRate: Int? = null
  var spo2: Int? = null
  var restingHeartRate: Int? = null
}

/** A `sleep_segments` row: [type] is the raw kind the watch uses (see [SleepSync]), [stage] its stage name. */
internal class ImportedSleep(val start: Long, val end: Long, val type: Int, val stage: String?)

/** One stress reading for `health_metrics`. */
internal class ImportedStress(val ts: Long, val score: Int)

/** A `workouts` row with its `workout_points`. Times are unix seconds, distance metres, calories kcal. */
internal class ImportedWorkout(
  val start: Long,
  val end: Long,
  val sportType: Int,
  val sportName: String,
  val duration: Int,
  val distance: Int,
  val calories: Int,
  val steps: Int,
  val avgHr: Int?,
  val maxHr: Int?,
  val summaryJson: String,
  val points: List<WorkoutPoint>,
)

/** What the parsers hand over. Timestamps are unix seconds. */
internal interface HuaweiImportCollector {
  fun heartRate(tsSec: Long, bpm: Int)
  fun restingHeartRate(tsSec: Long, bpm: Int)
  fun spo2(tsSec: Long, percent: Int)
  fun sleep(segment: ImportedSleep)
  fun stress(point: ImportedStress)
  fun steps(minuteSec: Long, steps: Int, distance: Int)

  /** A sample point whose key the importer does not use. */
  fun unmapped(key: String)

  /** A sample point of a known key whose value is missing or implausible. */
  fun rejected()
}

/** Result of writing one workout. */
internal class WorkoutWrite(val added: Boolean, val points: Int)

/**
 * Where the importer writes. Every method is insert-or-ignore in spirit: watch data already in the database is never
 * overwritten, and importing the same export twice changes nothing the second time. See [SqliteHuaweiImportStore].
 */
internal interface HuaweiImportStore {
  /** Merges minutes into `step_samples`; returns the rows inserted or filled in. */
  fun writeMinutes(rows: Collection<ImportedMinute>): Int

  /** Adds sleep segments that no watch-synced segment overlaps; returns the rows added. */
  fun writeSleep(segments: List<ImportedSleep>): Int

  /** Adds stress readings; returns the rows added. */
  fun writeStress(points: List<ImportedStress>): Int

  /** Adds the workout unless the database already has one starting within two minutes of it. */
  fun writeWorkout(workout: ImportedWorkout): WorkoutWrite
}

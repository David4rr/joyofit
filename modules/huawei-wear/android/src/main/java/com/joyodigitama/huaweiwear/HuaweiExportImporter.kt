package com.joyodigitama.huaweiwear

import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader

/** Why an import could not start; the module turns [kind] into an error code for JS. */
internal class HuaweiImportException(val kind: Kind, message: String, cause: Throwable? = null) : Exception(message, cause) {
  enum class Kind { BAD_PASSWORD, NOT_A_ZIP, NOT_AN_EXPORT, STORAGE }
}

/** One file inside the export archive. */
internal class HuaweiExportEntry(val name: String, val size: Long)

/** The archive of an export: its files and a way to read one. Implemented over zip4j by [Zip4jExportSource]. */
internal interface HuaweiExportSource {
  fun entries(): List<HuaweiExportEntry>
  fun open(entry: HuaweiExportEntry): InputStream
}

/** Which kind of data a file holds, decided by the folder it sits in. */
internal enum class HuaweiExportKind {
  /** `Health detail data & description`: heart rate, SpO2, sleep, stress. */
  HEALTH_DETAIL,

  /** `Sport per minute merged data & description`: steps and distance per minute. */
  SPORT_PER_MINUTE,

  /** `Motion path detail data & description`: one object per tracked workout. */
  MOTION_PATH,
  ;

  companion object {
    /** The kind of the archive member [name], or null for anything that is not one of the JSON data files. */
    fun of(name: String): HuaweiExportKind? {
      val path = name.replace('\\', '/').lowercase()
      if (!path.endsWith(".json")) return null
      return when {
        "health detail data" in path -> HEALTH_DETAIL
        "sport per minute" in path -> SPORT_PER_MINUTE
        "motion path detail" in path -> MOTION_PATH
        else -> null
      }
    }
  }
}

/** What an import found and wrote. Counted while it runs; [HuaweiImportProgress] hands out the live numbers. */
internal class HuaweiImportSummary {
  var filesRead = 0
  var filesFailed = 0
  var filesIgnored = 0

  /** Records that were not usable JSON and could not be repaired, plus oversize ones. */
  var badRecords = 0

  /** Sample points of a known kind whose value was missing or implausible. */
  var rejectedSamples = 0

  /** Sample points of kinds the importer does not use (weight, exercise intensity ...). */
  var unmappedSamples = 0

  var heartRateReadings = 0
  var restingHeartRateReadings = 0
  var spo2Readings = 0
  var stressReadings = 0
  var sleepSegmentsFound = 0

  /** `step_samples` rows inserted or filled in. */
  var minutesWritten = 0
  var sleepSegmentsAdded = 0
  var stressAdded = 0
  var workoutsFound = 0
  var workoutsAdded = 0
  var workoutPointsAdded = 0

  /** Earliest and latest time (unix seconds) of anything read, for "your history reaches back to ...". */
  var oldestSec: Long? = null
  var newestSec: Long? = null
  var cancelled = false

  fun seen(tsSec: Long) {
    if (oldestSec?.let { tsSec < it } != false) oldestSec = tsSec
    if (newestSec?.let { tsSec > it } != false) newestSec = tsSec
  }

  fun toJs(): Map<String, Any?> = mapOf(
    "filesRead" to filesRead,
    "filesFailed" to filesFailed,
    "filesIgnored" to filesIgnored,
    "badRecords" to badRecords,
    "rejectedSamples" to rejectedSamples,
    "unmappedSamples" to unmappedSamples,
    "heartRateReadings" to heartRateReadings,
    "restingHeartRateReadings" to restingHeartRateReadings,
    "spo2Readings" to spo2Readings,
    "stressReadings" to stressReadings,
    "sleepSegmentsFound" to sleepSegmentsFound,
    "minutesWritten" to minutesWritten,
    "sleepSegmentsAdded" to sleepSegmentsAdded,
    "stressAdded" to stressAdded,
    "workoutsFound" to workoutsFound,
    "workoutsAdded" to workoutsAdded,
    "workoutPointsAdded" to workoutPointsAdded,
    "oldestSec" to oldestSec,
    "newestSec" to newestSec,
    "cancelled" to cancelled,
  )
}

/** A progress report: [phase] is `reading` while files are processed and `done` at the end. */
internal class HuaweiImportProgress(
  val phase: String,
  val fileName: String?,
  val fileIndex: Int,
  val fileCount: Int,
  /** 0..1 over the uncompressed bytes of all data files. */
  val fraction: Double,
  val summary: HuaweiImportSummary,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "phase" to phase,
    "fileName" to fileName,
    "fileIndex" to fileIndex,
    "fileCount" to fileCount,
    "fraction" to fraction,
    "summary" to summary.toJs(),
  )
}

/**
 * Reads a Huawei Privacy Centre health export and writes it through a [HuaweiImportStore].
 *
 * Every file is streamed: [HuaweiExportJson.forEachRecord] cuts it into records, each record is parsed on its own and a
 * record that fails is counted in [HuaweiImportSummary.badRecords] and skipped. Minutes, sleep segments and stress
 * readings are buffered and flushed between records in transactions of at most [FLUSH_MINUTES] rows; workouts are
 * written one by one. Cancelling stops between records; what was written stays, and running the same export again
 * only adds what is still missing.
 */
internal class HuaweiExportImporter(
  private val store: HuaweiImportStore,
  private val onProgress: (HuaweiImportProgress) -> Unit,
  private val isCancelled: () -> Boolean = { false },
  private val nowMs: () -> Long = System::currentTimeMillis,
) {
  private class Cancelled : RuntimeException()

  private val summary = HuaweiImportSummary()
  private val minutes = HashMap<Long, ImportedMinute>()
  private val sleep = ArrayList<ImportedSleep>()
  private val stress = ArrayList<ImportedStress>()

  private var fileIndex = 0
  private var fileCount = 0
  private var fileName: String? = null
  private var totalBytes = 0L
  private var doneBytes = 0L
  private var lastProgressMs = 0L

  private val collector = object : HuaweiImportCollector {
    private fun minute(tsSec: Long): ImportedMinute {
      summary.seen(tsSec)
      val key = tsSec / 60 * 60
      return minutes.getOrPut(key) { ImportedMinute(key) }
    }

    override fun heartRate(tsSec: Long, bpm: Int) {
      summary.heartRateReadings++
      val m = minute(tsSec)
      if (m.heartRate == null) m.heartRate = bpm
    }

    override fun restingHeartRate(tsSec: Long, bpm: Int) {
      summary.restingHeartRateReadings++
      val m = minute(tsSec)
      if (m.restingHeartRate == null) m.restingHeartRate = bpm
    }

    override fun spo2(tsSec: Long, percent: Int) {
      summary.spo2Readings++
      val m = minute(tsSec)
      if (m.spo2 == null) m.spo2 = percent
    }

    override fun sleep(segment: ImportedSleep) {
      summary.sleepSegmentsFound++
      summary.seen(segment.start)
      summary.seen(segment.end)
      sleep.add(segment)
    }

    override fun stress(point: ImportedStress) {
      summary.stressReadings++
      summary.seen(point.ts)
      stress.add(point)
    }

    override fun steps(minuteSec: Long, steps: Int, distance: Int) {
      val m = minute(minuteSec)
      if (steps > m.steps) m.steps = steps
      if (distance > m.distance) m.distance = distance
    }

    override fun unmapped(key: String) {
      summary.unmappedSamples++
    }

    override fun rejected() {
      summary.rejectedSamples++
    }
  }

  fun run(source: HuaweiExportSource): HuaweiImportSummary {
    val entries = source.entries()
    val files = entries
      .mapNotNull { entry -> HuaweiExportKind.of(entry.name)?.let { it to entry } }
      .sortedBy { it.first.ordinal }
    summary.filesIgnored = entries.size - files.size
    if (files.isEmpty()) {
      throw HuaweiImportException(
        HuaweiImportException.Kind.NOT_AN_EXPORT,
        "No Health data folders found in this file (expected \"Health detail data\", \"Sport per minute\" or \"Motion path detail\")",
      )
    }
    fileCount = files.size
    totalBytes = files.sumOf { it.second.size.coerceAtLeast(0) }.coerceAtLeast(1)
    try {
      for ((index, file) in files.withIndex()) {
        fileIndex = index + 1
        fileName = file.second.name.substringAfterLast('/').substringAfterLast('\\')
        val before = doneBytes
        try {
          source.open(file.second).use { stream -> readFile(file.first, CountingStream(stream)) }
          summary.filesRead++
        } catch (e: Cancelled) {
          throw e
        } catch (e: IOException) {
          // A damaged or unreadable member costs that file only. Database errors are not caught: they end the import.
          summary.filesFailed++
        }
        flush()
        doneBytes = before + file.second.size.coerceAtLeast(0)
        report("reading", force = true)
      }
    } catch (e: Cancelled) {
      summary.cancelled = true
      flush()
    }
    fileName = null
    doneBytes = totalBytes
    report("done", force = true)
    return summary
  }

  private inner class CountingStream(input: InputStream) : FilterInputStream(input) {
    override fun read(): Int = super.read().also { if (it >= 0) doneBytes++ }

    override fun read(b: ByteArray, off: Int, len: Int): Int = super.read(b, off, len).also { if (it > 0) doneBytes += it }
  }

  private fun readFile(kind: HuaweiExportKind, stream: InputStream) {
    val reader = InputStreamReader(stream, Charsets.UTF_8)
    HuaweiExportJson.forEachRecord(
      reader,
      onRecord = { text -> handleRecord(kind, text) },
      onUnterminated = { text -> recover(kind, text) },
      onOversized = { summary.badRecords++ },
    )
  }

  private fun handleRecord(kind: HuaweiExportKind, text: String) {
    if (isCancelled()) throw Cancelled()
    val record = HuaweiExportJson.parseObject(text)
    if (record == null) {
      recover(kind, text)
    } else {
      // Only reading the record is guarded: a bad record is skipped, a failing database is not.
      var workout: ImportedWorkout? = null
      var readable = true
      try {
        when (kind) {
          HuaweiExportKind.HEALTH_DETAIL -> HuaweiHealthDetailParser.parse(record, collector)
          HuaweiExportKind.SPORT_PER_MINUTE -> HuaweiSportPerMinuteParser.parse(record, collector)
          HuaweiExportKind.MOTION_PATH -> workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(record))
        }
      } catch (e: RuntimeException) {
        readable = false
      }
      if (!readable) {
        summary.badRecords++
      } else if (kind == HuaweiExportKind.MOTION_PATH) {
        if (workout == null) summary.badRecords++ else writeWorkout(workout)
      }
    }
    if (minutes.size >= FLUSH_MINUTES || sleep.size >= FLUSH_ROWS || stress.size >= FLUSH_ROWS) flush()
    report("reading", force = false)
  }

  /**
   * A record that is not valid JSON. Motion paths are read off the raw text (the line records inside do not need the
   * JSON around them), and when a stray quote merged several workouts into one text it is cut at the next workout's
   * first key. Other kinds have nothing to salvage.
   */
  private fun recover(kind: HuaweiExportKind, text: String) {
    if (kind != HuaweiExportKind.MOTION_PATH) {
      summary.badRecords++
      return
    }
    val starts = ArrayList<Int>()
    var at = text.indexOf(HuaweiMotionPathParser.RECORD_MARKER)
    while (at >= 0) {
      starts.add(at)
      at = text.indexOf(HuaweiMotionPathParser.RECORD_MARKER, at + 1)
    }
    val pieces = if (starts.size <= 1) listOf(text) else starts.mapIndexed { i, from -> text.substring(from, starts.getOrElse(i + 1) { text.length }) }
    for (piece in pieces) {
      val workout = try {
        HuaweiMotionPathParser.fromBrokenText(piece)?.let { HuaweiMotionPathParser.build(it) }
      } catch (e: RuntimeException) {
        null
      }
      if (workout == null) summary.badRecords++ else writeWorkout(workout)
    }
  }

  private fun writeWorkout(workout: ImportedWorkout) {
    summary.workoutsFound++
    summary.seen(workout.start)
    summary.seen(workout.end)
    val result = store.writeWorkout(workout)
    if (result.added) {
      summary.workoutsAdded++
      summary.workoutPointsAdded += result.points
    }
  }

  private fun flush() {
    if (minutes.isNotEmpty()) {
      summary.minutesWritten += store.writeMinutes(minutes.values)
      minutes.clear()
    }
    if (sleep.isNotEmpty()) {
      summary.sleepSegmentsAdded += store.writeSleep(sleep)
      sleep.clear()
    }
    if (stress.isNotEmpty()) {
      summary.stressAdded += store.writeStress(stress)
      stress.clear()
    }
  }

  private fun report(phase: String, force: Boolean) {
    val now = nowMs()
    if (!force && now - lastProgressMs < PROGRESS_INTERVAL_MS) return
    lastProgressMs = now
    onProgress(HuaweiImportProgress(phase, fileName, fileIndex, fileCount, (doneBytes.toDouble() / totalBytes).coerceIn(0.0, 1.0), summary))
  }

  companion object {
    const val FLUSH_MINUTES = 20_000
    const val FLUSH_ROWS = 5_000
    const val PROGRESS_INTERVAL_MS = 250L
  }
}

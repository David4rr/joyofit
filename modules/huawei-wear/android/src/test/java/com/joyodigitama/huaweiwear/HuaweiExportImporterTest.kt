package com.joyodigitama.huaweiwear

import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import net.lingala.zip4j.ZipFile
import net.lingala.zip4j.model.ZipParameters
import net.lingala.zip4j.model.enums.AesKeyStrength
import net.lingala.zip4j.model.enums.EncryptionMethod
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Synthetic fixtures only. */
class HuaweiExportImporterTest {
  private val t0 = 1_750_000_020_000L
  private val tempFiles = ArrayList<File>()

  @After
  fun cleanUp() {
    tempFiles.forEach { it.delete() }
  }

  private class MinuteCopy(val ts: Long, val steps: Int, val distance: Int, val heartRate: Int?, val spo2: Int?, val resting: Int?)

  private class FakeStore : HuaweiImportStore {
    val minutes = ArrayList<MinuteCopy>()
    val sleep = ArrayList<ImportedSleep>()
    val stress = ArrayList<ImportedStress>()
    val workouts = ArrayList<ImportedWorkout>()
    var writeCalls = 0

    override fun writeMinutes(rows: Collection<ImportedMinute>): Int {
      writeCalls++
      rows.forEach { minutes.add(MinuteCopy(it.ts, it.steps, it.distance, it.heartRate, it.spo2, it.restingHeartRate)) }
      return rows.size
    }

    override fun writeSleep(segments: List<ImportedSleep>): Int {
      sleep.addAll(segments)
      return segments.size
    }

    override fun writeStress(points: List<ImportedStress>): Int {
      stress.addAll(points)
      return points.size
    }

    override fun writeWorkout(workout: ImportedWorkout): WorkoutWrite {
      workouts.add(workout)
      return WorkoutWrite(true, workout.points.size)
    }
  }

  private class MapSource(private val files: Map<String, String>) : HuaweiExportSource {
    override fun entries() = files.map { (name, text) -> HuaweiExportEntry(name, text.toByteArray().size.toLong()) }
    override fun open(entry: HuaweiExportEntry): InputStream = ByteArrayInputStream(files.getValue(entry.name).toByteArray())
  }

  private fun sample(key: String, startMs: Long, endMs: Long, value: String) =
    """{"key":"$key","startTime":$startMs,"endTime":$endMs,"unit":"0","value":"${value.replace("\"", "\\\"")}"}"""

  private fun healthRecord(vararg samples: String) =
    """{"type":7,"startTime":$t0,"endTime":${t0 + 60_000},"timeZone":"+0700","recordId":"x","samplePoints":[${samples.joinToString(",")}]}"""

  private val healthFile = "Health detail data & description/Health detail data1.json"
  private val sportFile = "Sport per minute merged data & description/Sport per minute1.json"
  private val motionFile = "Motion path detail data & description/Motion path detail data1.json"

  private fun sportRecord(vararg entries: String) = """{"recordDay":20250615,"sportDataUserData":[${entries.joinToString(",")}]}"""

  private fun sportEntry(steps: Int, distance: Int) =
    """{"startTime":$t0,"endTime":${t0 + 60_000},"sportType":5,"sportBasicInfos":[{"steps":$steps,"distance":$distance,"calorie":5,"duration":1}]}"""

  private fun motionRecord(startMs: Long = t0) =
    """{"abnormalTrack":"","sportType":4,"startTime":$startMs,"endTime":${startMs + 600_000},"totalSteps":900,"totalDistance":1200,"totalCalories":80,""" +
      """"attribute":"HW_EXT_TRACK_DETAIL@is\ntp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=${startMs / 1000}.0;\ntp=h-r;k=${startMs + 5_000};v=130;\n"}"""

  private fun run(files: Map<String, String>, store: FakeStore = FakeStore(), cancelled: () -> Boolean = { false }): HuaweiImportSummary =
    HuaweiExportImporter(store, onProgress = {}, isCancelled = cancelled).run(MapSource(files))

  @Test
  fun mergesReadingsOfTheSameMinuteAndKeepsTheLargestStepCount() {
    val store = FakeStore()
    val summary = run(
      mapOf(
        healthFile to "[" + healthRecord(
          sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 5_000, t0 + 5_000, "80"),
          sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 35_000, t0 + 35_000, "90"),
          sample("BLOOD_OXYGEN_SATURATION", t0 + 10_000, t0 + 10_000, """{"avgSaturation":97}"""),
          sample("DATA_POINT_REST_HEARTRATE", t0, t0 + 1000, "58"),
          sample("STRESS_DATA", t0, t0, """{"score":30}"""),
          sample("PROFESSIONAL_SLEEP_DEEP", t0, t0 + 1_800_000, ""),
          sample("WEIGHT_BODYFAT_BROAD", t0, t0, """{"bodyWeight":70}"""),
        ) + "]",
        // The export repeats minutes: 10, 12 and 10 steps are one minute, not 32.
        sportFile to "[" + sportRecord(sportEntry(10, 8), sportEntry(12, 9), sportEntry(10, 8)) + "]",
      ),
      store,
    )
    // The health file and the sport file are flushed separately; the database merges the two rows of the minute.
    assertEquals(2, store.minutes.size)
    val (health, sport) = store.minutes
    assertEquals(1_750_000_020L, health.ts)
    assertEquals(1_750_000_020L, sport.ts)
    assertEquals(80, health.heartRate)
    assertEquals(97, health.spo2)
    assertEquals(58, health.resting)
    assertEquals(12, sport.steps)
    assertEquals(9, sport.distance)
    assertEquals(1, store.sleep.size)
    assertEquals(0x07, store.sleep.single().type)
    assertEquals(30, store.stress.single().score)
    assertEquals(2, summary.heartRateReadings)
    assertEquals(1, summary.unmappedSamples)
    assertEquals(2, summary.minutesWritten)
    assertEquals(1, summary.sleepSegmentsAdded)
    assertEquals(2, summary.filesRead)
    assertEquals(0, summary.badRecords)
    assertEquals(1_750_000_020L, summary.oldestSec)
    assertEquals(1_750_000_020L + 1800, summary.newestSec)
  }

  @Test
  fun aBadRecordIsCountedAndTheRestStillImported() {
    val store = FakeStore()
    val summary = run(
      mapOf(
        healthFile to "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70")) +
          ",{\"samplePoints\": }," + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 120_000, t0 + 120_000, "75")) + "]",
      ),
      store,
    )
    assertEquals(1, summary.badRecords)
    assertEquals(listOf(70, 75), store.minutes.sortedBy { it.ts }.map { it.heartRate })
  }

  @Test
  fun motionPathBecomesAWorkout() {
    val store = FakeStore()
    val summary = run(mapOf(motionFile to "[${motionRecord()}]"), store)
    assertEquals(1, store.workouts.size)
    assertEquals(1, summary.workoutsFound)
    assertEquals(1, summary.workoutsAdded)
    assertEquals(2, summary.workoutPointsAdded)
    assertEquals(1200, store.workouts.single().distance)
    assertEquals(130, store.workouts.single().avgHr)
  }

  @Test
  fun aStrayQuoteThatSwallowsTheNextWorkoutLosesNeitherOfThem() {
    // The odd quote after "a " flips string state for the rest of the file, so the record never closes by itself.
    val second = motionRecord(t0 + 7_200_000)
    val broken = """[{"abnormalTrack":"","sportType":4,"startTime":$t0,"endTime":${t0 + 600_000},"totalDistance":900,"attribute":"a "b;\n""" +
      """tp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=1.75000002E9;\n"},$second]"""
    val store = FakeStore()
    val summary = run(mapOf(motionFile to broken), store)
    assertEquals(0, summary.badRecords)
    assertEquals(2, store.workouts.size)
    assertEquals(900, store.workouts[0].distance)
  }

  @Test
  fun filesOutsideTheDataFoldersAreIgnoredAndAnExportWithoutThemIsRejected() {
    val store = FakeStore()
    val summary = run(
      mapOf(
        healthFile to "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70")) + "]",
        "Sample sequence data & description/readme.json" to "[]",
        "SportsHealth/summary.xls" to "binary",
      ),
      store,
    )
    assertEquals(2, summary.filesIgnored)
    assertEquals(1, summary.filesRead)
    try {
      run(mapOf("somewhere/else.json" to "[]"))
      fail("expected NOT_AN_EXPORT")
    } catch (e: HuaweiImportException) {
      assertEquals(HuaweiImportException.Kind.NOT_AN_EXPORT, e.kind)
    }
  }

  @Test
  fun cancellingKeepsWhatWasReadSoFar() {
    val store = FakeStore()
    var records = 0
    val summary = run(
      mapOf(
        healthFile to "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70")) + "," +
          healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 120_000, t0 + 120_000, "75")) + "]",
      ),
      store,
      cancelled = { records++ >= 1 },
    )
    assertTrue(summary.cancelled)
    assertEquals(listOf(70), store.minutes.map { it.heartRate })
  }

  @Test
  fun largeFilesAreFlushedInChunks() {
    val store = FakeStore()
    // 25 000 distinct minutes of heart rate in one record per 1 000 minutes.
    val records = (0 until 25).joinToString(",", "[", "]") { chunk ->
      healthRecord(
        *Array(1000) { i -> sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + (chunk * 1000L + i) * 60_000, t0 + (chunk * 1000L + i) * 60_000, "70") },
      )
    }
    val summary = run(mapOf(healthFile to records), store)
    assertEquals(25_000, summary.minutesWritten)
    assertTrue("expected a flush before the end", store.writeCalls >= 2)
  }

  // Encrypted ZIP

  private fun encryptedZip(password: String, files: Map<String, String>): File {
    val file = File.createTempFile("huawei-export", ".zip")
    file.delete()
    tempFiles.add(file)
    val zip = ZipFile(file, password.toCharArray())
    for ((name, text) in files) {
      val params = ZipParameters().apply {
        isEncryptFiles = true
        encryptionMethod = EncryptionMethod.AES
        aesKeyStrength = AesKeyStrength.KEY_STRENGTH_256
        fileNameInZip = name
      }
      zip.addStream(ByteArrayInputStream(text.toByteArray()), params)
    }
    zip.close()
    return file
  }

  @Test
  fun readsAnAesEncryptedZipWithThePassword() {
    val file = encryptedZip(
      "s3cret-Pass",
      mapOf(
        healthFile to "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "66")) + "]",
        motionFile to "[${motionRecord()}]",
      ),
    )
    val store = FakeStore()
    Zip4jExportSource.open(file, "s3cret-Pass".toCharArray()).use { source ->
      val summary = HuaweiExportImporter(store, onProgress = {}).run(source)
      assertEquals(2, summary.filesRead)
    }
    assertEquals(66, store.minutes.single().heartRate)
    assertEquals(1, store.workouts.size)
  }

  @Test
  fun aWrongOrMissingPasswordFailsBeforeAnyWork() {
    val file = encryptedZip("right", mapOf(healthFile to "[]"))
    for (password in listOf("wrong", "")) {
      try {
        Zip4jExportSource.open(file, password.toCharArray()).close()
        fail("expected BAD_PASSWORD for '$password'")
      } catch (e: HuaweiImportException) {
        assertEquals(HuaweiImportException.Kind.BAD_PASSWORD, e.kind)
      }
    }
  }

  @Test
  fun aFileThatIsNotAZipIsRejected() {
    val file = File.createTempFile("not-a-zip", ".zip")
    tempFiles.add(file)
    file.writeText("hello")
    try {
      Zip4jExportSource.open(file, "x".toCharArray()).close()
      fail("expected NOT_A_ZIP")
    } catch (e: HuaweiImportException) {
      assertEquals(HuaweiImportException.Kind.NOT_A_ZIP, e.kind)
    }
  }

  @Test
  fun exportKindIsDecidedByTheFolder() {
    assertEquals(HuaweiExportKind.HEALTH_DETAIL, HuaweiExportKind.of("Health detail data & description/a.json"))
    assertEquals(HuaweiExportKind.SPORT_PER_MINUTE, HuaweiExportKind.of("x\\Sport per minute merged data & description\\a.JSON"))
    assertEquals(HuaweiExportKind.MOTION_PATH, HuaweiExportKind.of("Motion path detail data & description/motion path detail data.json"))
    assertNull(HuaweiExportKind.of("Health detail data & description/readme.xlsx"))
    assertNull(HuaweiExportKind.of("User route/plan.json"))
    assertEquals(HuaweiExportKind.MOTION_PATH, HuaweiExportKind.of("motion path detail data.json"))
    assertNull(HuaweiExportKind.of("other/file.json"))
  }
}

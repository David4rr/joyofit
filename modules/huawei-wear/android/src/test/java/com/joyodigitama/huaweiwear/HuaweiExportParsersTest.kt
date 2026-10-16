package com.joyodigitama.huaweiwear

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Synthetic fixtures only: made-up values in the layout the community converters describe. */
class HuaweiExportParsersTest {
  private class Recorder : HuaweiImportCollector {
    val heartRate = ArrayList<Pair<Long, Int>>()
    val resting = ArrayList<Pair<Long, Int>>()
    val spo2 = ArrayList<Pair<Long, Int>>()
    val sleep = ArrayList<ImportedSleep>()
    val stress = ArrayList<ImportedStress>()
    val steps = ArrayList<Triple<Long, Int, Int>>()
    val unmapped = ArrayList<String>()
    var rejected = 0

    override fun heartRate(tsSec: Long, bpm: Int) { heartRate.add(tsSec to bpm) }
    override fun restingHeartRate(tsSec: Long, bpm: Int) { resting.add(tsSec to bpm) }
    override fun spo2(tsSec: Long, percent: Int) { spo2.add(tsSec to percent) }
    override fun sleep(segment: ImportedSleep) { sleep.add(segment) }
    override fun stress(point: ImportedStress) { stress.add(point) }
    override fun steps(minuteSec: Long, steps: Int, distance: Int) { this.steps.add(Triple(minuteSec, steps, distance)) }
    override fun unmapped(key: String) { unmapped.add(key) }
    override fun rejected() { rejected++ }
  }

  private val t0 = 1_750_000_020_000L // a whole minute

  private fun point(key: String, startMs: Long, endMs: Long, value: String) =
    """{"key":"$key","startTime":$startMs,"endTime":$endMs,"unit":"0","value":${JSONObject.quote(value)}}"""

  private fun healthRecord(vararg points: String) =
    JSONObject("""{"type":7,"startTime":$t0,"endTime":${t0 + 60_000},"timeZone":"+0700","deviceCode":1,"recordId":"r","samplePoints":[${points.joinToString(",")}]}""")

  @Test
  fun heartRateRestingAndSpo2AreMappedByKey() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(
      healthRecord(
        point("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 5_000, t0 + 5_000, "82.0"),
        point("DATA_POINT_REST_HEARTRATE", t0, t0 + 86_400_000, "58"),
        point("DATA_POINT_NEW_REST_HEARTRATE", t0 + 1000, t0 + 2000, "57.4"),
        point("BLOOD_OXYGEN_SATURATION", t0 + 10_000, t0 + 10_000, """{"avgSaturation":97.0,"maxSaturation":99}"""),
        point("BLOOD_OXYGEN_SATURATION", t0 + 70_000, t0 + 70_000, "96"),
      ),
      out,
    )
    assertEquals(listOf(1_750_000_025L to 82), out.heartRate)
    assertEquals(listOf(1_750_000_020L to 58, 1_750_000_021L to 57), out.resting)
    assertEquals(listOf(1_750_000_030L to 97, 1_750_000_090L to 96), out.spo2)
    assertEquals(0, out.rejected)
  }

  @Test
  fun implausibleValuesAreRejectedNotStored() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(
      healthRecord(
        point("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "0"),
        point("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "400"),
        point("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "n/a"),
        point("BLOOD_OXYGEN_SATURATION", t0, t0, "{}"),
        point("STRESS_DATA", t0, t0, """{"score":0}"""),
      ),
      out,
    )
    assertTrue(out.heartRate.isEmpty())
    assertTrue(out.spo2.isEmpty())
    assertTrue(out.stress.isEmpty())
    assertEquals(5, out.rejected)
  }

  @Test
  fun sleepStagesBecomeSegmentsWithTheWatchsRawKinds() {
    val out = Recorder()
    val h = 3_600_000L
    HuaweiHealthDetailParser.parse(
      healthRecord(
        point("PROFESSIONAL_SLEEP_SHALLOW", t0, t0 + h, ""),
        point("PROFESSIONAL_SLEEP_DEEP", t0 + h, t0 + 2 * h, ""),
        point("PROFESSIONAL_SLEEP_DREAM", t0 + 2 * h, t0 + 3 * h, ""),
        point("PROFESSIONAL_SLEEP_WAKE", t0 + 3 * h, t0 + 3 * h + 60_000, ""),
        point("PROFESSIONAL_SLEEP_NOON", t0 + 5 * h, t0 + 6 * h, ""),
        point("PROFESSIONAL_SLEEP_DEEP", t0 + h, t0 + h, ""),
      ),
      out,
    )
    assertEquals(listOf(0x06, 0x07, 0x5656, 0x5658, 0x5659), out.sleep.map { it.type })
    assertEquals(listOf("light", "deep", "rem", "awake", "light"), out.sleep.map { it.stage })
    assertEquals(1_750_000_020L, out.sleep[0].start)
    assertEquals(1_750_000_020L + 3600, out.sleep[0].end)
    // The span with no length is rejected.
    assertEquals(1, out.rejected)
  }

  @Test
  fun stressScoreComesFromTheEmbeddedObject() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(healthRecord(point("STRESS_DATA", t0, t0, """{"score":42,"level":2}""")), out)
    assertEquals(1, out.stress.size)
    assertEquals(42, out.stress[0].score)
    assertEquals(1_750_000_020L, out.stress[0].ts)
  }

  @Test
  fun otherKeysAreCountedAsUnmapped() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(
      healthRecord(point("WEIGHT_BODYFAT_BROAD", t0, t0, """{"bodyWeight":70}"""), point("EXERCISE_INTENSITY", t0, t0, "3")),
      out,
    )
    assertEquals(listOf("WEIGHT_BODYFAT_BROAD", "EXERCISE_INTENSITY"), out.unmapped)
  }

  @Test
  fun samplePointsFallBackToTheRecordTimes() {
    val out = Recorder()
    val record = JSONObject("""{"startTime":$t0,"endTime":${t0 + 1000},"samplePoints":[{"key":"DATA_POINT_DYNAMIC_HEARTRATE","value":"70"}]}""")
    HuaweiHealthDetailParser.parse(record, out)
    assertEquals(listOf(1_750_000_020L to 70), out.heartRate)
  }

  @Test
  fun sportPerMinuteWalksTheMinutesOfAnEntry() {
    val out = Recorder()
    val record = JSONObject(
      """{"recordDay":20250615,"sportDataUserData":[{"startTime":$t0,"endTime":${t0 + 240_000},"sportType":5,"sportBasicInfos":[
           {"steps":0,"distance":0,"calorie":10,"duration":1},
           {"steps":42,"distance":30,"calorie":99,"duration":1},
           {"steps":50,"distance":36,"duration":2},
           {"steps":9999,"distance":1,"duration":1},
           {"steps":10,"distance":7,"duration":1}]}]}""",
    )
    HuaweiSportPerMinuteParser.parse(record, out)
    // Minute 0 has nothing; minute 1 and 2 are read; the info with duration 2 skips minute 3; 9999 steps is rejected.
    assertEquals(
      listOf(Triple(1_750_000_080L, 42, 30), Triple(1_750_000_140L, 50, 36), Triple(1_750_000_320L, 10, 7)),
      out.steps,
    )
    assertEquals(1, out.rejected)
  }

  // Motion path

  private fun attribute(vararg lines: String) = "HW_EXT_TRACK_DETAIL@is\n" + lines.joinToString("\n") + "\n"

  private val trackLines = arrayOf(
    "tp=lbs;k=0;lat=-6.2000000;lon=106.8000000;alt=0.0;t=1.75000002E9;",
    "tp=h-r;k=1750000021000;v=120;",
    "tp=lbs;k=1;lat=-6.2001000;lon=106.8001000;alt=7.5;t=1.750000021E9;",
    "tp=alti;k=1750000021000;v=12.5;",
    "tp=lbs;k=2;lat=90.0;lon=-80.0;alt=0.0;t=1.750000022E9;",
    "tp=lbs;k=3;lat=-6.2010000;lon=106.8010000;alt=8.0;t=1.750000100E9;",
    "tp=h-r;k=1750000100000;v=150;",
    "tp=h-r;k=1750000110000;v=0;",
    "tp=s-r;k=1750000100000;v=160;",
    "tp=p-m;k=1;v=300;",
  )

  private fun motionJson(sportType: Int = 4, totalCalories: Double = 90.0) = JSONObject(
    mapOf(
      "abnormalTrack" to "",
      "sportType" to sportType,
      "startTime" to t0,
      "endTime" to t0 + 600_000,
      "timeZone" to "+0700",
      "totalSteps" to 1200,
      "totalDistance" to 1500,
      "totalCalories" to totalCalories,
      "totalTime" to 540_000,
      "attribute" to attribute(*trackLines),
    ),
  )

  @Test
  fun motionPathBecomesAWorkoutWithRouteHeartRateAndAltitude() {
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(motionJson()))
    assertNotNull(workout)
    workout!!
    assertEquals(1_750_000_020L, workout.start)
    assertEquals(1_750_000_620L, workout.end)
    assertEquals(600, workout.duration)
    assertEquals(1, workout.sportType)
    assertEquals("Running", workout.sportName)
    assertEquals(1500, workout.distance)
    assertEquals(90, workout.calories)
    assertEquals(1200, workout.steps)
    // The reading of 0 bpm is dropped.
    assertEquals(135, workout.avgHr)
    assertEquals(150, workout.maxHr)

    val gps = workout.points.filter { it.lat != null }
    // The pause marker is not a point; its neighbours are.
    assertEquals(3, gps.size)
    assertNull(gps[0].alt) // alt=0.0 means "none"
    assertEquals(7.5, gps[1].alt!!, 0.0)
    assertEquals(2, workout.points.count { it.hr != null })
    assertEquals(1, workout.points.count { it.lat == null && it.alt != null })
    assertEquals(workout.points.map { it.ts }, workout.points.map { it.ts }.sorted())

    val summary = JSONObject(workout.summaryJson)
    assertEquals("RUNNING", summary.getString("kind"))
    assertEquals("ok", summary.getString("gps"))
    assertEquals(3, summary.getInt("gpsPoints"))
    assertEquals("huawei-export", summary.getString("source"))
    assertEquals(4, summary.getInt("huaweiSportType"))
    assertEquals(540L, summary.getLong("movingTimeSec"))
    assertEquals(1500.0 / 600, summary.getDouble("avgSpeed"), 1e-9)
    assertEquals(1000.0 / (1500.0 / 600), summary.getDouble("avgPaceSecPerKm"), 1e-6)
  }

  @Test
  fun sportIdsOutsideTheKnownTableStayUnnamedWorkouts() {
    assertEquals(3, HuaweiExportSports.joyofitType(3))
    assertEquals(2, HuaweiExportSports.joyofitType(5))
    assertEquals("Biking", HuaweiExportSports.name(3))
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(motionJson(sportType = 77)))!!
    assertEquals(HuaweiExportSports.OTHER, workout.sportType)
    assertEquals("Workout (Huawei type 77)", workout.sportName)
    assertEquals(77, JSONObject(workout.summaryJson).getInt("huaweiSportType"))
  }

  @Test
  fun caloriesInSmallCaloriesAreScaledDown() {
    assertEquals(90, HuaweiMotionPathParser.kcal(90.0, 600))
    assertEquals(90, HuaweiMotionPathParser.kcal(90_000.0, 600))
    assertEquals(0, HuaweiMotionPathParser.kcal(0.0, 600))
    assertEquals(0, HuaweiMotionPathParser.kcal(null, 600))
  }

  @Test
  fun distanceFallsBackToTheTrackAndSkipsPauses() {
    val json = motionJson()
    json.put("totalDistance", 0)
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(json))!!
    // First two fixes are ~15.7 m apart; the third follows a pause and starts a new segment.
    assertTrue(workout.distance in 14..18)
  }

  @Test
  fun workoutWithoutAnyTimeIsNotImported() {
    val raw = HuaweiMotionPathParser.fromJson(JSONObject("""{"sportType":4,"attribute":""}"""))
    assertNull(HuaweiMotionPathParser.build(raw))
  }

  @Test
  fun totalTimeInSecondsIsRecognisedToo() {
    val json = motionJson()
    json.put("totalTime", 540)
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(json))!!
    assertEquals(540L, JSONObject(workout.summaryJson).getLong("movingTimeSec"))
  }

  @Test
  fun brokenMotionTextIsReadStraightOffTheRawText() {
    // A stray quote in the attribute makes this invalid JSON; the line records are still readable.
    val raw = """{"abnormalTrack":"","sportType":4,"startTime":$t0,"endTime":${t0 + 600_000},"totalDistance":1500,"totalCalories":90,""" +
      """"partTimeMap":{1.0:439.0},"attribute":"HW_EXT_TRACK_DETAIL@is\ntp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=1.75000002E9;\n""" +
      """tp=h-r;k=1750000021000;v=120;\n"stray";\n"}"""
    assertNull(HuaweiExportJson.parseObject(raw))
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromBrokenText(raw)!!)
    assertNotNull(workout)
    assertEquals(1, workout!!.sportType)
    assertEquals(1500, workout.distance)
    assertEquals(1, workout.points.count { it.lat != null })
    assertEquals(120, workout.avgHr)
    assertFalse(workout.points.isEmpty())
  }

  @Test
  fun elevationChangeIgnoresNoise() {
    val (gain, loss) = HuaweiMotionPathParser.elevationChange(listOf(10.0, 11.0, 9.5, 14.0, 20.0, 15.0, 15.5))
    assertEquals(10.0, gain, 1e-9)
    assertEquals(5.0, loss, 1e-9)
  }
}

import XCTest
@testable import HuaweiWearLogic

/// Port of HealthConnectPlanTest.kt (same fixtures, same expectations) plus the HealthKit specifics.
final class HealthKitPlanTests: XCTestCase {
    private func sample(_ ts: Int64, steps: Int = 0, calories: Int = 0, distance: Int = 0, hr: Int? = nil, spo2: Int? = nil, resting: Int? = nil) -> StepSample {
        StepSample(timestamp: ts, steps: steps, calories: calories, distance: distance, heartRate: hr, spo2: spo2, restingHeartRate: resting)
    }

    func testIntervalsSkipZeroMinutesAndEarlierSamples() {
        let samples = [
            sample(1_000, steps: 5, calories: 2, distance: 3),
            sample(1_060, steps: 0, calories: 1),
            sample(1_120, steps: 7, distance: 4),
        ]
        XCTAssertEqual(HealthKitPlan.steps(samples, fromSec: 1_050), [HealthKitPlan.Interval(id: "joyofit:steps:1120", startSec: 1_120, endSec: 1_180, value: 7)])
        XCTAssertEqual(HealthKitPlan.calories(samples, fromSec: 1_050).map(\.startSec), [1_060])
        XCTAssertEqual(HealthKitPlan.distance(samples, fromSec: 1_050).map(\.startSec), [1_120])
    }

    func testSameMinuteAlwaysGetsTheSameId() {
        let a = HealthKitPlan.steps([sample(600, steps: 1)], fromSec: 0).first!.id
        let b = HealthKitPlan.steps([sample(600, steps: 99)], fromSec: 0).first!.id
        XCTAssertEqual(a, b)
        XCTAssertEqual(a, "joyofit:steps:600")
    }

    func testHeartRateKeepsValidReadingsOnlyOneSamplePerMinute() {
        let samples = [
            sample(3_600 * 10 + 60, hr: 60), sample(3_600 * 10 + 120, hr: 0), sample(3_600 * 10 + 180, hr: 70),
            sample(3_600 * 11, hr: 80), sample(3_600 * 11 + 60, hr: 400), sample(10, hr: 90),
        ]
        let points = HealthKitPlan.heartRate(samples, fromSec: 3_600)
        XCTAssertEqual(points.map(\.timeSec), [36_060, 36_180, 39_600])
        XCTAssertEqual(points.map(\.value), [60, 70, 80])
    }

    func testSpo2KeepsOnlyPercentages() {
        let samples = [sample(60, spo2: 97), sample(120, spo2: 0), sample(180, spo2: 101), sample(240)]
        XCTAssertEqual(HealthKitPlan.spo2(samples, fromSec: 0).map(\.timeSec), [60])
    }

    func testRestingHeartRateIsTheLatestReadingOfEachDay() {
        let dayOf: (Int64) -> String = { String($0 / 86_400) }
        let samples = [sample(100, resting: 55), sample(200, resting: 57), sample(86_400 + 10, resting: 52), sample(86_400 + 20)]
        let result = HealthKitPlan.restingHeartRate(samples, fromSec: 0, dayOf: dayOf)
        XCTAssertEqual(result.map(\.0), ["joyofit:rhr:0", "joyofit:rhr:1"])
        XCTAssertEqual(result.map(\.1.value), [57, 52])
        XCTAssertEqual(result[0].1.timeSec, 200)
    }

    func testSleepSpansSplitIntoSessionsAtLongGaps() {
        let night: Int64 = 100_000
        let segments = [
            SleepSegment(start: night, end: night + 600, type: 0x06, stage: "light"),
            SleepSegment(start: night + 600, end: night + 1_200, type: 0x07, stage: "deep"),
            SleepSegment(start: night + 1_200, end: night + 1_500, type: 0x5656, stage: "rem"),
            SleepSegment(start: night + 1_500, end: night + 1_560, type: 0x5658, stage: "awake"),
            // Nap 5 h later.
            SleepSegment(start: night + 20_000, end: night + 21_000, type: 1, stage: nil),
        ]
        let sessions = HealthKitPlan.sleepSessions(segments, fromSec: 0)
        XCTAssertEqual(sessions.count, 2)
        XCTAssertEqual(sessions[0].id, "joyofit:sleep:\(night)")
        XCTAssertEqual(sessions[0].endSec, night + 1_560)
        XCTAssertEqual(sessions[0].stages.map(\.stage), [.light, .deep, .rem, .awake])
        XCTAssertEqual(sessions[1].stages.map(\.stage), [.sleeping])
    }

    func testSleepStagesDoNotOverlapAndSameStagesMerge() {
        let segments = [
            SleepSegment(start: 0, end: 600, type: 0x06, stage: "light"),
            SleepSegment(start: 600, end: 900, type: 0x06, stage: "light"),
            // Starts before the previous one ended: the earlier span keeps the time.
            SleepSegment(start: 800, end: 1_200, type: 0x07, stage: "deep"),
            SleepSegment(start: 1_100, end: 1_150, type: 0x5656, stage: "rem"),
        ]
        let stages = HealthKitPlan.sleepSessions(segments, fromSec: 0).first!.stages
        XCTAssertEqual(stages.map { [$0.startSec, $0.endSec] }, [[0, 900], [900, 1_200]])
        XCTAssertEqual(stages.map(\.stage), [.light, .deep])
    }

    func testSessionsEndedBeforeTheWindowAreNotRewritten() {
        let segments = [
            SleepSegment(start: 0, end: 3_600, type: 0x06, stage: "light"),
            SleepSegment(start: 200_000, end: 203_600, type: 0x06, stage: "light"),
        ]
        XCTAssertEqual(HealthKitPlan.sleepSessions(segments, fromSec: 100_000).map(\.id), ["joyofit:sleep:200000"])
    }

    func testStrayUnstagedSpansNextToAStagedNightAreDropped() {
        let night: Int64 = 100_000
        let segments = [
            SleepSegment(start: night - 1_800, end: night - 600, type: 1, stage: nil), // evening, within 3 h of the staged night
            SleepSegment(start: night, end: night + 3_600, type: 0x06, stage: "light"),
            SleepSegment(start: night + 40_000, end: night + 41_000, type: 1, stage: nil), // far away: a nap, stays
        ]
        let kept = HealthKitPlan.withoutStrayUnstaged(segments)
        XCTAssertEqual(kept.map(\.start), [night, night + 40_000])
    }

    func testSleepStageValuesAreHealthKitsNumbers() {
        // HKCategoryValueSleepAnalysis: inBed 0, asleepUnspecified 1, awake 2, asleepCore 3, asleepDeep 4, asleepREM 5 (the writer reads the
        // values straight from the framework enum and the iOS type-check compiles that mapping).
        XCTAssertEqual(SleepStageKind.sleeping.healthKitValue, 1)
        XCTAssertEqual(SleepStageKind.awake.healthKitValue, 2)
        XCTAssertEqual(SleepStageKind.light.healthKitValue, 3)
        XCTAssertEqual(SleepStageKind.deep.healthKitValue, 4)
        XCTAssertEqual(SleepStageKind.rem.healthKitValue, 5)
    }

    func testSportTableMatchesHealthConnectExercise() {
        XCTAssertEqual(HealthKitPlan.workoutKind(huaweiType: 1), .running)
        XCTAssertEqual(HealthKitPlan.workoutKind(huaweiType: 11), .running)
        XCTAssertEqual(HealthKitPlan.workoutKind(huaweiType: 13), .walking)
        XCTAssertEqual(HealthKitPlan.workoutKind(huaweiType: 213), .biking)
        XCTAssertEqual(HealthKitPlan.workoutKind(huaweiType: 5), .runningTreadmill)
        XCTAssertEqual(HealthKitPlan.workoutKind(huaweiType: 148), .martialArts)
        XCTAssertEqual(HealthKitPlan.workoutKind(huaweiType: 204), .iceHockey)
        XCTAssertEqual(HealthKitPlan.workoutKind(huaweiType: 215), .paragliding)
        XCTAssertEqual(HealthKitPlan.workoutKind(huaweiType: 0xFF), .otherWorkout)
        XCTAssertEqual(HealthKitPlan.workoutKind(huaweiType: 0x101), .running, "the type byte only")
    }

    func testWorkoutSignatureAndNotes() {
        let w = WorkoutRow(start: 100, end: 700, sportType: 1, name: "Run", distance: 5_250, calories: 320, avgHr: 150, maxHr: 175)
        XCTAssertEqual(w.signature, "100|700|320|5250")
        XCTAssertEqual(w.notes(), "JoyoFit: 5.25 km, 320 kcal, avg HR 150, max HR 175")
        XCTAssertNil(WorkoutRow(start: 1, end: 2, sportType: 1, name: nil, distance: nil, calories: 0, avgHr: nil, maxHr: 0).notes())
        XCTAssertEqual(WorkoutRow(start: 1, end: 2, sportType: 1, name: nil, distance: nil, calories: nil, avgHr: nil, maxHr: nil).signature, "1|2|0|0")
    }

    func testRecordTypeNamesAreTheJsNames() {
        XCTAssertEqual(
            HealthRecordType.allCases.map(\.rawValue),
            ["Steps", "HeartRate", "OxygenSaturation", "RestingHeartRate", "Distance", "ActiveCaloriesBurned", "SleepSession", "ExerciseSession"]
        )
    }

    func testCountsShape() {
        var c = HealthExportCounts()
        c.steps = 1; c.distance = 2; c.calories = 3; c.heartRate = 4; c.spo2 = 5; c.restingHeartRate = 6; c.sleep = 7; c.workouts = 8
        XCTAssertEqual(c.total, 36)
        XCTAssertEqual(Set(c.toJS().keys), ["steps", "distance", "calories", "heartRate", "spo2", "restingHeartRate", "sleep", "workouts"])
        XCTAssertEqual(c.description, "steps=1 distance=2 calories=3 hr=4 spo2=5 restingHr=6 sleep=7 workouts=8")
    }
}

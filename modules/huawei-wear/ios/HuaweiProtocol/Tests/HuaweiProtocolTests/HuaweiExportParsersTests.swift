import Foundation
import XCTest
@testable import HuaweiProtocol

/// Translation of HuaweiExportParsersTest.kt: synthetic fixtures only, made-up values in the layout the community converters describe.
final class HuaweiExportParsersTests: XCTestCase {
    private final class Recorder: HuaweiImportCollector {
        var heartRate = [(Int64, Int)]()
        var resting = [(Int64, Int)]()
        var spo2 = [(Int64, Int)]()
        var sleep = [ImportedSleep]()
        var stress = [ImportedStress]()
        var steps = [(Int64, Int, Int)]()
        var unmapped = [String]()
        var rejectedCount = 0

        func heartRate(tsSec: Int64, bpm: Int) { heartRate.append((tsSec, bpm)) }
        func restingHeartRate(tsSec: Int64, bpm: Int) { resting.append((tsSec, bpm)) }
        func spo2(tsSec: Int64, percent: Int) { spo2.append((tsSec, percent)) }
        func sleep(_ segment: ImportedSleep) { sleep.append(segment) }
        func stress(_ point: ImportedStress) { stress.append(point) }
        func steps(minuteSec: Int64, steps: Int, distance: Int) { self.steps.append((minuteSec, steps, distance)) }
        func unmapped(key: String) { unmapped.append(key) }
        func rejected() { rejectedCount += 1 }
    }

    private let t0: Int64 = 1_750_000_020_000  // a whole minute

    static func quote(_ s: String) -> String {
        var out = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            default: out.unicodeScalars.append(u)
            }
        }
        return out + "\""
    }

    private func point(_ key: String, _ startMs: Int64, _ endMs: Int64, _ value: String) -> String {
        "{\"key\":\"\(key)\",\"startTime\":\(startMs),\"endTime\":\(endMs),\"unit\":\"0\",\"value\":\(Self.quote(value))}"
    }

    private func record(_ text: String) -> ExportRecord { HuaweiExportJson.parseObject(text)! }

    private func healthRecord(_ points: String...) -> ExportRecord {
        record(
            "{\"type\":7,\"startTime\":\(t0),\"endTime\":\(t0 + 60_000),\"timeZone\":\"+0700\",\"deviceCode\":1,\"recordId\":\"r\",\"samplePoints\":[\(points.joined(separator: ","))]}"
        )
    }

    func testHeartRateRestingAndSpo2AreMappedByKey() {
        let out = Recorder()
        HuaweiHealthDetailParser.parse(
            healthRecord(
                point("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 5_000, t0 + 5_000, "82.0"),
                point("DATA_POINT_REST_HEARTRATE", t0, t0 + 86_400_000, "58"),
                point("DATA_POINT_NEW_REST_HEARTRATE", t0 + 1000, t0 + 2000, "57.4"),
                point("BLOOD_OXYGEN_SATURATION", t0 + 10_000, t0 + 10_000, #"{"avgSaturation":97.0,"maxSaturation":99}"#),
                point("BLOOD_OXYGEN_SATURATION", t0 + 70_000, t0 + 70_000, "96")
            ), into: out)
        XCTAssertEqual(out.heartRate.map { [$0.0, Int64($0.1)] }, [[1_750_000_025, 82]])
        XCTAssertEqual(out.resting.map { [$0.0, Int64($0.1)] }, [[1_750_000_020, 58], [1_750_000_021, 57]])
        XCTAssertEqual(out.spo2.map { [$0.0, Int64($0.1)] }, [[1_750_000_030, 97], [1_750_000_090, 96]])
        XCTAssertEqual(out.rejectedCount, 0)
    }

    func testImplausibleValuesAreRejectedNotStored() {
        let out = Recorder()
        HuaweiHealthDetailParser.parse(
            healthRecord(
                point("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "0"),
                point("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "400"),
                point("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "n/a"),
                point("BLOOD_OXYGEN_SATURATION", t0, t0, "{}"),
                point("STRESS_DATA", t0, t0, #"{"score":0}"#)
            ), into: out)
        XCTAssertTrue(out.heartRate.isEmpty)
        XCTAssertTrue(out.spo2.isEmpty)
        XCTAssertTrue(out.stress.isEmpty)
        XCTAssertEqual(out.rejectedCount, 5)
    }

    func testSleepStagesBecomeSegmentsWithTheWatchsRawKinds() {
        let out = Recorder()
        let h: Int64 = 3_600_000
        HuaweiHealthDetailParser.parse(
            healthRecord(
                point("PROFESSIONAL_SLEEP_SHALLOW", t0, t0 + h, ""),
                point("PROFESSIONAL_SLEEP_DEEP", t0 + h, t0 + 2 * h, ""),
                point("PROFESSIONAL_SLEEP_DREAM", t0 + 2 * h, t0 + 3 * h, ""),
                point("PROFESSIONAL_SLEEP_WAKE", t0 + 3 * h, t0 + 3 * h + 60_000, ""),
                point("PROFESSIONAL_SLEEP_NOON", t0 + 5 * h, t0 + 6 * h, ""),
                point("PROFESSIONAL_SLEEP_DEEP", t0 + h, t0 + h, "")
            ), into: out)
        XCTAssertEqual(out.sleep.map(\.type), [0x06, 0x07, 0x5656, 0x5658, 0x5659])
        XCTAssertEqual(out.sleep.map(\.stage), ["light", "deep", "rem", "awake", "light"])
        XCTAssertEqual(out.sleep[0].start, 1_750_000_020)
        XCTAssertEqual(out.sleep[0].end, 1_750_000_020 + 3600)
        // The span with no length is rejected.
        XCTAssertEqual(out.rejectedCount, 1)
    }

    func testSleepSpanOverADayIsRejected() {
        let out = Recorder()
        HuaweiHealthDetailParser.parse(healthRecord(point("PROFESSIONAL_SLEEP_DEEP", t0, t0 + 25 * 3_600_000, "")), into: out)
        XCTAssertTrue(out.sleep.isEmpty)
        XCTAssertEqual(out.rejectedCount, 1)
    }

    func testStressScoreComesFromTheEmbeddedObject() {
        let out = Recorder()
        HuaweiHealthDetailParser.parse(healthRecord(point("STRESS_DATA", t0, t0, #"{"score":42,"level":2}"#)), into: out)
        XCTAssertEqual(out.stress, [ImportedStress(ts: 1_750_000_020, score: 42)])
    }

    func testOtherKeysAreCountedAsUnmapped() {
        let out = Recorder()
        HuaweiHealthDetailParser.parse(
            healthRecord(point("WEIGHT_BODYFAT_BROAD", t0, t0, #"{"bodyWeight":70}"#), point("EXERCISE_INTENSITY", t0, t0, "3")), into: out)
        XCTAssertEqual(out.unmapped, ["WEIGHT_BODYFAT_BROAD", "EXERCISE_INTENSITY"])
    }

    func testSamplePointsFallBackToTheRecordTimes() {
        let out = Recorder()
        let r = record("{\"startTime\":\(t0),\"endTime\":\(t0 + 1000),\"samplePoints\":[{\"key\":\"DATA_POINT_DYNAMIC_HEARTRATE\",\"value\":\"70\"}]}")
        HuaweiHealthDetailParser.parse(r, into: out)
        XCTAssertEqual(out.heartRate.map { [$0.0, Int64($0.1)] }, [[1_750_000_020, 70]])
    }

    func testRecordWithoutSamplePointsOrKeyIsIgnored() {
        let out = Recorder()
        HuaweiHealthDetailParser.parse(record("{\"startTime\":\(t0)}"), into: out)
        HuaweiHealthDetailParser.parse(record("{\"samplePoints\":[1,{\"value\":\"70\"},{\"key\":\"\"}]}"), into: out)
        XCTAssertEqual(out.rejectedCount + out.unmapped.count + out.heartRate.count, 0)
    }

    func testSportPerMinuteWalksTheMinutesOfAnEntry() {
        let out = Recorder()
        let r = record(
            """
            {"recordDay":20250615,"sportDataUserData":[{"startTime":\(t0),"endTime":\(t0 + 240_000),"sportType":5,"sportBasicInfos":[
                   {"steps":0,"distance":0,"calorie":10,"duration":1},
                   {"steps":42,"distance":30,"calorie":99,"duration":1},
                   {"steps":50,"distance":36,"duration":2},
                   {"steps":9999,"distance":1,"duration":1},
                   {"steps":10,"distance":7,"duration":1}]}]}
            """)
        HuaweiSportPerMinuteParser.parse(r, into: out)
        // Minute 0 has nothing; minute 1 and 2 are read; the info with duration 2 skips minute 3; 9999 steps is rejected.
        XCTAssertEqual(out.steps.map { [$0.0, Int64($0.1), Int64($0.2)] }, [[1_750_000_080, 42, 30], [1_750_000_140, 50, 36], [1_750_000_320, 10, 7]])
        XCTAssertEqual(out.rejectedCount, 1)
    }

    // MARK: motion path

    private func attribute(_ lines: [String]) -> String { "HW_EXT_TRACK_DETAIL@is\n" + lines.joined(separator: "\n") + "\n" }

    private let trackLines = [
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
    ]

    private func motionJson(sportType: Int = 4, totalCalories: Double = 90.0, totalDistance: Int = 1500, totalTime: Int = 540_000) -> ExportRecord {
        [
            "abnormalTrack": .string(""),
            "sportType": .number(Double(sportType)),
            "startTime": .number(Double(t0)),
            "endTime": .number(Double(t0 + 600_000)),
            "timeZone": .string("+0700"),
            "totalSteps": .number(1200),
            "totalDistance": .number(Double(totalDistance)),
            "totalCalories": .number(totalCalories),
            "totalTime": .number(Double(totalTime)),
            "attribute": .string(attribute(trackLines)),
        ]
    }

    private func summary(_ workout: ImportedWorkout) -> ExportRecord { HuaweiExportJson.parseObject(workout.summaryJson)! }

    func testMotionPathBecomesAWorkoutWithRouteHeartRateAndAltitude() throws {
        let workout = try XCTUnwrap(HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(motionJson())))
        XCTAssertEqual(workout.start, 1_750_000_020)
        XCTAssertEqual(workout.end, 1_750_000_620)
        XCTAssertEqual(workout.duration, 600)
        XCTAssertEqual(workout.sportType, 1)
        XCTAssertEqual(workout.sportName, "Running")
        XCTAssertEqual(workout.distance, 1500)
        XCTAssertEqual(workout.calories, 90)
        XCTAssertEqual(workout.steps, 1200)
        // The reading of 0 bpm is dropped.
        XCTAssertEqual(workout.avgHr, 135)
        XCTAssertEqual(workout.maxHr, 150)

        let gps = workout.points.filter { $0.lat != nil }
        // The pause marker is not a point; its neighbours are.
        XCTAssertEqual(gps.count, 3)
        XCTAssertNil(gps[0].alt)  // alt=0.0 means "none"
        XCTAssertEqual(gps[1].alt, 7.5)
        XCTAssertEqual(workout.points.filter { $0.hr != nil }.count, 2)
        XCTAssertEqual(workout.points.filter { $0.lat == nil && $0.alt != nil }.count, 1)
        // tp=s-r is cadence in steps per minute at its own timestamp; tp=p-m (a per-km pace summary) is not a point.
        let cadence = workout.points.filter { $0.cadence != nil }
        XCTAssertEqual(cadence.map(\.ts), [1_750_000_100])
        XCTAssertEqual(cadence.map(\.cadence), [160])
        XCTAssertTrue(workout.points.allSatisfy { $0.speed == nil && $0.stride == nil && $0.power == nil })
        XCTAssertEqual(workout.points.map(\.ts), workout.points.map(\.ts).sorted())

        let s = summary(workout)
        XCTAssertEqual(s["kind"], .string("RUNNING"))
        XCTAssertEqual(s["gps"], .string("ok"))
        XCTAssertEqual(s["gpsPoints"], .number(3))
        XCTAssertEqual(s["source"], .string("huawei-export"))
        XCTAssertEqual(s["huaweiSportType"], .number(4))
        XCTAssertEqual(s["timeZone"], .string("+0700"))
        XCTAssertEqual(s["movingTimeSec"], .number(540))
        XCTAssertEqual(try XCTUnwrap(HuaweiExportJson.number(s["avgSpeed"])), 1500.0 / 600, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(HuaweiExportJson.number(s["avgPaceSecPerKm"])), 1000.0 / (1500.0 / 600), accuracy: 1e-6)
        XCTAssertEqual(s["minHr"], .number(120))
        XCTAssertEqual(s["minAltitude"], .number(12.5))
        XCTAssertEqual(s["elevationGain"], .number(0))
    }

    func testSportIdsOutsideTheKnownTableStayUnnamedWorkouts() throws {
        XCTAssertEqual(HuaweiExportSports.joyofitType(3), 3)
        XCTAssertEqual(HuaweiExportSports.joyofitType(5), 2)
        XCTAssertEqual(HuaweiExportSports.name(3), "Biking")
        XCTAssertEqual(HuaweiExportSports.name(nil), "Workout (Huawei type unknown)")
        let workout = try XCTUnwrap(HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(motionJson(sportType: 77))))
        XCTAssertEqual(workout.sportType, HuaweiExportSports.other)
        XCTAssertEqual(workout.sportName, "Workout (Huawei type 77)")
        XCTAssertEqual(summary(workout)["huaweiSportType"], .number(77))
    }

    func testCaloriesInSmallCaloriesAreScaledDown() {
        XCTAssertEqual(HuaweiMotionPathParser.kcal(90.0, durationSec: 600), 90)
        XCTAssertEqual(HuaweiMotionPathParser.kcal(90_000.0, durationSec: 600), 90)
        XCTAssertEqual(HuaweiMotionPathParser.kcal(0.0, durationSec: 600), 0)
        XCTAssertEqual(HuaweiMotionPathParser.kcal(nil, durationSec: 600), 0)
    }

    func testDistanceFallsBackToTheTrackAndSkipsPauses() throws {
        let workout = try XCTUnwrap(HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(motionJson(totalDistance: 0))))
        // First two fixes are ~15.7 m apart; the third follows a pause and starts a new segment.
        XCTAssertTrue((14...18).contains(workout.distance), "\(workout.distance)")
    }

    func testWorkoutWithoutAnyTimeIsNotImported() {
        let raw = HuaweiMotionPathParser.fromJson(record(#"{"sportType":4,"attribute":""}"#))
        XCTAssertNil(HuaweiMotionPathParser.build(raw))
    }

    func testTotalTimeInSecondsIsRecognisedToo() throws {
        let workout = try XCTUnwrap(HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(motionJson(totalTime: 540))))
        XCTAssertEqual(summary(workout)["movingTimeSec"], .number(540))
    }

    func testTimesComeFromTheTrackWhenTheObjectHasNone() throws {
        let raw = HuaweiMotionPathParser.fromJson(record(#"{"sportType":5,"totalTime":300000,"attribute":"tp=lbs;k=0;lat=-6.2;lon=106.8;alt=0;t=1750000000;\ntp=h-r;k=1750000100000;v=100;\n"}"#))
        let workout = try XCTUnwrap(HuaweiMotionPathParser.build(raw))
        XCTAssertEqual(workout.start, 1_750_000_000)
        XCTAssertEqual(workout.end, 1_750_000_100)
        XCTAssertEqual(workout.sportType, 2)
    }

    func testObjectKeysFallBackToTheShortNames() throws {
        let raw = HuaweiMotionPathParser.fromJson(record("{\"startTime\":\(t0),\"endTime\":\(t0 + 60_000),\"steps\":5,\"distance\":9,\"calorie\":3,\"duration\":60000,\"attribute\":\"\"}"))
        XCTAssertEqual(raw.totalSteps, 5)
        XCTAssertEqual(raw.totalDistance, 9)
        XCTAssertEqual(raw.totalCalories, 3)
        XCTAssertEqual(raw.totalTime, 60000)
        XCTAssertNil(raw.timeZone)
    }

    func testBrokenMotionTextIsReadStraightOffTheRawText() throws {
        // A stray quote in the attribute makes this invalid JSON; the line records are still readable.
        let raw =
            "{\"abnormalTrack\":\"\",\"sportType\":4,\"startTime\":\(t0),\"endTime\":\(t0 + 600_000),\"totalDistance\":1500,\"totalCalories\":90,"
            + "\"partTimeMap\":{1.0:439.0},\"attribute\":\"HW_EXT_TRACK_DETAIL@is\\ntp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=1.75000002E9;\\n"
            + "tp=h-r;k=1750000021000;v=120;\\n\"stray\";\\n\"}"
        XCTAssertNil(HuaweiExportJson.parseObject(raw))
        let workout = try XCTUnwrap(HuaweiMotionPathParser.build(try XCTUnwrap(HuaweiMotionPathParser.fromBrokenText(raw))))
        XCTAssertEqual(workout.sportType, 1)
        XCTAssertEqual(workout.distance, 1500)
        XCTAssertEqual(workout.points.filter { $0.lat != nil }.count, 1)
        XCTAssertEqual(workout.avgHr, 120)
        XCTAssertFalse(workout.points.isEmpty)
    }

    func testBrokenTextWithoutAStartOrATrackIsNotAWorkout() {
        XCTAssertNil(HuaweiMotionPathParser.fromBrokenText("{\"sportType\":4,\"junk"))
    }

    func testElevationChangeIgnoresNoise() {
        let (gain, loss) = HuaweiMotionPathParser.elevationChange([10.0, 11.0, 9.5, 14.0, 20.0, 15.0, 15.5])
        XCTAssertEqual(gain, 10.0, accuracy: 1e-9)
        XCTAssertEqual(loss, 5.0, accuracy: 1e-9)
        XCTAssertEqual(HuaweiMotionPathParser.elevationChange([]).gain, 0)
    }

    func testTrackParserKeepsTheLastDuplicateKeyAndSkipsGarbage() {
        let track = HuaweiMotionPathParser.parseTrack("junk\r\ntp=lbs;k=0;lat=1;lat=2;lon=3;t=100;\r\ntp=lbs;lat=0;lon=0;t=5;\ntp=lbs;lat=95;lon=3;t=5;\ntp=zzz;v=1;\n;;=;\n")
        XCTAssertEqual(track.gps.count, 1)
        XCTAssertEqual(track.gps[0].lat, 2)
        XCTAssertEqual(track.gps[0].ts, 100)
    }
}

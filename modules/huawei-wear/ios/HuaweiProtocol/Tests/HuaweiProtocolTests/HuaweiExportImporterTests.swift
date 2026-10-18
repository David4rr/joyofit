import Foundation
import XCTest
@testable import HuaweiProtocol

/// Translation of HuaweiExportImporterTest.kt (synthetic fixtures only). The encrypted-ZIP cases read archives zip4j wrote (ZipArchiveTests).
final class HuaweiExportImporterTests: XCTestCase {
    private let t0: Int64 = 1_750_000_020_000

    private struct MinuteCopy: Equatable {
        let ts: Int64
        let steps: Int
        let distance: Int
        let heartRate: Int?
        let spo2: Int?
        let resting: Int?
    }

    private final class FakeStore: HuaweiImportStore {
        var minutes = [MinuteCopy]()
        var sleep = [ImportedSleep]()
        var stress = [ImportedStress]()
        var workouts = [ImportedWorkout]()
        var writeCalls = 0

        func writeMinutes(_ rows: [ImportedMinute]) throws -> Int {
            writeCalls += 1
            for m in rows {
                minutes.append(MinuteCopy(ts: m.ts, steps: m.steps, distance: m.distance, heartRate: m.heartRate, spo2: m.spo2, resting: m.restingHeartRate))
            }
            return rows.count
        }

        func writeSleep(_ segments: [ImportedSleep]) throws -> Int {
            sleep += segments
            return segments.count
        }

        func writeStress(_ points: [ImportedStress]) throws -> Int {
            stress += points
            return points.count
        }

        func writeWorkout(_ workout: ImportedWorkout) throws -> WorkoutWrite {
            workouts.append(workout)
            return WorkoutWrite(added: true, points: workout.points.count)
        }
    }

    /// Files in memory, delivered in `chunk`-byte pieces so record boundaries fall everywhere.
    private struct MapSource: HuaweiExportSource {
        let files: [(String, String)]
        var chunk = 4096
        var failing: Set<String> = []

        func entries() -> [HuaweiExportEntry] { files.map { HuaweiExportEntry(name: $0.0, size: Int64($0.1.utf8.count)) } }

        func read(_ entry: HuaweiExportEntry, into sink: (Bytes) throws -> Void) throws {
            let bytes = Bytes(files.first { $0.0 == entry.name }!.1.utf8)
            var at = 0
            while at < bytes.count {
                let to = min(bytes.count, at + chunk)
                try sink(Array(bytes[at..<to]))
                at = to
                if failing.contains(entry.name) && at >= bytes.count / 2 { throw HuaweiExportReadError("damaged") }
            }
        }
    }

    private func sample(_ key: String, _ startMs: Int64, _ endMs: Int64, _ value: String) -> String {
        "{\"key\":\"\(key)\",\"startTime\":\(startMs),\"endTime\":\(endMs),\"unit\":\"0\",\"value\":\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\"}"
    }

    private func healthRecord(_ samples: String...) -> String { healthRecord(samples) }

    private func healthRecord(_ samples: [String]) -> String {
        "{\"type\":7,\"startTime\":\(t0),\"endTime\":\(t0 + 60_000),\"timeZone\":\"+0700\",\"recordId\":\"x\",\"samplePoints\":[\(samples.joined(separator: ","))]}"
    }

    private let healthFile = "Health detail data & description/Health detail data1.json"
    private let sportFile = "Sport per minute merged data & description/Sport per minute1.json"
    private let motionFile = "Motion path detail data & description/Motion path detail data1.json"

    private func sportRecord(_ entries: String...) -> String { "{\"recordDay\":20250615,\"sportDataUserData\":[\(entries.joined(separator: ","))]}" }

    private func sportEntry(_ steps: Int, _ distance: Int) -> String {
        "{\"startTime\":\(t0),\"endTime\":\(t0 + 60_000),\"sportType\":5,\"sportBasicInfos\":[{\"steps\":\(steps),\"distance\":\(distance),\"calorie\":5,\"duration\":1}]}"
    }

    private func motionRecord(_ startMs: Int64? = nil) -> String {
        let start = startMs ?? t0
        return "{\"abnormalTrack\":\"\",\"sportType\":4,\"startTime\":\(start),\"endTime\":\(start + 600_000),\"totalSteps\":900,\"totalDistance\":1200,\"totalCalories\":80,"
            + "\"attribute\":\"HW_EXT_TRACK_DETAIL@is\\ntp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=\(start / 1000).0;\\ntp=h-r;k=\(start + 5_000);v=130;\\n\"}"
    }

    @discardableResult
    private func run(_ files: [(String, String)], store: FakeStore = FakeStore(), chunk: Int = 4096, cancelled: @escaping () -> Bool = { false }) throws
        -> HuaweiImportSummary
    {
        try HuaweiExportImporter(store: store, onProgress: { _ in }, isCancelled: cancelled).run(MapSource(files: files, chunk: chunk))
    }

    func testMergesReadingsOfTheSameMinuteAndKeepsTheLargestStepCount() throws {
        for chunk in [1, 13, 4096] {
            let store = FakeStore()
            let summary = try run(
                [
                    (
                        healthFile,
                        "[" + healthRecord(
                            sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 5_000, t0 + 5_000, "80"),
                            sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 35_000, t0 + 35_000, "90"),
                            sample("BLOOD_OXYGEN_SATURATION", t0 + 10_000, t0 + 10_000, #"{"avgSaturation":97}"#),
                            sample("DATA_POINT_REST_HEARTRATE", t0, t0 + 1000, "58"),
                            sample("STRESS_DATA", t0, t0, #"{"score":30}"#),
                            sample("PROFESSIONAL_SLEEP_DEEP", t0, t0 + 1_800_000, ""),
                            sample("WEIGHT_BODYFAT_BROAD", t0, t0, #"{"bodyWeight":70}"#)
                        ) + "]"
                    ),
                    // The export repeats minutes: 10, 12 and 10 steps are one minute, not 32.
                    (sportFile, "[" + sportRecord(sportEntry(10, 8), sportEntry(12, 9), sportEntry(10, 8)) + "]"),
                ], store: store, chunk: chunk)
            // The health file and the sport file are flushed separately; the database merges the two rows of the minute.
            XCTAssertEqual(store.minutes.count, 2, "chunk \(chunk)")
            let (health, sport) = (store.minutes[0], store.minutes[1])
            XCTAssertEqual(health.ts, 1_750_000_020)
            XCTAssertEqual(sport.ts, 1_750_000_020)
            XCTAssertEqual(health.heartRate, 80)
            XCTAssertEqual(health.spo2, 97)
            XCTAssertEqual(health.resting, 58)
            XCTAssertEqual(sport.steps, 12)
            XCTAssertEqual(sport.distance, 9)
            XCTAssertEqual(store.sleep.count, 1)
            XCTAssertEqual(store.sleep[0].type, 0x07)
            XCTAssertEqual(store.stress.map(\.score), [30])
            XCTAssertEqual(summary.heartRateReadings, 2)
            XCTAssertEqual(summary.unmappedSamples, 1)
            XCTAssertEqual(summary.minutesWritten, 2)
            XCTAssertEqual(summary.sleepSegmentsAdded, 1)
            XCTAssertEqual(summary.filesRead, 2)
            XCTAssertEqual(summary.badRecords, 0)
            XCTAssertEqual(summary.oldestSec, 1_750_000_020)
            XCTAssertEqual(summary.newestSec, 1_750_000_020 + 1800)
        }
    }

    func testABadRecordIsCountedAndTheRestStillImported() throws {
        let store = FakeStore()
        let summary = try run(
            [
                (
                    healthFile,
                    "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70")) + ",{\"samplePoints\": },"
                        + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 120_000, t0 + 120_000, "75")) + "]"
                )
            ], store: store)
        XCTAssertEqual(summary.badRecords, 1)
        XCTAssertEqual(store.minutes.sorted { $0.ts < $1.ts }.map(\.heartRate), [70, 75])
    }

    func testMotionPathBecomesAWorkout() throws {
        let store = FakeStore()
        let summary = try run([(motionFile, "[\(motionRecord())]")], store: store)
        XCTAssertEqual(store.workouts.count, 1)
        XCTAssertEqual(summary.workoutsFound, 1)
        XCTAssertEqual(summary.workoutsAdded, 1)
        XCTAssertEqual(summary.workoutPointsAdded, 2)
        XCTAssertEqual(store.workouts[0].distance, 1200)
        XCTAssertEqual(store.workouts[0].avgHr, 130)
    }

    func testAMotionRecordWithoutAUsableTimeIsABadRecord() throws {
        let store = FakeStore()
        let summary = try run([(motionFile, #"[{"sportType":4,"attribute":""}]"#)], store: store)
        XCTAssertEqual(summary.badRecords, 1)
        XCTAssertTrue(store.workouts.isEmpty)
    }

    func testAStrayQuoteThatSwallowsTheNextWorkoutLosesNeitherOfThem() throws {
        // The odd quote after "a " flips string state for the rest of the file, so the record never closes by itself.
        let second = motionRecord(t0 + 7_200_000)
        let broken =
            "[{\"abnormalTrack\":\"\",\"sportType\":4,\"startTime\":\(t0),\"endTime\":\(t0 + 600_000),\"totalDistance\":900,\"attribute\":\"a \"b;\\n"
            + "tp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=1.75000002E9;\\n\"},\(second)]"
        for chunk in [1, 4096] {
            let store = FakeStore()
            let summary = try run([(motionFile, broken)], store: store, chunk: chunk)
            XCTAssertEqual(summary.badRecords, 0, "chunk \(chunk)")
            XCTAssertEqual(store.workouts.count, 2)
            XCTAssertEqual(store.workouts[0].distance, 900)
        }
    }

    func testFilesOutsideTheDataFoldersAreIgnoredAndAnExportWithoutThemIsRejected() throws {
        let store = FakeStore()
        let summary = try run(
            [
                (healthFile, "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70")) + "]"),
                ("Sample sequence data & description/readme.json", "[]"),
                ("SportsHealth/summary.xls", "binary"),
            ], store: store)
        XCTAssertEqual(summary.filesIgnored, 2)
        XCTAssertEqual(summary.filesRead, 1)
        XCTAssertThrowsError(try run([("somewhere/else.json", "[]")])) { error in
            XCTAssertEqual((error as? HuaweiImportException)?.kind, .notAnExport)
        }
    }

    func testFilesAreReadHealthFirstThenSportThenMotion() throws {
        var names = [String]()
        let importer = HuaweiExportImporter(store: FakeStore(), onProgress: { if $0.phase == "reading" { names.append($0.fileName ?? "") } })
        _ = try importer.run(MapSource(files: [(motionFile, "[]"), (sportFile, "[]"), (healthFile, "[]")]))
        XCTAssertEqual(names, ["Health detail data1.json", "Sport per minute1.json", "Motion path detail data1.json"])
    }

    func testCancellingKeepsWhatWasReadSoFar() throws {
        let store = FakeStore()
        var records = 0
        let summary = try run(
            [
                (
                    healthFile,
                    "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70")) + ","
                        + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 120_000, t0 + 120_000, "75")) + "]"
                )
            ], store: store, cancelled: { defer { records += 1 }; return records >= 1 })
        XCTAssertTrue(summary.cancelled)
        XCTAssertEqual(store.minutes.map(\.heartRate), [70])
    }

    func testAMemberThatCannotBeReadCostsThatFileOnly() throws {
        let store = FakeStore()
        let files = [
            (healthFile, "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70")) + "]"),
            (sportFile, "[" + sportRecord(sportEntry(10, 8)) + "]"),
        ]
        let summary = try HuaweiExportImporter(store: store, onProgress: { _ in }).run(MapSource(files: files, chunk: 8, failing: [healthFile]))
        XCTAssertEqual(summary.filesFailed, 1)
        XCTAssertEqual(summary.filesRead, 1)
        XCTAssertEqual(store.minutes.map(\.steps), [10])
    }

    func testLargeFilesAreFlushedInChunks() throws {
        let store = FakeStore()
        // 25 000 distinct minutes of heart rate in one record per 1 000 minutes.
        let records = (0..<25).map { chunk in
            healthRecord((0..<1000).map { i in
                let t = t0 + (Int64(chunk) * 1000 + Int64(i)) * 60_000
                return sample("DATA_POINT_DYNAMIC_HEARTRATE", t, t, "70")
            })
        }
        let summary = try run([(healthFile, "[" + records.joined(separator: ",") + "]")], store: store)
        XCTAssertEqual(summary.minutesWritten, 25_000)
        XCTAssertTrue(store.writeCalls >= 2, "expected a flush before the end")
        // Rows go out in time order.
        XCTAssertEqual(store.minutes.map(\.ts), store.minutes.map(\.ts).sorted())
    }

    func testProgressEndsWithDoneAtFractionOneAndCarriesTheCounts() throws {
        var events = [HuaweiImportProgress]()
        let importer = HuaweiExportImporter(store: FakeStore(), onProgress: { events.append($0) }, nowMs: { 0 })
        _ = try importer.run(MapSource(files: [(healthFile, "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70")) + "]")]))
        let last = try XCTUnwrap(events.last)
        XCTAssertEqual(last.phase, "done")
        XCTAssertEqual(last.fraction, 1.0)
        XCTAssertNil(last.fileName)
        XCTAssertEqual(last.summary.heartRateReadings, 1)
        let js = last.toJS()
        XCTAssertEqual(js["phase"] as? String, "done")
        XCTAssertTrue(js["fileName"] is NSNull)
        XCTAssertEqual((js["summary"] as? [String: Any])?["heartRateReadings"] as? Int, 1)
        let reading = events.filter { $0.phase == "reading" }
        XCTAssertTrue(reading.allSatisfy { $0.fileCount == 1 && $0.fraction >= 0 && $0.fraction <= 1 })
    }

    func testExportKindIsDecidedByTheFolder() {
        XCTAssertEqual(HuaweiExportKind.of("Health detail data & description/a.json"), .healthDetail)
        XCTAssertEqual(HuaweiExportKind.of("x\\Sport per minute merged data & description\\a.JSON"), .sportPerMinute)
        XCTAssertEqual(HuaweiExportKind.of("Motion path detail data & description/motion path detail data.json"), .motionPath)
        XCTAssertNil(HuaweiExportKind.of("Health detail data & description/readme.xlsx"))
        XCTAssertNil(HuaweiExportKind.of("User route/plan.json"))
        XCTAssertEqual(HuaweiExportKind.of("motion path detail data.json"), .motionPath)
        XCTAssertNil(HuaweiExportKind.of("other/file.json"))
    }

    func testSummaryShapeIsTheOneTheTypeScriptTypesDeclare() {
        var summary = HuaweiImportSummary()
        let keys = Set(summary.toJS().keys)
        XCTAssertEqual(
            keys,
            [
                "filesRead", "filesFailed", "filesIgnored", "badRecords", "rejectedSamples", "unmappedSamples", "heartRateReadings",
                "restingHeartRateReadings", "spo2Readings", "stressReadings", "sleepSegmentsFound", "minutesWritten", "sleepSegmentsAdded",
                "stressAdded", "workoutsFound", "workoutsAdded", "workoutPointsAdded", "oldestSec", "newestSec", "cancelled",
            ])
        XCTAssertTrue(summary.toJS()["oldestSec"] is NSNull)
        summary.seen(500)
        summary.seen(100)
        summary.seen(900)
        XCTAssertEqual(summary.toJS()["oldestSec"] as? Int64, 100)
        XCTAssertEqual(summary.toJS()["newestSec"] as? Int64, 900)
    }
}

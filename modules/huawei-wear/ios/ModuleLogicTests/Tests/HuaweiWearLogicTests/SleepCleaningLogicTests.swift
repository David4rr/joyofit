import Foundation
import XCTest
@testable import HuaweiWearLogic

private let jakarta = TimeZone(secondsFromGMT: 7 * 3600)!
private let MIN: Int64 = 60

/// Unix seconds of `HH:MM[:SS]` on 2026-10-`day`, Jakarta time (UTC+7).
private func wib(_ day: Int, _ clock: String) -> Int64 {
    let parts = clock.split(separator: ":").map { Int64($0)! }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let midnight = calendar.date(from: DateComponents(year: 2026, month: 10, day: day))!.timeIntervalSince1970
    return Int64(midnight) + (parts[0] - 7) * 3600 + parts[1] * 60 + (parts.count > 2 ? parts[2] : 0)
}

/// The stage-less ranges of Sunday 18 Oct 2026 on a Watch Fit 2 (salim-2.jpg): 3 h 59 min of sleep from 00:00, fragments, and at 04:34 a block
/// of 32 minutes that was a morning run started from the watch (04:34:05 to 05:06:40).
private let nightWithRun: [(Int, String, Int64)] = [
    (17, "22:41", 7), (18, "00:00", 239), (18, "04:03", 5), (18, "04:12", 1), (18, "04:16", 3), (18, "04:21", 1), (18, "04:31", 2),
    (18, "04:34", 32), (18, "05:07", 2), (18, "05:12", 2), (18, "05:19", 1), (18, "05:22", 3), (18, "05:26", 5), (18, "05:34", 1),
    (18, "05:37", 1), (18, "05:39", 2), (18, "05:45", 5), (18, "06:03", 1), (18, "06:05", 2), (18, "06:19", 5), (18, "06:27", 2),
    (18, "06:32", 2), (18, "06:37", 1),
]

final class SleepStoreTests: XCTestCase {
    private var store: SyncStore!

    override func setUpWithError() throws {
        store = SyncStore(url: temporaryDatabaseURL())
        try store.upsertDevice(address: "A", name: "HUAWEI WATCH FIT 4 Pro-40A", productModel: "ALT-B19", softwareVersion: "1")
    }

    private func insertNight(imported: Bool = false) throws {
        try store.read { db in
            for (day, clock, minutes) in nightWithRun {
                try db.run(
                    "INSERT INTO sleep_segments (start, end, type, stage, imported) VALUES (?, ?, 6, NULL, ?)",
                    [.int(wib(day, clock)), .int(wib(day, clock) + minutes * MIN), .int(imported ? 1 : 0)]
                )
            }
        }
    }

    private func insertRun(imported: Bool = false) throws {
        try store.read { db in
            try db.run(
                """
                INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, distance, calories, duration, steps, summary_json, complete, imported)
                VALUES (1, ?, ?, 1, 'Run', 0, 0, 1955, 0, '{}', 1, ?)
                """,
                [.int(wib(18, "04:34:05")), .int(wib(18, "05:06:40")), .int(imported ? 1 : 0)]
            )
        }
    }

    private func load(importedOnly: Bool = false) throws -> [SleepSegment] {
        try store.read { try SleepStore.load($0, endFromSec: wib(17, "12:00"), importedOnly: importedOnly) }
    }

    func testTheNightStoredByAnEarlierBuildComesBackWithoutTheRunOnceItIsInTheWorkoutsTable() throws {
        try insertNight()
        XCTAssertEqual(
            try load().map(\.start), [wib(18, "00:00"), wib(18, "04:31"), wib(18, "04:34"), wib(18, "05:07")],
            "without evidence the run still counts as sleep: the block and the chain around it are kept"
        )
        try insertRun()
        XCTAssertEqual(try load(), [SleepSegment(start: wib(18, "00:00"), end: wib(18, "03:59"), type: 6, stage: nil)])
    }

    func testStepsOfTheRunAreEvidenceToo() throws {
        try insertNight()
        try store.read { db in
            for t in stride(from: wib(18, "04:34"), to: wib(18, "05:06"), by: 60) {
                try db.run("INSERT INTO step_samples (timestamp, steps, calories, distance) VALUES (?, 40, 0, 0)", [.int(t)])
            }
            // A quiet minute is no evidence.
            try db.run("INSERT INTO step_samples (timestamp, steps, calories, distance) VALUES (?, 14, 0, 0)", [.int(wib(18, "01:00"))])
        }
        XCTAssertEqual(try load(), [SleepSegment(start: wib(18, "00:00"), end: wib(18, "03:59"), type: 6, stage: nil)])
    }

    func testASpotHrvMeasurementCutsARangeButANightReadingDoesNot() throws {
        let start = wib(16, "15:00")
        try store.read { db in
            try db.run("INSERT INTO sleep_segments (start, end, type, stage) VALUES (?, ?, 6, NULL)", [.int(start), .int(start + 25 * MIN)])
            try db.run("INSERT INTO hrv_readings (start, end, source, rmssd, beats) VALUES (?, ?, 'night', 40, 100)", [.int(start + 5 * MIN), .int(start + 6 * MIN)])
        }
        XCTAssertEqual(try store.read { try SleepStore.load($0, endFromSec: 0, importedOnly: false) }.count, 1)
        try store.read { db in
            try db.run("INSERT INTO hrv_readings (start, end, source, rmssd, beats) VALUES (?, ?, 'spot', 40, 60)", [.int(start + 12 * MIN), .int(start + 13 * MIN)])
        }
        XCTAssertEqual(try store.read { try SleepStore.load($0, endFromSec: 0, importedOnly: false) }, [])
    }

    func testImportedRowsAreEvidenceButOnlyReadWhenTheConsumerAsksForThem() throws {
        try insertNight(imported: true)
        try insertRun(imported: true)
        XCTAssertEqual(try load(importedOnly: true), [], "the consumer's imported filter is kept")
        XCTAssertEqual(try load(importedOnly: false).count, 1, "a Huawei import's rows are cleaned by the same rule")

        let own = SyncStore(url: temporaryDatabaseURL())
        try own.read { db in
            try db.run("INSERT INTO sleep_segments (start, end, type, stage, imported) VALUES (?, ?, 6, NULL, 0)", [.int(wib(18, "00:00")), .int(wib(18, "07:00"))])
            try db.run(
                """
                INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, distance, calories, duration, steps, summary_json, complete, imported)
                VALUES (1, ?, ?, 1, 'Run', 0, 0, 0, 0, '{}', 1, 1)
                """,
                [.int(wib(18, "04:34")), .int(wib(18, "05:06"))]
            )
        }
        let cleaned = try own.read { try SleepStore.load($0, endFromSec: 0, importedOnly: true) }
        XCTAssertEqual(cleaned.map(\.end), [wib(18, "04:34"), wib(18, "07:00")], "an imported workout still cuts the watch's own sleep")
        XCTAssertEqual(cleaned.map(\.breakBefore), [false, true])
    }

    func testAStagedNightIsReadAsStoredWhateverTheEvidence() throws {
        try store.read { db in
            try db.run("INSERT INTO sleep_segments (start, end, type, stage) VALUES (?, ?, 6, 'light')", [.int(wib(18, "23:00")), .int(wib(19, "06:00"))])
            try db.run(
                """
                INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, distance, calories, duration, steps, summary_json, complete)
                VALUES (1, ?, ?, 1, 'Run', 0, 0, 0, 0, '{}', 1)
                """,
                [.int(wib(19, "02:00")), .int(wib(19, "03:00"))]
            )
        }
        XCTAssertEqual(try store.read { try SleepStore.load($0, endFromSec: 0, importedOnly: false) }, [SleepSegment(start: wib(18, "23:00"), end: wib(19, "06:00"), type: 6, stage: "light")])
    }

    // MARK: consumers

    func testTheFamilySummaryCountsTheNightWithoutTheRun() throws {
        try insertNight()
        try insertRun()
        let now = Date(timeIntervalSince1970: Double(wib(18, "14:00")))
        let payload = try FamilySummary.build(store: store, scopes: FamilyScopes(sync: false, steps: false, sleep: true, restingHr: false, spo2: false), battery: nil, timeZone: jakarta, now: now)
        XCTAssertEqual(payload.days.first { $0.date == "2026-10-18" }?.sleepMin, 239)
    }

    func testTheHealthModelCountsTheNightWithoutTheRun() throws {
        try insertNight()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = jakarta
        func seconds() throws -> Int? {
            try store.read { HealthModelData.load(db: $0, requestedDay: 20261018, stepGoal: 8000, nowMs: wib(18, "14:00") * 1000, calendar: calendar).sleepSeconds }
        }
        XCTAssertEqual(try seconds(), (239 + 2 + 32 + 2) * 60, "before the run is stored it counts as sleep")
        try insertRun()
        XCTAssertEqual(try seconds(), 239 * 60)
    }

    func testTheSleepReportFeatureReadsTheCleanedNight() throws {
        try insertNight()
        try insertRun()
        let night = try store.read { db in SleepReport.lastNight(try SleepStore.load(db, endFromSec: wib(18, "12:00") - 36 * 3600, importedOnly: false)) }
        XCTAssertEqual(night?.totalSec, 239 * 60)
        XCTAssertEqual(night?.end, wib(18, "03:59"))
    }

    // MARK: Health export plan

    func testASessionBreakSplitsTheHealthKitSessionsWhateverTheGap() {
        let a = SleepSegment(start: 1_000, end: 20_000, type: 6, stage: nil)
        let b = SleepSegment(start: 21_000, end: 30_000, type: 6, stage: nil)
        XCTAssertEqual(HealthKitPlan.sleepSessions([a, b], fromSec: 0).count, 1, "a gap of 1000 s is the same session")
        let split = HealthKitPlan.sleepSessions([a, SleepSegment(start: b.start, end: b.end, type: 6, stage: nil, breakBefore: true)], fromSec: 0)
        XCTAssertEqual(split.map { [$0.startSec, $0.endSec] }, [[1_000, 20_000], [21_000, 30_000]])
    }

    func testTheStrayAndBlipRulesKeepTheBreak() {
        let a = SleepSegment(start: 1_000, end: 20_000, type: 6, stage: nil)
        let b = SleepSegment(start: 21_000, end: 30_000, type: 6, stage: nil, breakBefore: true)
        XCTAssertEqual(HealthKitPlan.withoutBlips(HealthKitPlan.withoutStrayUnstaged([a, b])).map(\.breakBefore), [false, true])
    }

    func testTheReplacedRangeCoversTheWindowAndEverythingAfterIt() {
        let plan = HealthKitPlan.SleepPlan(id: "x", startSec: 5_000, endSec: 9_000, stages: [])
        let early = HealthKitPlan.SleepPlan(id: "y", startSec: 100, endSec: 9_000, stages: [])
        XCTAssertEqual(HealthKitPlan.sleepReplaceRange(sessions: [plan], fromSec: 1_000).fromSec, 1_000)
        XCTAssertEqual(HealthKitPlan.sleepReplaceRange(sessions: [early], fromSec: 1_000).fromSec, 100, "a night that began before the window")
        XCTAssertEqual(HealthKitPlan.sleepReplaceRange(sessions: [], fromSec: 1_000).fromSec, 1_000, "no session left: the window is cleared")
        XCTAssertEqual(HealthKitPlan.sleepReplaceRange(sessions: [plan], fromSec: 1_000).toSec, HealthKitPlan.sleepReplaceEndSec)
    }

    func testTheHistoryIsRepairedOncePerRulesVersion() {
        XCTAssertEqual(HealthKitPlan.sleepExportFrom(windowFromSec: 5_000, storedRulesVersion: 0), 0)
        XCTAssertEqual(HealthKitPlan.sleepExportFrom(windowFromSec: 5_000, storedRulesVersion: SleepCleaning.rulesVersion - 1), 0)
        XCTAssertEqual(HealthKitPlan.sleepExportFrom(windowFromSec: 5_000, storedRulesVersion: SleepCleaning.rulesVersion), 5_000)
        XCTAssertEqual(HealthKitPlan.sleepExportFrom(windowFromSec: 5_000, storedRulesVersion: SleepCleaning.rulesVersion + 1), 5_000)
        XCTAssertEqual(SleepCleaning.rulesVersion, 2)
    }
}

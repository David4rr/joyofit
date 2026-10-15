import XCTest
@testable import HuaweiWearLogic

final class FakeHealthWriter: HealthWriter, @unchecked Sendable {
    private let lock = NSLock()
    var availability = "available"
    var allowed: Set<HealthRecordType> = Set(HealthRecordType.allCases)
    private(set) var batches: [HealthBatch] = []
    private(set) var versions: [Int64] = []
    private(set) var devices: [HealthDevice] = []
    private(set) var authorizationRequests = 0
    private(set) var settingsOpened = 0
    var failWrites = false

    func authorized() async throws -> Set<HealthRecordType> { allowed }
    func requestAuthorization() async throws { lock.locked { authorizationRequests += 1 } }
    func openSettings() async { lock.locked { settingsOpened += 1 } }

    func write(_ batch: HealthBatch, device: HealthDevice, version: Int64) async throws -> Int {
        if failWrites { throw WearError(.storage, "the Health store refused") }
        lock.locked {
            batches.append(batch)
            versions.append(version)
            devices.append(device)
        }
        switch batch {
        case .steps(let v), .distance(let v), .calories(let v): return v.count
        case .heartRate(let v), .spo2(let v): return v.count
        case .restingHeartRate(let v): return v.count
        case .sleep(let sessions, _, _): return sessions.reduce(0) { $0 + $1.stages.count }
        case .workouts(let rows): return rows.count
        }
    }

    func steps() -> [HealthKitPlan.Interval] { batches.flatMap { if case .steps(let v) = $0 { return v } else { return [] } } }
    func workouts() -> [WorkoutRow] { batches.flatMap { if case .workouts(let v) = $0 { return v } else { return [] } } }
    func sleeps() -> [(sessions: [HealthKitPlan.SleepPlan], from: Int64, to: Int64)] {
        batches.compactMap { if case .sleep(let s, let f, let t) = $0 { return (s, f, t) } else { return nil } }
    }
}

final class HealthExporterTests: XCTestCase {
    private var store: SyncStore!
    private var writer: FakeHealthWriter!
    private var settings: HealthExportSettings!
    private var events: RecordingEvents!
    private var exporter: HealthExporter!
    private let utc = TimeZone(secondsFromGMT: 0)!

    override func setUpWithError() throws {
        store = SyncStore(url: temporaryDatabaseURL())
        writer = FakeHealthWriter()
        settings = HealthExportSettings(defaults: ephemeralDefaults())
        events = RecordingEvents()
        exporter = HealthExporter(syncStore: store, writer: writer, settings: settings, events: events, timeZone: utc, now: { Date(timeIntervalSince1970: 2_000_000) })
        try store.upsertDevice(address: "A", name: "HUAWEI WATCH FIT 4 Pro-40A", productModel: "ALT-B19", softwareVersion: "1")
    }

    private func insertSamples(_ rows: [(Int64, Int, Int, Int, Int?, Int?, Int?)]) throws {
        try store.read { db in
            for r in rows {
                try db.run(
                    "INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [.int(r.0), .int(Int64(r.1)), .int(Int64(r.2)), .int(Int64(r.3)), .integer(r.4), .integer(r.5), .integer(r.6)]
                )
            }
        }
    }

    func testStatusBeforeAnyExport() async {
        let status = await exporter.status()
        XCTAssertEqual(status["availability"] as? String, "available")
        XCTAssertEqual(status["enabled"] as? Bool, false)
        XCTAssertEqual((status["granted"] as? [String])?.count, 8)
        XCTAssertEqual((status["missing"] as? [String])?.count, 0)
        XCTAssertEqual(status["exporting"] as? Bool, false)
        XCTAssertTrue(status["lastExportSec"] is NSNull)
        XCTAssertTrue(status["lastError"] is NSNull)
        XCTAssertTrue(status["lastCounts"] is NSNull)
        XCTAssertEqual(Set(status.keys), ["availability", "enabled", "granted", "missing", "exporting", "lastExportSec", "lastError", "lastCounts"])
    }

    func testStatusListsGrantedAndMissingInTheAndroidOrder() async {
        writer.allowed = [.steps, .sleepSession]
        let status = await exporter.status()
        XCTAssertEqual(status["granted"] as? [String], ["Steps", "SleepSession"])
        XCTAssertEqual(status["missing"] as? [String], ["HeartRate", "OxygenSaturation", "RestingHeartRate", "Distance", "ActiveCaloriesBurned", "ExerciseSession"])
    }

    func testBackfillWritesEverythingStoredDayByDayWithStableIdsAndOneVersion() async throws {
        let day: Int64 = 86_400
        try insertSamples([
            (day * 3 + 60, 5, 100, 4, 70, 98, 55),
            (day * 3 + 120, 0, 0, 0, 72, nil, nil),
            (day * 4 + 60, 7, 0, 6, nil, nil, 54),
        ])
        let counts = try await exporter.backfill()
        XCTAssertEqual(counts.steps, 2)
        XCTAssertEqual(counts.distance, 2)
        XCTAssertEqual(counts.calories, 1)
        XCTAssertEqual(counts.heartRate, 2)
        XCTAssertEqual(counts.spo2, 1)
        XCTAssertEqual(counts.restingHeartRate, 2, "one per day")
        XCTAssertEqual(writer.steps().map(\.id), ["joyofit:steps:\(day * 3 + 60)", "joyofit:steps:\(day * 4 + 60)"])
        XCTAssertEqual(Set(writer.versions), [2_000_000_000], "every write of one export carries the export time in ms as its version")
        XCTAssertEqual(writer.devices.first, HealthDevice(manufacturer: "Huawei", model: "ALT-B19", name: "HUAWEI WATCH FIT 4 Pro-40A"))
        XCTAssertEqual(settings.lastExportSec, 2_000_000)
        XCTAssertNil(settings.lastError)
        XCTAssertEqual(settings.lastCounts, counts.description)
        // Exporting again writes the same ids again (a replace on the HealthKit side, not a second sample).
        let again = try await exporter.backfill()
        XCTAssertEqual(again, counts)
        XCTAssertEqual(writer.steps().map(\.id), (writer.steps().prefix(2) + writer.steps().prefix(2)).map(\.id))
    }

    func testRestingHeartRateIdUsesTheLocalDayOfTheTimeZone() async throws {
        try insertSamples([(86_400 * 2 + 10, 0, 0, 0, nil, nil, 60)])
        let tokyo = HealthExporter(
            syncStore: store, writer: writer, settings: settings, events: events, timeZone: TimeZone(secondsFromGMT: 9 * 3600)!, now: { Date(timeIntervalSince1970: 2_000_000) }
        )
        _ = try await tokyo.backfill()
        let ids = writer.batches.compactMap { b -> [String]? in if case .restingHeartRate(let r) = b { return r.map(\.id) } else { return nil } }.flatMap { $0 }
        XCTAssertEqual(ids, ["joyofit:rhr:1970-01-03"])
    }

    func testTypesWithoutPermissionAreSkippedAndLogged() async throws {
        writer.allowed = [.steps]
        try insertSamples([(60, 5, 100, 4, 70, 98, 55)])
        let counts = try await exporter.backfill()
        XCTAssertEqual(counts.steps, 1)
        XCTAssertEqual(counts.distance + counts.heartRate + counts.spo2 + counts.calories + counts.restingHeartRate + counts.sleep, 0)
        XCTAssertEqual(writer.batches.count, 1)
        XCTAssertTrue(events.messages(.info).contains { $0.contains("skipping types without permission: HeartRate") })
    }

    func testNoPermissionAtAllIsUnsupportedAndRecorded() async throws {
        writer.allowed = []
        do {
            _ = try await exporter.backfill()
            XCTFail("expected ERR_UNSUPPORTED")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
            XCTAssertEqual(e.message, "no Apple Health write permission is granted")
        }
        XCTAssertEqual(settings.lastError, "no Apple Health write permission is granted")
        XCTAssertTrue(writer.batches.isEmpty)
    }

    func testUnavailableHealthIsUnsupported() async {
        writer.availability = "unavailable"
        do {
            _ = try await exporter.requestPermissions()
            XCTFail("expected ERR_UNSUPPORTED")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
        } catch { XCTFail("\(error)") }
        do {
            try await exporter.setEnabled(true)
            XCTFail("expected ERR_UNSUPPORTED")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
        } catch { XCTFail("\(error)") }
        XCTAssertFalse(settings.enabled)
    }

    func testEnablingNeedsAWritePermissionThenBackfills() async throws {
        writer.allowed = []
        do {
            try await exporter.setEnabled(true)
            XCTFail("expected ERR_UNSUPPORTED")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
            XCTAssertEqual(e.message, "Grant Apple Health write permission first")
        }
        XCTAssertFalse(settings.enabled)

        writer.allowed = [.steps]
        try insertSamples([(60, 5, 0, 0, nil, nil, nil)])
        try await exporter.setEnabled(true)
        XCTAssertTrue(settings.enabled)
        XCTAssertEqual(writer.steps().count, 1, "switching on writes everything stored")
        try await exporter.setEnabled(false)
        XCTAssertFalse(settings.enabled)
    }

    func testRequestPermissionsAsksOnceAndReturnsTheStatus() async throws {
        writer.allowed = [.steps]
        let status = try await exporter.requestPermissions()
        XCTAssertEqual(writer.authorizationRequests, 1)
        XCTAssertEqual(status["granted"] as? [String], ["Steps"])
        await exporter.openSettings()
        XCTAssertEqual(writer.settingsOpened, 1)
    }

    func testASyncCompleteExportsOnlyWhenSwitchedOn() async throws {
        try insertSamples([(1_000, 5, 0, 0, nil, nil, nil), (5_000, 7, 0, 0, nil, nil, nil)])
        let summary = SyncSummary(from: 4_000, to: 6_000, samples: 1, sleep: 0, totalSteps: 0, totalCalories: 0, totalDistance: 0)
        exporter.onSyncComplete(summary)
        await sleepMs(100)
        XCTAssertTrue(writer.batches.isEmpty, "switched off: nothing is written")

        settings.enabled = true
        exporter.onSyncComplete(summary)
        await eventually("the window export") { !writer.steps().isEmpty }
        XCTAssertEqual(writer.steps().map(\.startSec), [5_000], "only the sync window, not earlier samples")
    }

    func testFailedExportIsRecordedAndLogged() async throws {
        writer.failWrites = true
        try insertSamples([(60, 5, 0, 0, nil, nil, nil)])
        do {
            _ = try await exporter.backfill()
            XCTFail("expected a storage error")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .storage)
            XCTAssertTrue(e.message.hasPrefix("Apple Health export failed:"))
        }
        XCTAssertEqual(settings.lastError, "the Health store refused")
        XCTAssertTrue(events.messages(.error).contains { $0.contains("HealthKit: export failed") })
        XCTAssertFalse(exporter.exporting)
    }

    func testSleepIsWrittenAsSessionsWithTheRangeToReplace() async throws {
        try store.read { db in
            for (start, end, type, stage) in [(1_000, 2_000, 6, "light"), (2_000, 2_600, 7, "deep"), (50_000, 51_000, 1, nil as String?)] {
                try db.run("INSERT INTO sleep_segments (start, end, type, stage) VALUES (?, ?, ?, ?)", [.int(Int64(start)), .int(Int64(end)), .int(Int64(type)), .string(stage)])
            }
        }
        let counts = try await exporter.backfill()
        XCTAssertEqual(counts.sleep, 3)
        let sleep = writer.sleeps()
        XCTAssertEqual(sleep.count, 1)
        XCTAssertEqual(sleep[0].sessions.map(\.id), ["joyofit:sleep:1000", "joyofit:sleep:50000"])
        XCTAssertEqual(sleep[0].from, 1_000)
        XCTAssertEqual(sleep[0].to, 51_000)
    }

    func testASyncWindowReachesBackForTheNightThatStraddlesIt() async throws {
        try store.read { db in
            try db.run("INSERT INTO sleep_segments (start, end, type, stage) VALUES (?, ?, 6, 'light')", [.int(1_000_000 - 5 * 3600), .int(1_000_000 - 3600)])
        }
        settings.enabled = true
        exporter.onSyncComplete(SyncSummary(from: 1_000_000, to: 1_001_000, samples: 0, sleep: 0, totalSteps: 0, totalCalories: 0, totalDistance: 0))
        await eventually("the sleep export") { !writer.sleeps().isEmpty }
        XCTAssertEqual(writer.sleeps().first?.sessions.count, 1, "36 h of sleep lookback plus the day before: the whole night is seen")
    }

    func testWorkoutsAreWrittenOnceAndAgainOnlyWhenChangedOrBackfilled() async throws {
        try store.read { db in
            try db.run(
                """
                INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, distance, calories, avg_hr, max_hr, duration, steps, summary_json, complete)
                VALUES (1, 1000, 1600, 1, 'Run', 5000, 300, 150, 170, 600, 0, '{}', 1)
                """
            )
            try db.run(
                """
                INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, distance, calories, duration, steps, summary_json, complete)
                VALUES (2, 5000, 5100, 1, 'Walk', 0, 0, 100, 0, '{}', 0)
                """
            )
        }
        _ = try await exporter.backfill()
        XCTAssertEqual(writer.workouts().map(\.start), [1_000], "unfinished workouts are not written")
        XCTAssertEqual(settings.exportedWorkouts, ["1000|1600|300|5000"])

        // A sync window export does not repeat a written workout...
        settings.enabled = true
        exporter.onSyncComplete(SyncSummary(from: 0, to: 10, samples: 0, sleep: 0, totalSteps: 0, totalCalories: 0, totalDistance: 0))
        await sleepMs(150)
        XCTAssertEqual(writer.workouts().count, 1)

        // ...a backfill starts from scratch (idempotent on the HealthKit side by its sync id).
        _ = try await exporter.backfill()
        XCTAssertEqual(writer.workouts().count, 2)
    }

    func testWorkoutWithoutTheTableOrWithoutRowsWritesNothing() async throws {
        let counts = try await exporter.backfill()
        XCTAssertEqual(counts.workouts, 0)
        XCTAssertTrue(writer.workouts().isEmpty)
    }

    func testHonorWatchesAreManufacturedByHonor() async throws {
        try store.upsertDevice(address: "B", name: "HONOR Band 9-123", productModel: nil, softwareVersion: nil)
        try store.read { db in try db.run("UPDATE device SET last_sync = 5 WHERE address = 'B'") }
        try insertSamples([(60, 5, 0, 0, nil, nil, nil)])
        _ = try await exporter.backfill()
        XCTAssertEqual(writer.devices.first, HealthDevice(manufacturer: "Honor", model: "Band 9", name: "HONOR Band 9-123"))
    }
}

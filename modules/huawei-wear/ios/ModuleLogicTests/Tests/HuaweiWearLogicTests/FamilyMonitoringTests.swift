import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import HuaweiWearLogic

private let jakarta = TimeZone(secondsFromGMT: 7 * 3600)!
private let allScopes = FamilyScopes(sync: true, steps: true, sleep: true, restingHr: true, spo2: true)

/// Unix seconds of `hour:minute` on 2026-10-17 plus `day` days, in Jakarta time. Day 0 is "today" in these tests.
private func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Int64 {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = jakarta
    let date = calendar.date(from: DateComponents(year: 2026, month: 10, day: 17 + day, hour: hour, minute: minute))!
    return Int64(date.timeIntervalSince1970)
}

final class FamilySummaryTests: XCTestCase {
    private var store: SyncStore!
    /// Today 14:00 Jakarta.
    private let now = Date(timeIntervalSince1970: Double(at(0, 14)))

    override func setUpWithError() throws {
        store = SyncStore(url: temporaryDatabaseURL())
        try store.upsertDevice(address: "A", name: "HUAWEI WATCH FIT 4 Pro-40A", productModel: "ALT-B19", softwareVersion: "1")
    }

    private func build(_ scopes: FamilyScopes = allScopes, battery: Int? = nil) throws -> FamilyPayload {
        try FamilySummary.build(store: store, scopes: scopes, battery: battery, timeZone: jakarta, now: now)
    }

    private func sample(_ timestamp: Int64, steps: Int = 0, hr: Int? = nil, spo2: Int? = nil, resting: Int? = nil, imported: Bool = false) throws {
        try store.read { db in
            try db.run(
                "INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate, imported) VALUES (?, ?, 0, 0, ?, ?, ?, ?)",
                [.int(timestamp), .int(Int64(steps)), .integer(hr), .integer(spo2), .integer(resting), .int(imported ? 1 : 0)]
            )
        }
    }

    private func segment(_ start: Int64, _ end: Int64, type: Int = 1, stage: String? = "light", imported: Bool = false) throws {
        try store.read { db in
            try db.run(
                "INSERT INTO sleep_segments (start, end, type, stage, imported) VALUES (?, ?, ?, ?, ?)",
                [.int(start), .int(end), .int(Int64(type)), .string(stage), .int(imported ? 1 : 0)]
            )
        }
    }

    private func day(_ payload: FamilyPayload, _ date: String) -> FamilyDay? { payload.days.first { $0.date == date } }

    func testStepsFirstStepAndNewestSampleOfTheLastThreeLocalDays() throws {
        try sample(at(-3, 12), steps: 999)
        try sample(at(-2, 8), steps: 10)
        try sample(at(-2, 8, 1), steps: 0, hr: 70)
        try sample(at(-2, 9), steps: 5)
        // 23:59 and 00:00 Jakarta are different days even though both are the same day in UTC.
        try sample(at(-1, 23, 59), steps: 3)
        try sample(at(0, 0), steps: 4)
        try sample(at(0, 10), steps: 6)
        let payload = try build()
        XCTAssertEqual(payload.days.map(\.date), ["2026-10-15", "2026-10-16", "2026-10-17"])
        XCTAssertEqual(day(payload, "2026-10-15"), FamilyDay(date: "2026-10-15", steps: 15, firstStepAt: at(-2, 8) * 1000, lastSampleAt: at(-2, 9) * 1000))
        XCTAssertEqual(day(payload, "2026-10-16"), FamilyDay(date: "2026-10-16", steps: 3, firstStepAt: at(-1, 23, 59) * 1000, lastSampleAt: at(-1, 23, 59) * 1000))
        XCTAssertEqual(day(payload, "2026-10-17"), FamilyDay(date: "2026-10-17", steps: 10, firstStepAt: at(0, 0) * 1000, lastSampleAt: at(0, 10) * 1000))
    }

    func testADayOfZeroStepSamplesHasZeroStepsAndNoFirstStep() throws {
        try sample(at(0, 9), steps: 0, hr: 66)
        let today = try XCTUnwrap(day(try build(), "2026-10-17"))
        XCTAssertEqual(today.steps, 0)
        XCTAssertNil(today.firstStepAt)
        XCTAssertEqual(today.lastSampleAt, at(0, 9) * 1000)
    }

    func testRestingHeartRateIsTheLowestPositiveReadingAndImportedRowsAreIgnored() throws {
        try sample(at(0, 6), resting: 61)
        try sample(at(0, 7), resting: 58)
        try sample(at(0, 8), resting: 0)
        try sample(at(0, 9), resting: 50, imported: true)
        try sample(at(-1, 6), resting: nil)
        let payload = try build()
        XCTAssertEqual(day(payload, "2026-10-17")?.restingHr, 58)
        XCTAssertNil(day(payload, "2026-10-16")?.restingHr)
    }

    func testSpo2MinimumAndTheReadingsAtOrBelowNinety() throws {
        for (i, value) in [96, 90, 88, 91, 0].enumerated() { try sample(at(0, 1, i), spo2: value) }
        try sample(at(0, 5), spo2: 70, imported: true)
        try sample(at(-1, 1), spo2: 97)
        let payload = try build()
        let today = try XCTUnwrap(day(payload, "2026-10-17"))
        XCTAssertEqual(today.spo2Min, 88, "0 is no reading, imported rows are not the watch's")
        XCTAssertEqual(today.spo2LowCount, 2, "90 counts, 91 does not")
        let yesterday = try XCTUnwrap(day(payload, "2026-10-16"))
        XCTAssertEqual(yesterday.spo2Min, 97)
        XCTAssertEqual(yesterday.spo2LowCount, 0)
    }

    func testSleepIsTheNightThatEndsOnTheDateWithoutAwakeOverlapStrayOrImportedSegments() throws {
        try segment(at(-1, 23), at(0, 3), type: 1, stage: "light")
        try segment(at(0, 2), at(0, 3), type: 2, stage: "light")
        try segment(at(0, 3), at(0, 3, 30), type: 3, stage: "deep")
        try segment(at(0, 3, 30), at(0, 4), type: 4, stage: "awake")
        // An unstaged span next to a staged night only stretches it.
        try segment(at(0, 3, 30), at(0, 3, 45), type: 5, stage: nil)
        try segment(at(0, 4), at(0, 6), type: 6, stage: "rem", imported: true)
        let payload = try build()
        XCTAssertEqual(day(payload, "2026-10-17")?.sleepMin, 270)
        XCTAssertNil(day(payload, "2026-10-16")?.sleepMin)
    }

    func testANightRunsFromSixInTheEveningToSixInTheEvening() throws {
        try segment(at(-1, 16), at(-1, 17, 59), type: 1)
        try segment(at(-1, 17), at(-1, 18), type: 2)
        let payload = try build()
        XCTAssertEqual(day(payload, "2026-10-16")?.sleepMin, 119, "ends 17:59: the night that ends on the 16th")
        XCTAssertEqual(day(payload, "2026-10-17")?.sleepMin, 60, "ends at 18:00: the night that ends on the 17th")
    }

    func testAFewMinutesOfStillnessAreNotASleep() throws {
        try segment(at(0, 9), at(0, 9, 2), type: 1, stage: nil)
        XCTAssertNil(day(try build(), "2026-10-17")?.sleepMin)
    }

    func testWatchSyncTimeBatteryAndTimeZoneOffset() throws {
        try store.read { db in try db.run("UPDATE device SET last_sync = ? WHERE address = 'A'", [.int(at(0, 13, 30))]) }
        let payload = try build(battery: 64)
        XCTAssertEqual(payload.watchSyncAt, at(0, 13, 30) * 1000)
        XCTAssertEqual(payload.battery, 64)
        XCTAssertEqual(payload.tzOffsetMin, 420)
        XCTAssertEqual(payload.sentAt, at(0, 14) * 1000)
        XCTAssertTrue(payload.days.isEmpty, "no readings: no days")
        XCTAssertTrue(payload.hasContent)
    }

    func testNoSyncAndNoReadingsIsNothingToSend() throws {
        XCTAssertFalse(try build(battery: nil).hasContent)
    }

    func testOnlyGrantedCategoriesAreInTheBody() throws {
        try sample(at(0, 9), steps: 40, hr: 70, spo2: 89, resting: 60)
        try segment(at(-1, 23), at(0, 6))
        try store.read { db in try db.run("UPDATE device SET last_sync = ? WHERE address = 'A'", [.int(at(0, 13))]) }
        let stepsOnly = try build(FamilyScopes(sync: true, steps: true, sleep: false, restingHr: false, spo2: false), battery: 50)
        XCTAssertEqual(stepsOnly.days, [FamilyDay(date: "2026-10-17", steps: 40, firstStepAt: at(0, 9) * 1000, lastSampleAt: at(0, 9) * 1000)])
        let sleepAndSpo2 = try build(FamilyScopes(sync: true, steps: false, sleep: true, restingHr: false, spo2: true))
        XCTAssertEqual(sleepAndSpo2.days, [FamilyDay(date: "2026-10-17", sleepMin: 420, spo2Min: 89, spo2LowCount: 1, lastSampleAt: at(0, 9) * 1000)])
        let restingOnly = try build(FamilyScopes(sync: true, steps: false, sleep: false, restingHr: true, spo2: false))
        XCTAssertEqual(restingOnly.days, [FamilyDay(date: "2026-10-17", restingHr: 60, lastSampleAt: at(0, 9) * 1000)])
        let syncOff = try build(FamilyScopes(sync: false, steps: true, sleep: false, restingHr: false, spo2: false), battery: 50)
        XCTAssertNil(syncOff.watchSyncAt)
        XCTAssertNil(syncOff.battery)
        XCTAssertEqual(syncOff.days, [FamilyDay(date: "2026-10-17", steps: 40, firstStepAt: at(0, 9) * 1000)], "no newest-sample time without the sync scope")
    }

    func testACategoryThatIsOffIsNeverQueried() throws {
        // With the tables a category would read gone, building only succeeds when nothing touches them.
        try store.read { db in try db.exec("DROP TABLE sleep_segments") }
        _ = try build(FamilyScopes(sync: true, steps: true, sleep: false, restingHr: true, spo2: true))
        XCTAssertThrowsError(try build(allScopes))
        try store.read { db in
            try db.exec("DROP TABLE step_samples")
            try db.exec("DROP TABLE device")
        }
        let payload = try build(FamilyScopes(sync: false, steps: false, sleep: false, restingHr: false, spo2: false), battery: 70)
        XCTAssertFalse(payload.hasContent)
        XCTAssertThrowsError(try build(FamilyScopes(sync: true, steps: false, sleep: false, restingHr: false, spo2: false)))
        XCTAssertThrowsError(try build(FamilyScopes(sync: false, steps: false, sleep: false, restingHr: false, spo2: true)))
    }

    func testTheBodyIsKeySortedWithNullsForWatchSyncAndBatteryAndWithoutMissingFields() throws {
        let payload = FamilyPayload(sentAt: 1, tzOffsetMin: 420, watchSyncAt: nil, battery: nil, days: [FamilyDay(date: "2026-10-17", steps: 5)])
        XCTAssertEqual(
            try payload.json(),
            #"{"battery":null,"days":[{"date":"2026-10-17","steps":5}],"sentAt":1,"tzOffsetMin":420,"watchSyncAt":null}"#
        )
    }
}

// MARK: uploader

private final class FamilyClock: @unchecked Sendable {
    private let lock = NSLock()
    private var ms: Int64 = at(0, 14) * 1000

    var date: Date { lock.locked { Date(timeIntervalSince1970: Double(ms) / 1000) } }
    func advance(minutes: Int) { lock.locked { ms += Int64(minutes) * 60_000 } }
}

private final class FamilyFakeNetwork: @unchecked Sendable {
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    var status: Int? = 200
    var beforeAnswer: (@Sendable () -> Void)?

    var requests: [URLRequest] { lock.locked { _requests } }

    func answer(_ request: URLRequest) -> Int? {
        lock.locked { _requests.append(request) }
        beforeAnswer?()
        return status
    }
}

private final class FamilyFakeBackground: FamilyBackgroundUploading, @unchecked Sendable {
    private let lock = NSLock()
    private var handler: (@Sendable (_ file: String?, _ transfer: FamilyTransfer) -> Void)?
    private var _enqueued: [(request: URLRequest, file: URL)] = []
    private var _cancels = 0
    private var _attaches = 0

    var onFinish: (@Sendable (_ file: String?, _ transfer: FamilyTransfer) -> Void)? {
        get { lock.locked { handler } }
        set { lock.locked { handler = newValue } }
    }
    var enqueued: [(request: URLRequest, file: URL)] { lock.locked { _enqueued } }
    var cancels: Int { lock.locked { _cancels } }
    var attaches: Int { lock.locked { _attaches } }

    func enqueue(_ request: URLRequest, file: URL) { lock.locked { _enqueued.append((request, file)) } }
    func cancelPending() { lock.locked { _cancels += 1 } }
    func attach() { lock.locked { _attaches += 1 } }
}

final class FamilyUploaderTests: XCTestCase {
    private var store: SyncStore!
    private var defaults: UserDefaults!
    private var secrets: MemorySecretStore!
    private var settings: FamilySettings!
    private var network: FamilyFakeNetwork!
    private var background: FamilyFakeBackground!
    private var clock: FamilyClock!
    private var directory: URL!
    private let config = FamilyConfig(baseUrl: "https://api.example.test", token: "tok-1", scopes: allScopes, enabled: true)

    override func setUpWithError() throws {
        store = SyncStore(url: temporaryDatabaseURL())
        try store.upsertDevice(address: "A", name: "HUAWEI WATCH FIT 4 Pro-40A", productModel: "ALT-B19", softwareVersion: "1")
        defaults = ephemeralDefaults()
        secrets = MemorySecretStore()
        settings = FamilySettings(defaults: defaults, secrets: secrets)
        network = FamilyFakeNetwork()
        background = FamilyFakeBackground()
        clock = FamilyClock()
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("joyofit-family-\(UUID().uuidString)", isDirectory: true)
        try setLastSync(at(0, 13))
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func setLastSync(_ sec: Int64) throws {
        try store.read { db in try db.run("UPDATE device SET last_sync = ? WHERE address = 'A'", [.int(sec)]) }
    }

    private func makeUploader(background: FamilyBackgroundUploading?) -> FamilyUploader {
        let network = self.network!
        let clock = self.clock!
        return FamilyUploader(
            settings: settings, store: store, events: RecordingEvents(), battery: { 80 }, send: { network.answer($0) }, background: background,
            directory: directory, timeZone: jakarta, now: { clock.date }
        )
    }

    private func lastOutcome(_ uploader: FamilyUploader) -> String? { (uploader.status()["last"] as? [String: Any])?["outcome"] as? String }

    // MARK: foreground

    func testNothingIsSentWithoutAConfigOrWhileDisabled() async {
        let uploader = makeUploader(background: nil)
        let none = await uploader.uploadNow()
        XCTAssertEqual(none.outcome, .skipped)
        XCTAssertNil(none.status)
        var disabled = config
        disabled.enabled = false
        uploader.configure(disabled)
        let paused = await uploader.uploadNow()
        XCTAssertEqual(paused.outcome, .skipped)
        XCTAssertTrue(network.requests.isEmpty)
        XCTAssertNil(settings.last, "a skip is not an attempt")
        XCTAssertEqual(uploader.status()["configured"] as? Bool, true)
        XCTAssertEqual(uploader.status()["enabled"] as? Bool, false)
    }

    func testUploadNowSendsTheSignedSummaryAndKeepsTheExactBody() async throws {
        let uploader = makeUploader(background: nil)
        uploader.configure(config)
        let result = await uploader.uploadNow()
        XCTAssertEqual(result.outcome, .sent)
        XCTAssertEqual(result.status, 200)
        XCTAssertEqual(result.at, at(0, 14) * 1000)
        let request = try XCTUnwrap(network.requests.first)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.url?.absoluteString, "https://api.example.test/v1/family/ingest")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok-1")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = String(decoding: try XCTUnwrap(request.httpBody), as: UTF8.self)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])
        XCTAssertEqual(json["battery"] as? Int, 80)
        XCTAssertEqual(json["tzOffsetMin"] as? Int, 420)
        XCTAssertEqual((json["watchSyncAt"] as? NSNumber)?.int64Value, at(0, 13) * 1000)
        let status = uploader.status()
        XCTAssertEqual(status["lastPayload"] as? String, body)
        XCTAssertEqual(lastOutcome(uploader), "sent")
    }

    func testUploadNowIgnoresTheThrottle() async {
        let uploader = makeUploader(background: nil)
        uploader.configure(config)
        _ = await uploader.uploadNow()
        _ = await uploader.uploadNow()
        XCTAssertEqual(network.requests.count, 2)
    }

    func testARevokedTokenOrNoActiveLinkDropsTheConfigButKeepsTheResult() async {
        for status in [401, 403] {
            let uploader = makeUploader(background: nil)
            uploader.configure(config)
            network.status = status
            let result = await uploader.uploadNow()
            XCTAssertEqual(result.outcome, .rejected)
            XCTAssertEqual(result.status, status)
            XCTAssertEqual(uploader.status()["configured"] as? Bool, false)
            XCTAssertEqual(lastOutcome(uploader), "rejected")
            XCTAssertNil(secrets.get("family_token"), "the token is gone with the config")
            let again = await uploader.uploadNow()
            XCTAssertEqual(again.outcome, .skipped)
        }
    }

    func testAServerErrorOrNoAnswerIsFailedAndKeepsTheConfig() async {
        let uploader = makeUploader(background: nil)
        uploader.configure(config)
        network.status = 500
        let error = await uploader.uploadNow()
        XCTAssertEqual(error.outcome, .failed)
        XCTAssertEqual(error.status, 500)
        network.status = nil
        let offline = await uploader.uploadNow()
        XCTAssertEqual(offline.outcome, .failed)
        XCTAssertNil(offline.status)
        XCTAssertEqual(uploader.status()["configured"] as? Bool, true)
        XCTAssertTrue(uploader.status()["lastPayload"] is NSNull, "only an accepted body is kept")
    }

    func testAnAnswerThatArrivesAfterTheConfigWasClearedIsNotKept() async {
        let uploader = makeUploader(background: nil)
        uploader.configure(config)
        network.beforeAnswer = { uploader.configure(nil) }
        let result = await uploader.uploadNow()
        XCTAssertEqual(result.outcome, .sent)
        XCTAssertEqual(uploader.status()["configured"] as? Bool, false)
        XCTAssertNil(settings.last)
        XCTAssertNil(settings.lastPayload)
    }

    func testClearingTheConfigDropsEverythingKeptForIt() async {
        let uploader = makeUploader(background: background)
        uploader.configure(config)
        _ = await uploader.uploadNow()
        XCTAssertNotNil(settings.lastPayload)
        XCTAssertNotNil(settings.attempt)
        uploader.configure(nil)
        let status = uploader.status()
        XCTAssertEqual(status["configured"] as? Bool, false)
        XCTAssertEqual(status["enabled"] as? Bool, false)
        XCTAssertTrue(status["last"] is NSNull)
        XCTAssertTrue(status["lastPayload"] is NSNull)
        XCTAssertNil(settings.attempt)
        XCTAssertNil(secrets.get("family_token"))
        XCTAssertEqual(background.cancels, 2, "each configure cancels what is pending")
    }

    func testTheTokenLivesInTheSecretStoreAndNotInDefaults() {
        makeUploader(background: nil).configure(config)
        XCTAssertEqual(secrets.get("family_token"), "tok-1")
        XCTAssertEqual(FamilySettings(defaults: defaults, secrets: secrets).config, config)
        XCTAssertNil(FamilySettings(defaults: defaults, secrets: MemorySecretStore()).config, "without the token there is no config")
        for value in defaults.dictionaryRepresentation().values { XCTAssertNotEqual(value as? String, "tok-1") }
    }

    // MARK: background

    func testAfterASyncTheBodyIsQueuedAsAFileOnTheBackgroundSession() async throws {
        let uploader = makeUploader(background: background)
        uploader.configure(config)
        await uploader.uploadAfterSync()
        XCTAssertTrue(network.requests.isEmpty)
        let queued = try XCTUnwrap(background.enqueued.first)
        XCTAssertEqual(queued.request.httpMethod, "PUT")
        XCTAssertEqual(queued.request.url?.absoluteString, "https://api.example.test/v1/family/ingest")
        XCTAssertEqual(queued.request.value(forHTTPHeaderField: "Authorization"), "Bearer tok-1")
        XCTAssertNil(queued.request.httpBody, "the body is the file")
        XCTAssertEqual(queued.file.deletingLastPathComponent().path, directory.path)
        let body = try String(contentsOf: queued.file, encoding: .utf8)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])
        XCTAssertEqual(json["battery"] as? Int, 80)
        XCTAssertNil(settings.last, "the answer is not in yet")
    }

    func testTheSystemsAnswerIsRecordedAndTheFileIsRemoved() async throws {
        let uploader = makeUploader(background: background)
        uploader.configure(config)
        await uploader.uploadAfterSync()
        let file = try XCTUnwrap(background.enqueued.first).file
        let body = try String(contentsOf: file, encoding: .utf8)
        background.onFinish?(file.lastPathComponent, .status(200))
        XCTAssertEqual(lastOutcome(uploader), "sent")
        XCTAssertEqual(uploader.status()["lastPayload"] as? String, body)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testABackgroundRejectionDropsTheConfigAndTheQueue() async throws {
        let uploader = makeUploader(background: background)
        uploader.configure(config)
        await uploader.uploadAfterSync()
        let file = try XCTUnwrap(background.enqueued.first).file
        let cancelsBefore = background.cancels
        background.onFinish?(file.lastPathComponent, .status(403))
        XCTAssertEqual(lastOutcome(uploader), "rejected")
        XCTAssertEqual(uploader.status()["configured"] as? Bool, false)
        XCTAssertEqual(background.cancels, cancelsBefore + 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testABackgroundTransferWithoutAnAnswerIsFailedAndACancelledOneIsForgotten() async throws {
        let uploader = makeUploader(background: background)
        uploader.configure(config)
        await uploader.uploadAfterSync()
        let file = try XCTUnwrap(background.enqueued.first).file
        background.onFinish?(file.lastPathComponent, .cancelled)
        XCTAssertNil(settings.last, "superseded or dropped: nothing to report")
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        background.onFinish?(nil, .failed)
        XCTAssertEqual(lastOutcome(uploader), "failed")
        XCTAssertEqual(uploader.status()["configured"] as? Bool, true)
        background.onFinish?(nil, .status(500))
        XCTAssertEqual((settings.last)?.status, 500)
    }

    func testAfterASyncWithoutABackgroundSessionTheBodyGoesOutInTheForeground() async {
        let uploader = makeUploader(background: nil)
        uploader.configure(config)
        await uploader.uploadAfterSync()
        XCTAssertEqual(network.requests.count, 1)
        XCTAssertEqual(lastOutcome(uploader), "sent")
    }

    func testAfterASyncNothingHappensWithoutAConfig() async {
        let uploader = makeUploader(background: background)
        await uploader.uploadAfterSync()
        XCTAssertTrue(background.enqueued.isEmpty)
        XCTAssertTrue(network.requests.isEmpty)
    }

    func testThrottleHoldsBackTheSameSyncForTenMinutesAndANewSyncBreaksIt() async throws {
        let uploader = makeUploader(background: background)
        uploader.configure(config)
        await uploader.uploadAfterSync()
        clock.advance(minutes: 9)
        await uploader.uploadAfterSync()
        XCTAssertEqual(background.enqueued.count, 1, "same sync, 9 minutes")
        try setLastSync(at(0, 14))
        await uploader.uploadAfterSync()
        XCTAssertEqual(background.enqueued.count, 2, "the watch synced again")
        clock.advance(minutes: 10)
        await uploader.uploadAfterSync()
        XCTAssertEqual(background.enqueued.count, 3, "ten minutes passed")
    }

    func testAForcedUploadNowStillSendsInsideTheThrottle() async {
        let uploader = makeUploader(background: background)
        uploader.configure(config)
        await uploader.uploadAfterSync()
        let result = await uploader.uploadNow()
        XCTAssertEqual(result.outcome, .sent)
        XCTAssertEqual(network.requests.count, 1)
    }

    func testChangingTheConfigDropsWhatWasQueued() async throws {
        let uploader = makeUploader(background: background)
        uploader.configure(config)
        await uploader.uploadAfterSync()
        let file = try XCTUnwrap(background.enqueued.first).file
        var narrower = config
        narrower.scopes.sleep = false
        uploader.configure(narrower)
        XCTAssertEqual(background.cancels, 2, "configure cancels the pending transfers each time")
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        XCTAssertEqual(settings.config, narrower)
    }

    func testTheBackgroundSessionIsReconnectedOnlyWithAConfig() {
        let uploader = makeUploader(background: background)
        uploader.attach()
        XCTAssertEqual(background.attaches, 0)
        uploader.configure(config)
        uploader.attach()
        XCTAssertEqual(background.attaches, 1)
    }

    // MARK: rules

    func testThrottleRule() {
        let attempt = FamilyAttempt(atMs: 1_000_000, watchSyncAt: 500)
        let tenMinutes: Int64 = 600_000
        XCTAssertTrue(FamilyUploader.isDue(force: false, attempt: nil, watchSyncAt: 500, nowMs: 1_000_000))
        XCTAssertFalse(FamilyUploader.isDue(force: false, attempt: attempt, watchSyncAt: 500, nowMs: 1_000_000 + tenMinutes - 1))
        XCTAssertTrue(FamilyUploader.isDue(force: false, attempt: attempt, watchSyncAt: 500, nowMs: 1_000_000 + tenMinutes))
        XCTAssertTrue(FamilyUploader.isDue(force: false, attempt: attempt, watchSyncAt: 501, nowMs: 1_000_001))
        XCTAssertTrue(FamilyUploader.isDue(force: false, attempt: attempt, watchSyncAt: nil, nowMs: 1_000_001), "the watch time vanished: that is a change")
        XCTAssertTrue(FamilyUploader.isDue(force: false, attempt: attempt, watchSyncAt: 500, nowMs: 999_000), "the clock moved back")
        XCTAssertTrue(FamilyUploader.isDue(force: true, attempt: attempt, watchSyncAt: 500, nowMs: 1_000_001))
    }

    func testOutcomeOfAStatus() {
        XCTAssertEqual(FamilyUploader.outcome(status: 200), .sent)
        XCTAssertEqual(FamilyUploader.outcome(status: 204), .sent)
        XCTAssertEqual(FamilyUploader.outcome(status: 401), .rejected)
        XCTAssertEqual(FamilyUploader.outcome(status: 403), .rejected)
        XCTAssertEqual(FamilyUploader.outcome(status: 400), .failed)
        XCTAssertEqual(FamilyUploader.outcome(status: 429), .failed)
        XCTAssertEqual(FamilyUploader.outcome(status: 503), .failed)
        XCTAssertEqual(FamilyUploader.outcome(status: nil), .failed)
    }

    func testTheConfigIsParsedFromTheJsObject() throws {
        let parsed = try FamilyConfig.parse([
            "baseUrl": " https://api.example.test/ ", "token": "t", "enabled": true,
            "scopes": ["sync": true, "steps": false, "sleep": true, "restingHr": false, "spo2": false],
        ])
        XCTAssertEqual(
            parsed,
            FamilyConfig(baseUrl: "https://api.example.test", token: "t", scopes: FamilyScopes(sync: true, steps: false, sleep: true, restingHr: false, spo2: false), enabled: true)
        )
    }

    func testAMalformedConfigIsAnInvalidArgument() {
        let scopes: [String: Any] = ["sync": true, "steps": true, "sleep": true, "restingHr": true, "spo2": true]
        let bad: [[String: Any]] = [
            ["token": "t", "enabled": true, "scopes": scopes],
            ["baseUrl": "not a url", "token": "t", "enabled": true, "scopes": scopes],
            ["baseUrl": "ftp://api.example.test", "token": "t", "enabled": true, "scopes": scopes],
            ["baseUrl": "https://api.example.test", "token": "", "enabled": true, "scopes": scopes],
            ["baseUrl": "https://api.example.test", "token": "t", "scopes": scopes],
            ["baseUrl": "https://api.example.test", "token": "t", "enabled": true, "scopes": ["sync": true]],
        ]
        for raw in bad {
            XCTAssertThrowsError(try FamilyConfig.parse(raw)) { error in
                XCTAssertEqual((error as? WearError)?.code, .invalidArgument, "\(raw)")
            }
        }
    }
}

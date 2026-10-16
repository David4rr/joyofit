import XCTest
@testable import HuaweiWearLogic

/// Fall detection and the morning sleep report against a scripted watch (the DataSync rig of DataSyncTests.swift).
final class SafetyFeaturesTests: XCTestCase {
    private let fixedNowMs: Int64 = 1_791_979_200_000

    private final class Rig {
        let data: DataSyncRig
        let settings: WatchExtrasSettings
        let safety: SafetyFeatures
        let store: SyncStore
        let sleep: SleepReportFeature
        let nowSec: Int64

        init(bits: [Int] = [83, 84], listsSos: Bool = true, nowSec: Int64 = 1_791_979_200, connected: Bool = true) {
            data = DataSyncRig(bits: bits, connected: connected)
            if listsSos { data.caps.supportedCommands = [0x33: [0x01, 0x02]] }
            settings = WatchExtrasSettings(defaults: ephemeralDefaults())
            store = SyncStore(url: temporaryDatabaseURL())
            self.nowSec = nowSec
            safety = SafetyFeatures(link: data.source, settings: settings, events: data.events, now: { Date(timeIntervalSince1970: TimeInterval(nowSec)) })
            sleep = SleepReportFeature(
                settings: settings, syncStore: store, events: data.events,
                zone: { TimeZone(identifier: "Asia/Jakarta")! }, locale: { ("id", "ID") }, now: { Date(timeIntervalSince1970: TimeInterval(nowSec)) }
            )
            data.service.register(safety)
            data.service.register(sleep)
        }

        func insertSegments(_ segments: [(Int64, Int64, String?)]) throws {
            try store.read { db in
                for (start, end, stage) in segments {
                    try db.run("INSERT INTO sleep_segments (start, end, type, stage) VALUES (?, ?, 6, ?)", [.int(start), .int(end), .string(stage)])
                }
            }
        }
    }

    private func fallConfigFrame(_ json: String?, action: UInt8 = 1) -> Bytes {
        var entry = HuaweiTLV()
        entry.put(0x05, int: Int32(SafetyPayloads.fallConfigId))
        entry.put(0x06, byte: action)
        if let json { entry.put(0x07, string: json) }
        var list = HuaweiTLV()
        list.put(0x84, tlv: entry)
        var t = HuaweiTLV()
        t.put(0x01, string: SafetyPayloads.fallWatchPackage)
        t.put(0x02, string: SafetyPayloads.fallPhonePackage)
        t.put(0x83, tlv: list)
        return DataSyncRig.frame(0x01, t)
    }

    // MARK: fall detection

    func testTheGateNamesWhatTheWatchLacks() {
        XCTAssertEqual(Rig(connected: false).safety.fallGate(), "no watch connected")
        XCTAssertEqual(Rig(bits: [84]).safety.fallGate(), "the watch does not report DataSync configs (ExpandCapability 83)")
        XCTAssertEqual(Rig(listsSos: false).safety.fallGate(), "the watch does not list SOS support (service 0x33 command 01)")
        XCTAssertNil(Rig().safety.fallGate())
    }

    func testSettingFallDetectionSendsTheConfigAndStoresTheSwitch() async throws {
        let rig = Rig()
        let sent = try await rig.safety.setFall(true)
        XCTAssertTrue(sent)
        let packet = try XCTUnwrap(rig.data.watch.sent.first)
        XCTAssertEqual(packet.service, 0x37)
        XCTAssertEqual(packet.command, 0x01)
        XCTAssertEqual(try packet.tlv.string(0x01), "hw.unitedevice.sos")
        XCTAssertEqual(try packet.tlv.string(0x02), "hw.watch.sos.help")
        let entry = try packet.tlv.object(0x83).objects(0x84)[0]
        XCTAssertEqual(try entry.int(0x05), 900_500_038)
        XCTAssertEqual(try entry.byte(0x06), 1)
        XCTAssertEqual(String(decoding: try entry.bytes(0x07), as: UTF8.self), "{\"fallDetectionSwitch\":1,\"timeStamp\":\(fixedNowMs)}")
        XCTAssertEqual(try entry.long(0x08), fixedNowMs)
        XCTAssertEqual(rig.settings.fallSwitch, 1)
        XCTAssertEqual(rig.settings.fallUpdatedMs, fixedNowMs)

        _ = try await rig.safety.setFall(false)
        XCTAssertEqual(rig.settings.fallSwitch, 0)
        XCTAssertEqual(String(decoding: try rig.data.watch.sent[1].tlv.object(0x83).objects(0x84)[0].bytes(0x07), as: UTF8.self), "{\"fallDetectionSwitch\":0,\"timeStamp\":\(fixedNowMs)}")
    }

    func testSettingFallDetectionRejectsWhenTheWatchCannotAndLeavesTheSwitch() async {
        let rig = Rig(listsSos: false)
        do {
            _ = try await rig.safety.setFall(true)
            XCTFail("expected an error")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
            XCTAssertEqual(e.message, "Fall detection cannot be changed: the watch does not list SOS support (service 0x33 command 01)")
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertTrue(rig.data.watch.sent.isEmpty)
        XCTAssertEqual(rig.settings.fallSwitch, -1)
    }

    func testAFailedSendDoesNotStoreTheSwitch() async throws {
        // The config bit is set (so the gate passes) but the session is gone after the gate: nothing goes out, nothing is stored.
        let rig = Rig()
        rig.data.source.current = nil
        let sent = try? await rig.safety.setFall(true)
        XCTAssertNil(sent) // gate: no watch connected
        XCTAssertEqual(rig.settings.fallSwitch, -1)
    }

    func testTheQueryIsActionTwoWithoutData() async throws {
        let rig = Rig()
        let sent = try await rig.safety.queryFall()
        XCTAssertTrue(sent)
        let entry = try XCTUnwrap(rig.data.watch.sent.first).tlv.object(0x83).objects(0x84)[0]
        XCTAssertEqual(try entry.byte(0x06), 2)
        XCTAssertFalse(entry.contains(0x07))
    }

    func testTheQueryIsNotSentWhenGated() async throws {
        let rig = Rig(bits: [84])
        let sent = try await rig.safety.queryFall()
        XCTAssertFalse(sent)
        XCTAssertTrue(rig.data.watch.sent.isEmpty)
        XCTAssertTrue(rig.data.events.contains("Fall detection query not sent: the watch does not report DataSync configs"))
    }

    func testTheWatchReportOverwritesTheStoredState() async {
        let rig = Rig()
        await rig.data.attach()
        rig.settings.fallSwitch = 0
        rig.data.watch.session = rig.data.session
        rig.data.session.onData(fallConfigFrame("{\"fallDetectionSwitch\":1,\"timeStamp\":1791979100000}"))
        await eventually { rig.settings.fallSwitch == 1 }
        XCTAssertEqual(rig.settings.fallUpdatedMs, 1_791_979_100_000)
        XCTAssertTrue(rig.data.events.contains("Fall detection: the watch reports ON (action 1, timeStamp 1791979100000)"))
    }

    func testAReportWithoutATimestampUsesNow() async {
        let rig = Rig()
        await rig.data.attach()
        rig.data.session.onData(fallConfigFrame("{\"fallDetectionSwitch\":0}", action: 2))
        await eventually { rig.settings.fallSwitch == 0 }
        XCTAssertEqual(rig.settings.fallUpdatedMs, fixedNowMs)
    }

    func testAnUnreadableReportIsLoggedAndChangesNothing() async {
        let rig = Rig()
        await rig.data.attach()
        rig.data.session.onData(fallConfigFrame("{\"fallDetectionSwitch\":7}"))
        await eventually { rig.data.events.contains("carries no readable fallDetectionSwitch") }
        XCTAssertEqual(rig.settings.fallSwitch, -1)
        rig.data.session.onData(fallConfigFrame(nil))
        await eventually { rig.data.events.logs.filter { $0.message.contains("carries no readable") }.count == 2 }
        XCTAssertEqual(rig.settings.fallSwitch, -1)
    }

    func testConnectingAsksTheWatchWhenSupported() async {
        let rig = Rig()
        await rig.data.attach()
        XCTAssertEqual(rig.data.watch.sent.count, 1)
        XCTAssertTrue(rig.data.events.contains("Fall detection: supported (config 900500038, bit 83, 0x33/01)"))

        let gated = Rig(listsSos: false)
        await gated.data.attach()
        XCTAssertTrue(gated.data.watch.sent.isEmpty)
        XCTAssertTrue(gated.data.events.contains("Fall detection: the watch does not list SOS support"))
    }

    func testTheStatusIsRealForFallAndSleepAndInertForSos() async throws {
        let rig = Rig()
        rig.settings.fallSwitch = 1
        rig.settings.fallUpdatedMs = 1234
        rig.settings.sleepReportEnabled = false
        let status = rig.safety.status()
        XCTAssertEqual(Set(status.keys), Set(Inert.safety().keys))
        XCTAssertEqual(status["fallSupported"] as? Bool, true)
        XCTAssertEqual(status["fallNote"] as? String, "the watch reports fall detection support")
        XCTAssertEqual(status["fallSwitch"] as? Int, 1)
        XCTAssertEqual(status["fallUpdatedMs"] as? Int64, 1234)
        XCTAssertEqual(status["sleepReportEnabled"] as? Bool, false)
        XCTAssertEqual(status["sleepReportSupported"] as? Bool, true)
        for key in ["sosRelayEnabled", "smsSupported", "smsPermission", "telephony", "simReady", "sosReady", "sosListedByWatch"] {
            XCTAssertEqual(status[key] as? Bool, false, key)
        }
        XCTAssertEqual(status["sosBlockers"] as? [String], [Inert.sosBlocker])

        let off = Rig(bits: [], listsSos: false)
        let offStatus = off.safety.status()
        XCTAssertEqual(offStatus["fallSupported"] as? Bool, false)
        XCTAssertEqual(offStatus["fallNote"] as? String, "the watch does not report DataSync configs (ExpandCapability 83)")
        XCTAssertEqual(offStatus["fallSwitch"] as? Int, -1)
        XCTAssertEqual(offStatus["sleepReportEnabled"] as? Bool, true)
        XCTAssertEqual(offStatus["sleepReportSupported"] as? Bool, false)
        XCTAssertEqual(Rig(connected: false).safety.status()["sleepReportSupported"] as? Bool, false)
    }

    func testTheSettingsDefaultsMatchAndroid() {
        let s = WatchExtrasSettings(defaults: ephemeralDefaults())
        XCTAssertEqual(s.fallSwitch, -1)
        XCTAssertEqual(s.fallUpdatedMs, 0)
        XCTAssertTrue(s.sleepReportEnabled)
        XCTAssertEqual(s.sleepReportLastEnd, 0)
        s.sleepReportLastEnd = 1_791_000_000
        s.fallUpdatedMs = 1_791_979_200_000
        XCTAssertEqual(s.sleepReportLastEnd, 1_791_000_000)
        XCTAssertEqual(s.fallUpdatedMs, 1_791_979_200_000)
    }

    // MARK: SOS (never sent, always answered)

    private func sosFrame(_ data: Bytes?) -> Bytes {
        DataSyncRig.eventFrame(src: SafetyPayloads.sosWatchPackage, wear: SafetyPayloads.sosPhonePackage, id: SafetyPayloads.sosEventId, data: data)
    }

    func testAnSosRequestIsAnsweredFailedAndNothingIsSent() async throws {
        let rig = Rig()
        await rig.data.attach()
        let before = rig.data.watch.sent.count
        let raw = "{\"phoneNumber\":\"+6281234567890\",\"content\":\"Help, I fell.\"}"
        rig.data.session.onData(sosFrame(Bytes(raw.utf8)))
        await eventually { rig.data.watch.sent.count > before }
        let answer = try XCTUnwrap(rig.data.watch.sent.last)
        XCTAssertEqual(answer.command, 0x02)
        XCTAssertEqual(try answer.tlv.string(0x01), "hw.unitedevice.safetyguard")
        XCTAssertEqual(try answer.tlv.string(0x02), "hw.watch.safetyguard")
        XCTAssertEqual(try answer.tlv.bytes(0x03), [0x2F, 0xB0, 0x8E, 0xC8])
        XCTAssertEqual(try answer.tlv.bytes(0x04), [0x00])
        XCTAssertEqual(String(decoding: try answer.tlv.bytes(0x05), as: UTF8.self), "{\"phoneNumber\":\"+6281234567890\",\"content\":\"Help, I fell.\",\"status\":\"1\"}")
        XCTAssertTrue(rig.data.events.contains("SOS: the watch asks to send 13 characters to ***********90"))
        XCTAssertTrue(rig.data.events.containsError("SOS: no SMS sent, iOS apps cannot send SMS"))
        XCTAssertFalse(rig.data.events.logs.contains { $0.message.contains("+6281234567890") && !$0.message.contains("DataSync") })
    }

    func testAnUnreadableSosRequestIsStillAnswered() async throws {
        for (data, expected) in [(Bytes("nope".utf8), "{\"status\":\"1\"}"), ([], "{\"status\":\"1\"}"), (Bytes("{\"phoneNumber\":\"1\",\"content\":\"\"}".utf8), "{\"phoneNumber\":\"1\",\"content\":\"\",\"status\":\"1\"}")] as [(Bytes, String)] {
            let rig = Rig()
            await rig.data.attach()
            let before = rig.data.watch.sent.count
            rig.data.session.onData(sosFrame(data))
            await eventually { rig.data.watch.sent.count > before }
            let answer = try XCTUnwrap(rig.data.watch.sent.last)
            XCTAssertEqual(String(decoding: try answer.tlv.bytes(0x05), as: UTF8.self), expected)
            XCTAssertTrue(rig.data.events.containsError("SOS: request refused"))
        }
    }

    // MARK: sleep report

    // Local midnight in Jakarta of 2026-10-14; the night runs 23:00 to 06:30.
    private let midnight: Int64 = 1_791_936_000 - 7 * 3600
    private var nightSegments: [(Int64, Int64, String?)] {
        let m = midnight
        return [(m - 3600, m + 1800, "light"), (m + 1800, m + 5400, "deep"), (m + 5400, m + 10800, "rem"), (m + 10800, m + 22500, "light"), (m + 22500, m + 23400, "awake")]
    }
    private var wake: Int64 { midnight + 23400 }

    func testTheMorningReportGoesOutOnceAfterTheSyncThatHoldsTheNight() async throws {
        let rig = Rig(nowSec: wake + 1800)
        try rig.insertSegments(nightSegments)
        await rig.data.attach()
        rig.data.watch.session = rig.data.session
        let summary = SyncSummary(from: 0, to: wake, samples: 0, sleep: 5, totalSteps: 0, totalCalories: 0, totalDistance: 0)

        await rig.sleep.onSyncComplete(summary)?.value

        let event = try XCTUnwrap(rig.data.watch.sent.last { $0.command == 0x02 })
        XCTAssertEqual(try event.tlv.string(0x01), "hw.unitedevice.sleepnotification")
        XCTAssertEqual(try event.tlv.string(0x02), "hw.watch.health.sleep")
        XCTAssertEqual(try event.tlv.bytes(0x03), [0x04, 0xC5, 0x29, 0x31])
        XCTAssertEqual(try event.tlv.bytes(0x04), [0x00])
        let payload = try HuaweiTLV(parsing: try event.tlv.bytes(0x05))
        XCTAssertEqual(try payload.string(0x06), "Sleep report")
        XCTAssertEqual(try payload.string(0x07), "7 h 30 min asleep, 23:00 to 06:30. Deep 1 h 00 min, REM 1 h 30 min, Light 4 h 45 min.")
        XCTAssertEqual(try payload.string(0x08), "Open app")
        XCTAssertEqual(try payload.string(0x09), "Ignore")
        XCTAssertEqual(try payload.string(0x0A), "id-ID")
        XCTAssertEqual(try payload.string(0x0B), "joyofit://today")
        XCTAssertEqual(try payload.string(0x0C), "joyofit://today")
        XCTAssertEqual(rig.settings.sleepReportLastEnd, wake)

        // The next sync of the same night is not reported again.
        let before = rig.data.watch.sent.count
        await rig.sleep.onSyncComplete(summary)?.value
        XCTAssertEqual(rig.data.watch.sent.count, before)
        XCTAssertTrue(rig.data.events.contains("Sleep report: not sent, already reported"))
    }

    func testASyncWithoutSleepDoesNothing() async throws {
        let rig = Rig(nowSec: wake + 1800)
        try rig.insertSegments(nightSegments)
        XCTAssertNil(rig.sleep.onSyncComplete(SyncSummary(from: 0, to: 1, samples: 5, sleep: 0, totalSteps: 0, totalCalories: 0, totalDistance: 0)))
        XCTAssertTrue(rig.data.watch.sent.isEmpty)
    }

    func testTheSwitchKeepsTheAutomaticReportButNotTheButton() async throws {
        let rig = Rig(nowSec: wake + 1800)
        try rig.insertSegments(nightSegments)
        rig.settings.sleepReportEnabled = false
        let auto = try await rig.sleep.push(force: false)
        XCTAssertEqual(auto, "switched off in settings")
        XCTAssertTrue(rig.data.watch.sent.isEmpty)
        let forced = try await rig.sleep.push(force: true)
        XCTAssertEqual(forced, "sent")
        XCTAssertEqual(rig.data.watch.sent.count, 1)
    }

    func testForceSendsAgainButTheHardwareGatesStay() async throws {
        let rig = Rig(nowSec: wake + 1800)
        try rig.insertSegments(nightSegments)
        let first = try await rig.sleep.push(force: false)
        let second = try await rig.sleep.push(force: true)
        XCTAssertEqual([first, second], ["sent", "sent"])
        XCTAssertEqual(rig.data.watch.sent.count, 2)

        let noEvents = Rig(bits: [83], nowSec: wake + 1800)
        try noEvents.insertSegments(nightSegments)
        let r1 = try await noEvents.sleep.push(force: true)
        XCTAssertEqual(r1, "the watch does not report DataSync events (ExpandCapability 84)")
        let disconnected = Rig(nowSec: wake + 1800, connected: false)
        let r2 = try await disconnected.sleep.push(force: true)
        XCTAssertEqual(r2, "no watch connected")
        XCTAssertTrue(noEvents.data.watch.sent.isEmpty && disconnected.data.watch.sent.isEmpty)
    }

    func testNothingStoredAndTheMorningRules() async throws {
        let empty = Rig(nowSec: wake + 1800)
        let none = try await empty.sleep.push(force: true)
        XCTAssertEqual(none, "no sleep stored in the last 36 h")

        let late = Rig(nowSec: wake + 9 * 3600)
        try late.insertSegments(nightSegments)
        let tooLate = try await late.sleep.push(force: false)
        XCTAssertEqual(tooLate, "ended 9 h ago, too late for a morning report")
        let forced = try await late.sleep.push(force: true)
        XCTAssertEqual(forced, "sent")
        XCTAssertEqual(late.settings.sleepReportLastEnd, wake)

        let nap = Rig(nowSec: wake + 5 * 3600 + 60)
        try nap.insertSegments([(wake + 4 * 3600, wake + 5 * 3600, "light")])
        let napReason = try await nap.sleep.push(force: false)
        XCTAssertEqual(napReason, "only 60 min of sleep, a nap")
        XCTAssertEqual(nap.settings.sleepReportLastEnd, 0)
    }

    func testAFailedSendDoesNotMarkTheNightReported() async throws {
        let rig = Rig(nowSec: wake + 1800)
        try rig.insertSegments(nightSegments)
        // The link drops between the gates (connected(), supports()) and the write: the DataSync send reports false.
        final class Dropping: LinkHandleSource, @unchecked Sendable {
            let inner: RigSource
            var calls = 0
            init(_ inner: RigSource) { self.inner = inner }
            func handle() -> LinkHandle? { calls += 1; return calls > 2 ? nil : inner.current }
        }
        let dropping = Dropping(rig.data.source)
        let service = DataSyncService(link: dropping, events: rig.data.events, connectDelayMs: 0)
        let feature = SleepReportFeature(
            settings: rig.settings, syncStore: rig.store, events: rig.data.events,
            zone: { TimeZone(identifier: "Asia/Jakarta")! }, locale: { ("en", "US") }, now: { Date(timeIntervalSince1970: TimeInterval(self.wake + 1800)) }
        )
        service.register(feature)
        let result = try await feature.push(force: true)
        XCTAssertEqual(result, "the send failed, see the lines above")
        XCTAssertEqual(rig.settings.sleepReportLastEnd, 0)
    }

    func testTheWatchAnswerIsLogged() async {
        let rig = Rig()
        await rig.data.attach()
        rig.data.session.onData(DataSyncRig.eventFrame(src: SleepReport.watchPackage, wear: SleepReport.phonePackage, id: SleepReport.eventId, data: [0x01]))
        await eventually { rig.data.events.contains("Sleep report: the watch answers shown") }
        rig.data.session.onData(DataSyncRig.eventFrame(src: SleepReport.watchPackage, wear: SleepReport.phonePackage, id: SleepReport.eventId, data: [0x02]))
        await eventually { rig.data.events.contains("Sleep report: the watch answers NOT shown") }
    }

    func testOnlyTheNewestSessionWithinTheLookbackIsReported() async throws {
        // Yesterday's night is stored too (older than 36 h is ignored by the query, an earlier one inside it is chained only within 3 h).
        let rig = Rig(nowSec: wake + 1800)
        try rig.insertSegments([(wake - 30 * 3600, wake - 22 * 3600, "light")] + nightSegments)
        let result = try await rig.sleep.push(force: false)
        XCTAssertEqual(result, "sent")
        let payload = try HuaweiTLV(parsing: try XCTUnwrap(rig.data.watch.sent.last).tlv.bytes(0x05))
        XCTAssertTrue(try payload.string(0x07).hasPrefix("7 h 30 min asleep, 23:00 to 06:30."))
    }
}

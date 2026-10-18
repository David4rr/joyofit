import XCTest
@testable import HuaweiWearLogic

/// The watch side over a real `HuaweiSession` without encryption: reassembles what the phone writes, records it and answers through
/// `session.onData`.
final class ScriptedWatch: FrameSink, @unchecked Sendable {
    struct Request {
        let service: UInt8
        let command: UInt8
        let tlv: HuaweiTLV
    }

    private let lock = NSLock()
    private var assembler = PacketAssembler()
    private var _requests: [Request] = []
    private(set) var session: HuaweiSession!
    var responder: (Request) -> [Bytes] = { _ in [] }

    var requests: [Request] { lock.locked { _requests } }

    func makeHandle(caps: DeviceCaps) -> LinkHandle {
        let session = HuaweiSession(sink: self, log: { _ in })
        session.params.transactionsCrypted = false
        self.session = session
        return LinkHandle(address: "A", session: session, caps: caps, operationLock: AsyncLock())
    }

    func write(_ frames: [Bytes]) async throws {
        for f in frames {
            var local = lock.locked { assembler }
            guard let packet = try local.feed(f, params: session.params).packet else {
                lock.locked { assembler = local }
                continue
            }
            lock.locked { assembler = local }
            let request = Request(service: packet.serviceId, command: packet.commandId, tlv: packet.tlv ?? HuaweiTLV())
            lock.locked { _requests.append(request) }
            for response in responder(request) { session.onData(response) }
        }
    }

    static func tlvFrame(service: UInt8, command: UInt8, _ tlv: HuaweiTLV) -> Bytes {
        var buffer = Bytes([huaweiMagic])
        let body = tlv.serialize()
        buffer.appendBE(UInt16(2 + body.count + 1))
        buffer.append(0x00)
        buffer.append(service)
        buffer.append(command)
        buffer += body
        buffer.appendBE(CRC16.checksum(buffer))
        return buffer
    }
}

final class WatchSettingsTests: XCTestCase {
    private var events: RecordingEvents!
    private var settings: WearSettings!
    private var watch: ScriptedWatch!
    private var handle: LinkHandle?
    private var syncStore: SyncStore!

    override func setUp() {
        syncStore = SyncStore(url: temporaryDatabaseURL())
        events = RecordingEvents()
        settings = WearSettings(defaults: ephemeralDefaults())
        watch = ScriptedWatch()
        handle = nil
    }

    private func features(connected caps: DeviceCaps? = nil) -> WatchSettingsFeatures {
        if let caps { handle = watch.makeHandle(caps: caps) }
        let current = handle
        return WatchSettingsFeatures(handle: { current }, settings: settings, syncStore: syncStore, events: events)
    }

    private func alarmCaps() -> DeviceCaps {
        let caps = DeviceCaps()
        caps.supportedCommands = [0x08: [0x01, 0x02, 0x03, 0x04]]
        return caps
    }

    // MARK: alarms

    func testAlarmsAreEmptyAndUnsupportedBeforeAnyWatch() {
        let js = features().cachedAlarms()
        XCTAssertEqual((js["event"] as? [Any])?.count, 0)
        XCTAssertTrue(js["smart"] is NSNull)
        XCTAssertTrue(js["updatedAt"] is NSNull)
        XCTAssertEqual(js["supported"] as? Bool, false)
        XCTAssertEqual(js["smartSupported"] as? Bool, false)
    }

    func testRefreshNeedsAConnectedWatch() async {
        do {
            _ = try await features().refreshAlarms()
            XCTFail("nothing is connected")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .notConnected)
        } catch { XCTFail("\(error)") }
    }

    func testSetAlarmsValidatesBeforeLookingForAWatch() async {
        let bad = WatchAlarms(event: [WatchAlarm(slot: 9, enabled: true, hour: 1, minute: 1, repeatMask: 0, name: "")], smart: nil, updatedAtMs: nil)
        do {
            _ = try await features().setAlarms(bad)
            XCTFail("accepted slot 9")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .invalidArgument)
        } catch { XCTFail("\(error)") }
    }

    private func slot(_ index: UInt8, _ time: Int16, name: String) -> HuaweiTLV {
        var t = HuaweiTLV()
        t.put(0x03, byte: index)
        t.put(0x04, bool: true)
        t.put(0x05, short: time)
        t.put(0x06, byte: 0x1F)
        t.put(0x07, string: name)
        return t
    }

    func testRefreshKeepsWhatTheWatchHoldsAndGetAlarmsReturnsItLater() async throws {
        watch.responder = { r in
            guard r.service == 0x08 else { return [] }
            if r.command == 0x03 {
                var list = HuaweiTLV()
                list.put(0x82, tlv: self.slot(2, 0x071E, name: "Work"))
                var tlv = HuaweiTLV()
                tlv.put(0x81, tlv: list)
                return [ScriptedWatch.tlvFrame(service: 0x08, command: 0x03, tlv)]
            }
            var tlv = HuaweiTLV()
            tlv.put(0x81, tlv: HuaweiTLV())
            return [ScriptedWatch.tlvFrame(service: 0x08, command: 0x04, tlv)]
        }
        let f = features(connected: alarmCaps())
        let js = try await f.refreshAlarms()
        XCTAssertEqual(js["supported"] as? Bool, true)
        XCTAssertEqual(js["smartSupported"] as? Bool, true)
        let event = js["event"] as! [[String: Any]]
        XCTAssertEqual(event.count, 1)
        XCTAssertEqual(event[0]["slot"] as? Int, 2)
        XCTAssertEqual(event[0]["hour"] as? Int, 7)
        XCTAssertEqual(event[0]["minute"] as? Int, 30)
        XCTAssertEqual(event[0]["repeat"] as? Int, 31)
        XCTAssertEqual(event[0]["name"] as? String, "Work")
        XCTAssertTrue(js["smart"] is NSNull)
        XCTAssertNotNil(js["updatedAt"] as? Int64)
        XCTAssertNotNil(settings.alarmsJson)

        // A later app start reads the stored list without a watch.
        let offline = WatchSettingsFeatures(handle: { nil }, settings: settings, syncStore: syncStore, events: events).cachedAlarms()
        XCTAssertEqual((offline["event"] as! [[String: Any]]).count, 1)
        XCTAssertEqual(offline["supported"] as? Bool, false, "nothing is known about the watch while disconnected")
    }

    func testSetAlarmsPushesThenReadsBack() async throws {
        var stored: [HuaweiTLV] = []
        watch.responder = { r in
            guard r.service == 0x08 else { return [] }
            switch r.command {
            case 0x01:
                stored = (try? r.tlv.object(0x81).objects(0x82)) ?? []
                return [ScriptedWatch.tlvFrame(service: 0x08, command: 0x01, HuaweiTLV())]
            case 0x02:
                return [ScriptedWatch.tlvFrame(service: 0x08, command: 0x02, HuaweiTLV())]
            case 0x03:
                var list = HuaweiTLV()
                for s in stored { list.put(0x82, tlv: s) }
                var tlv = HuaweiTLV()
                tlv.put(0x81, tlv: list)
                return [ScriptedWatch.tlvFrame(service: 0x08, command: 0x03, tlv)]
            default:
                return [ScriptedWatch.tlvFrame(service: 0x08, command: 0x04, { var t = HuaweiTLV(); t.put(0x81, tlv: HuaweiTLV()); return t }())]
            }
        }
        let f = features(connected: alarmCaps())
        let alarms = try WatchAlarms.fromJS([
            "event": [["slot": 1, "enabled": true, "hour": 6, "minute": 45, "repeat": 31, "name": "Run"] as [String: Any]]
        ])
        let js = try await f.setAlarms(alarms)
        XCTAssertEqual(watch.requests.map(\.command), [0x01, 0x03, 0x04])
        let event = js["event"] as! [[String: Any]]
        XCTAssertEqual(event.first?["name"] as? String, "Run")
        XCTAssertEqual(event.first?["hour"] as? Int, 6)
        XCTAssertEqual(event.first?["minute"] as? Int, 45)
    }

    func testFromJSTakesTheRecordDefaultsAndRejectsMistypedFields() throws {
        let empty = try WatchAlarms.fromJS([:])
        XCTAssertEqual(empty, .empty)
        let smart = try WatchAlarms.fromJS(["event": [], "smart": ["enabled": true, "hour": 6.0]])
        XCTAssertEqual(smart.smart, WatchSmartAlarm(enabled: true, hour: 6, minute: 0, repeatMask: 0, aheadMinutes: 5))
        XCTAssertEqual(try WatchAlarms.fromJS(["event": [["hour": 7]]]).event, [WatchAlarm(slot: 1, enabled: false, hour: 7, minute: 0, repeatMask: 0, name: "")])
        for bad: [String: Any] in [["event": "x"], ["event": [["hour": "7"]]], ["event": [["enabled": 1]]], ["smart": 5], ["event": [["hour": 7.5]]]] {
            XCTAssertThrowsError(try WatchAlarms.fromJS(bad)) { XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument) }
        }
    }

    // MARK: health sensors

    private func sensorCaps() -> DeviceCaps {
        let caps = DeviceCaps()
        caps.supportedCommands = [0x07: [0x16, 0x17, 0x1C, 0x1D, 0x22, 0x23, 0x24], 0x17: [0x17], 0x19: [0x01]]
        return caps
    }

    private func ackEverything() {
        watch.responder = { r in [ScriptedWatch.tlvFrame(service: r.service, command: r.command, HuaweiTLV())] }
    }

    func testHealthSensorsStatusIsTheSavedConfigAndSupportIsNullUntilAWatchIsConnected() {
        let js = features().healthSensorsStatus()
        XCTAssertEqual(js["automaticHeartRate"] as? Bool, true)
        XCTAssertEqual(js["automaticSpo2"] as? Bool, true)
        XCTAssertEqual(js["truSleep"] as? Bool, true)
        XCTAssertEqual(js["highHeartRateAlert"] as? Int, 0)
        XCTAssertEqual(js["lowHeartRateAlert"] as? Int, 0)
        XCTAssertTrue(js["supported"] is NSNull)
        XCTAssertEqual(Set(js.keys), ["automaticHeartRate", "automaticSpo2", "truSleep", "highHeartRateAlert", "lowHeartRateAlert", "supported"], "same shape as HealthSensorsStatus")
    }

    func testSupportListsWhatTheConnectedWatchHas() {
        let supported = features(connected: sensorCaps()).healthSensorsStatus()["supported"] as? [String: Any]
        XCTAssertEqual(supported?["heartRate"] as? Bool, true)
        XCTAssertEqual(supported?["realtimeHeartRate"] as? Bool, true)
        XCTAssertEqual(supported?["spo2"] as? Bool, true)
        XCTAssertEqual(supported?["highHeartRateAlert"] as? Bool, true)
    }

    func testSettingsStoredWhileDisconnectedAreKeptAndReportedAsNotSent() async throws {
        let f = features()
        let sent = try await f.setHealthSensors(HealthSensorConfig(automaticHeartRate: false, automaticSpo2: true, truSleep: false, highHeartRateAlert: 140, lowHeartRateAlert: 45))
        XCTAssertFalse(sent, "nothing reached a watch")
        XCTAssertEqual(settings.healthSensors, HealthSensorConfig(automaticHeartRate: false, automaticSpo2: true, truSleep: false, highHeartRateAlert: 140, lowHeartRateAlert: 45))
        XCTAssertEqual(f.healthSensorsStatus()["automaticHeartRate"] as? Bool, false)
    }

    func testAnInvalidAlertIsRejectedAndNothingIsStored() async {
        for bad in [HealthSensorConfig(highHeartRateAlert: 99), HealthSensorConfig(highHeartRateAlert: 151), HealthSensorConfig(lowHeartRateAlert: 39), HealthSensorConfig(lowHeartRateAlert: 51)] {
            do {
                _ = try await features().setHealthSensors(bad)
                XCTFail("accepted \(bad)")
            } catch let e as WearError {
                XCTAssertEqual(e.code, .invalidArgument)
            } catch { XCTFail("\(error)") }
        }
        XCTAssertEqual(settings.healthSensors, HealthSensorConfig())
    }

    func testChangingASwitchSendsOnlyThatSwitchAndReportsAcknowledgment() async throws {
        ackEverything()
        let f = features(connected: sensorCaps())
        let sent = try await f.setHealthSensors(HealthSensorConfig(automaticHeartRate: false))
        XCTAssertTrue(sent)
        XCTAssertEqual(watch.requests.map { "\($0.service)/\($0.command)" }, ["7/23"])
        XCTAssertEqual(try watch.requests[0].tlv.bool(0x01), false)
        // Nothing changed: nothing is sent, and that counts as acknowledged.
        let again = try await f.setHealthSensors(HealthSensorConfig(automaticHeartRate: false))
        XCTAssertTrue(again)
        XCTAssertEqual(watch.requests.count, 1)
    }

    func testAnUnansweredSwitchIsNotAcknowledged() async throws {
        let f = features(connected: sensorCaps())
        let sent = try await f.setHealthSensors(HealthSensorConfig(automaticSpo2: false))
        XCTAssertFalse(sent)
        XCTAssertEqual(watch.requests.map(\.command), [0x24])
    }

    func testHealthSensorsFromJSTakesTheRecordDefaultsAndRejectsMistypedFields() throws {
        XCTAssertEqual(try HealthSensorConfig.fromJS([:]), HealthSensorConfig())
        XCTAssertEqual(
            try HealthSensorConfig.fromJS(["automaticHeartRate": false, "highHeartRateAlert": 120.0, "lowHeartRateAlert": 45]),
            HealthSensorConfig(automaticHeartRate: false, highHeartRateAlert: 120, lowHeartRateAlert: 45)
        )
        for bad: [String: Any] in [["automaticSpo2": "yes"], ["truSleep": 1], ["highHeartRateAlert": "120"], ["lowHeartRateAlert": 45.5]] {
            XCTAssertThrowsError(try HealthSensorConfig.fromJS(bad)) { XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument) }
        }
    }

    // MARK: live heart rate

    private func packetsFor(_ service: UInt8, _ command: UInt8) -> [ScriptedWatch.Request] { watch.requests.filter { $0.service == service && $0.command == command } }

    func testLiveHeartRateOpensTheReportAndRealtimeThenRestoresTheSavedBaseline() async throws {
        ackEverything()
        settings.healthSensors = HealthSensorConfig(automaticHeartRate: false)
        let f = features(connected: sensorCaps())
        await f.linkConnected(handle!)
        f.liveHeartRate.setActive(true)
        await eventually("realtime on") { self.packetsFor(0x07, 0x1C).count == 1 }
        let open = try XCTUnwrap(packetsFor(0x19, 0x01).first)
        XCTAssertEqual(try open.tlv.byte(0x01), 1)
        XCTAssertEqual(try open.tlv.byte(0x02), 2)
        XCTAssertEqual(try packetsFor(0x07, 0x1C)[0].tlv.bool(0x01), true)

        // Asking again for the same session sends nothing more.
        f.liveHeartRate.setActive(true)
        await sleepMs(100)
        XCTAssertEqual(packetsFor(0x07, 0x1C).count, 1)

        f.liveHeartRate.setActive(false)
        await eventually("report closed and baseline restored") { self.packetsFor(0x07, 0x17).count == 1 }
        XCTAssertEqual(try packetsFor(0x19, 0x01).last?.tlv.byte(0x01), 2)
        XCTAssertEqual(try packetsFor(0x07, 0x1C).last?.tlv.bool(0x01), false)
        XCTAssertEqual(try packetsFor(0x07, 0x17)[0].tlv.bool(0x01), false, "the user's saved automatic heart rate, not a default")
    }

    func testPushedReadingsBecomeHeartRateEvents() async throws {
        let f = features(connected: sensorCaps())
        await f.linkConnected(handle!)
        // 19/03: 81{82{03 bpm, 04 time, 05 credibility}}
        func notice(_ bpm: UInt8) -> Bytes {
            var inner = HuaweiTLV()
            inner.put(0x03, byte: bpm)
            inner.put(0x04, int: 1)
            inner.put(0x05, byte: 100)
            var outer = HuaweiTLV()
            outer.put(0x82, tlv: inner)
            var tlv = HuaweiTLV()
            tlv.put(0x81, tlv: outer)
            return ScriptedWatch.tlvFrame(service: 0x19, command: 0x03, tlv)
        }
        handle!.session.onData(notice(72))
        handle!.session.onData(notice(10))  // out of range: dropped
        var realtime = HuaweiTLV()
        realtime.put(0x02, byte: 81)
        handle!.session.onData(ScriptedWatch.tlvFrame(service: 0x07, command: 0x1C, realtime))
        await eventually("two readings") { self.events.heartRates.count == 2 }
        XCTAssertEqual(events.heartRates.map(\.bpm), [72, 81])
        XCTAssertTrue(events.heartRates.allSatisfy { $0.tsMs > 1_700_000_000_000 })
    }

    func testPauseTurnsTheReadingsOffAndResumePutsThemBack() async throws {
        ackEverything()
        let f = features(connected: sensorCaps())
        await f.linkConnected(handle!)
        f.liveHeartRate.setActive(true)
        await eventually("on") { self.packetsFor(0x07, 0x1C).count == 1 }
        await f.liveHeartRate.pause()
        XCTAssertEqual(packetsFor(0x07, 0x1C).count, 2)
        XCTAssertEqual(try packetsFor(0x07, 0x1C).last?.tlv.bool(0x01), false)
        f.liveHeartRate.resume()
        await eventually("on again") { self.packetsFor(0x07, 0x1C).count == 3 }
        XCTAssertEqual(try packetsFor(0x07, 0x1C).last?.tlv.bool(0x01), true)
        XCTAssertFalse(f.liveHeartRate.workoutActive)
        f.liveHeartRate.setWorkoutActive(true)
        XCTAssertTrue(f.liveHeartRate.workoutActive)
    }

    func testAWatchWithoutRealtimeSupportOnlyOpensTheReport() async throws {
        ackEverything()
        let caps = DeviceCaps()
        caps.supportedCommands = [0x19: [0x01]]
        let f = features(connected: caps)
        await f.linkConnected(handle!)
        f.liveHeartRate.setActive(true)
        await eventually("report opened") { self.packetsFor(0x19, 0x01).count == 1 }
        await sleepMs(100)
        XCTAssertTrue(packetsFor(0x07, 0x1C).isEmpty)
        f.liveHeartRate.setActive(false)
        await eventually("report closed") { self.packetsFor(0x19, 0x01).count == 2 }
        XCTAssertEqual(try packetsFor(0x19, 0x01)[1].tlv.byte(0x01), 2)
    }

    func testNothingHappensWithoutAConnectedWatch() async {
        let f = features()
        f.liveHeartRate.setActive(true)
        f.liveHeartRate.setActive(false)
        await sleepMs(50)
        XCTAssertTrue(events.logs.isEmpty)
    }
}

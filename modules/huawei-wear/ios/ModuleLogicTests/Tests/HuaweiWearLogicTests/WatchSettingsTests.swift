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

    override func setUp() {
        events = RecordingEvents()
        settings = WearSettings(defaults: ephemeralDefaults())
        watch = ScriptedWatch()
        handle = nil
    }

    private func features(connected caps: DeviceCaps? = nil) -> WatchSettingsFeatures {
        if let caps { handle = watch.makeHandle(caps: caps) }
        let current = handle
        return WatchSettingsFeatures(handle: { current }, settings: settings, events: events)
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
        let offline = WatchSettingsFeatures(handle: { nil }, settings: settings, events: events).cachedAlarms()
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
}

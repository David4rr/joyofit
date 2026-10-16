import XCTest
@testable import HuaweiProtocol

/// The Alarms packets against the real Java (Fixtures/packetsAlarms.json), then `AlarmSync` over a real session and a scripted watch,
/// with the cases of Kotlin PhoneFeaturesTest (validation, JSON, capability gates, the empty list).
final class AlarmsTests: XCTestCase {
    let g = try! Golden.load("packetsAlarms")

    private func event(_ o: [String: Any]) -> Alarms.EventAlarm {
        Alarms.EventAlarm(
            index: Int8(truncatingIfNeeded: o.int("index")), status: o.bool("status"), startHour: Int8(truncatingIfNeeded: o.int("startHour")),
            startMinute: Int8(truncatingIfNeeded: o.int("startMinute")), repeatMask: Int8(truncatingIfNeeded: o.int("repeat")), name: o.str("name")
        )
    }

    private func smart(_ o: [String: Any]) -> Alarms.SmartAlarm {
        var a = Alarms.SmartAlarm(
            status: o.bool("status"), startHour: Int8(truncatingIfNeeded: o.int("startHour")), startMinute: Int8(truncatingIfNeeded: o.int("startMinute")),
            repeatMask: Int8(truncatingIfNeeded: o.int("repeat")), aheadTime: Int8(truncatingIfNeeded: o.int("aheadTime"))
        )
        a.index = Int8(truncatingIfNeeded: o.int("index"))
        return a
    }

    private func assertRequest(_ packet: HuaweiPacket, _ c: [String: Any]) throws {
        let name = c.str("name")
        XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name)
        XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name)
        XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name)
        XCTAssertEqual(packet.isSliced, c.bool("sliced"), name)
        XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), name)
        XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], name)
    }

    func testRequestsMatchJava() throws {
        let requests = g.list("requests")
        XCTAssertEqual(requests.count, 10)
        for c in requests {
            let name = c.str("name")
            switch name {
            case _ where name.hasPrefix("event list"): try assertRequest(Alarms.EventAlarmsList.request(), c)
            case _ where name.hasPrefix("smart list"): try assertRequest(Alarms.SmartAlarmList.request(), c)
            case _ where name.hasPrefix("event"):
                try assertRequest(Alarms.EventAlarmsRequest.request(alarms: c.list("alarms").map(event)), c)
            case _ where name.hasPrefix("smart"):
                try assertRequest(Alarms.SmartAlarmRequest.request(smart((c["alarm"] as? [String: Any]) ?? [:])), c)
            default: XCTFail("unknown request \(name)")
            }
        }
    }

    private func check<R: PacketResponse>(_ cases: [[String: Any]], _ type: R.Type, minimumFailures: Int, fields: (R, [String: Any], String) -> Void) throws {
        var failures = 0
        for c in cases {
            let name = c.str("name")
            let packet = try PacketsKit.tlvPacket(c.int("service"), c.int("command"), c.str("tlv"))
            do {
                let r = try R(packet: packet)
                guard c.bool("ok") else {
                    XCTFail("\(name): Java failed with \(c.str("exception")) but Swift parsed")
                    continue
                }
                fields(r, (c["fields"] as? [String: Any]) ?? [:], name)
            } catch {
                guard !c.bool("ok") else {
                    XCTFail("\(name): Java parsed but Swift failed with \(error)")
                    continue
                }
                failures += 1
                let (swiftName, swiftParse) = PacketsKit.exceptionClass(error)
                XCTAssertEqual(swiftParse, c.bool("parseException"), "\(name): Java \(c.str("exception")), Swift \(swiftName)")
                if c.bool("parseException") { XCTAssertEqual(swiftName, c.str("exception"), name) }
            }
        }
        XCTAssertGreaterThanOrEqual(failures, minimumFailures)
    }

    func testEventListResponsesMatchJava() throws {
        let cases = g.list("eventResponses")
        XCTAssertEqual(cases.count, 13)
        try check(cases, Alarms.EventAlarmsList.Response.self, minimumFailures: 5) { r, f, name in
            XCTAssertEqual(r.eventAlarms, f.list("eventAlarms").map(self.event), name)
        }
    }

    func testSmartListResponsesMatchJava() throws {
        let cases = g.list("smartResponses")
        XCTAssertEqual(cases.count, 7)
        try check(cases, Alarms.SmartAlarmList.Response.self, minimumFailures: 3) { r, f, name in
            if let expected = f["smartAlarm"] as? [String: Any] {
                XCTAssertEqual(r.smartAlarm, self.smart(expected), name)
            } else {
                XCTAssertNil(r.smartAlarm, name)
            }
        }
    }

    // MARK: PhoneFeaturesTest translations

    func testEmptyEventAlarmListClearsWithABareIndexOne() throws {
        let packet = Alarms.EventAlarmsRequest.request(alarms: [])
        XCTAssertEqual(packet.tlv!.serialize().hexLower, "81058203030101")
        XCTAssertTrue(try PacketsKit.frames(packet)[0].hasPrefix("5a000a00080181058203030101"))
    }

    func testAlarmsRoundTripThroughJson() {
        let alarms = WatchAlarms(
            event: [WatchAlarm(slot: 1, enabled: true, hour: 7, minute: 30, repeatMask: 0b0011111, name: "Work"), WatchAlarm(slot: 3, enabled: false, hour: 23, minute: 5, repeatMask: 0, name: "")],
            smart: WatchSmartAlarm(enabled: true, hour: 6, minute: 45, repeatMask: 127, aheadMinutes: 10),
            updatedAtMs: 1_700_000_000_000
        )
        XCTAssertEqual(WatchAlarms.fromJson(alarms.toJson()), alarms)
        XCTAssertEqual(WatchAlarms.fromJson(nil), .empty)
        XCTAssertEqual(WatchAlarms.fromJson("not json"), .empty)
        XCTAssertEqual(WatchAlarms.fromJson("{\"event\":[{\"slot\":1}]}"), .empty)
        XCTAssertNil(WatchAlarms.fromJson(WatchAlarms(event: [], smart: nil, updatedAtMs: nil).toJson()).smart)
    }

    func testJsFormMatchesTheContract() {
        let alarms = WatchAlarms(
            event: [WatchAlarm(slot: 2, enabled: true, hour: 7, minute: 5, repeatMask: 3, name: "A")],
            smart: WatchSmartAlarm(enabled: false, hour: 6, minute: 0, repeatMask: 0, aheadMinutes: 5), updatedAtMs: 42
        )
        let js = alarms.toJS(supported: true, smartSupported: false)
        XCTAssertEqual(Set(js.keys), ["event", "smart", "updatedAt", "supported", "smartSupported"])
        XCTAssertEqual(PacketsKit.canonical(js["event"]!), PacketsKit.canonical([["slot": 2, "enabled": true, "hour": 7, "minute": 5, "repeat": 3, "name": "A"] as [String: Any]]))
        XCTAssertEqual(PacketsKit.canonical(js["smart"]!), PacketsKit.canonical(["enabled": false, "hour": 6, "minute": 0, "repeat": 0, "aheadMinutes": 5] as [String: Any]))
        XCTAssertEqual(js["updatedAt"] as? Int64, 42)
        XCTAssertEqual(js["supported"] as? Bool, true)
        XCTAssertEqual(js["smartSupported"] as? Bool, false)
        let empty = WatchAlarms.empty.toJS(supported: false, smartSupported: false)
        XCTAssertTrue(empty["smart"] is NSNull)
        XCTAssertTrue(empty["updatedAt"] is NSNull)
    }

    private func rejected(_ alarms: WatchAlarms, line: UInt = #line) {
        XCTAssertThrowsError(try AlarmSync.validate(alarms), line: line) { error in
            XCTAssertEqual((error as? WearError)?.code, .invalidArgument, line: line)
        }
    }

    func testValidateEnforcesSlotsAndRanges() throws {
        let ok = WatchAlarm(slot: 1, enabled: true, hour: 7, minute: 30, repeatMask: 1, name: "A")
        func with(_ change: (inout WatchAlarm) -> Void) -> WatchAlarm {
            var copy = ok
            change(&copy)
            return copy
        }
        try AlarmSync.validate(WatchAlarms(event: [ok], smart: WatchSmartAlarm(enabled: false, hour: 6, minute: 0, repeatMask: 0, aheadMinutes: 5), updatedAtMs: nil))
        rejected(WatchAlarms(event: [ok, ok], smart: nil, updatedAtMs: nil))
        rejected(WatchAlarms(event: [with { $0.slot = 0 }], smart: nil, updatedAtMs: nil))
        rejected(WatchAlarms(event: [with { $0.slot = 6 }], smart: nil, updatedAtMs: nil))
        rejected(WatchAlarms(event: [with { $0.hour = 24 }], smart: nil, updatedAtMs: nil))
        rejected(WatchAlarms(event: [with { $0.minute = 60 }], smart: nil, updatedAtMs: nil))
        rejected(WatchAlarms(event: [with { $0.repeatMask = 128 }], smart: nil, updatedAtMs: nil))
        rejected(WatchAlarms(event: [with { $0.name = String(repeating: "x", count: 65) }], smart: nil, updatedAtMs: nil))
        rejected(WatchAlarms(event: (1...6).map { slot in with { $0.slot = slot } }, smart: nil, updatedAtMs: nil))
        rejected(WatchAlarms(event: [], smart: WatchSmartAlarm(enabled: true, hour: 25, minute: 0, repeatMask: 0, aheadMinutes: 5), updatedAtMs: nil))
        rejected(WatchAlarms(event: [], smart: WatchSmartAlarm(enabled: true, hour: 6, minute: 0, repeatMask: 0, aheadMinutes: 128), updatedAtMs: nil))
    }

    func testCapabilitiesComeFromSupportedCommands() {
        let caps = DeviceCaps()
        XCTAssertFalse(AlarmSync.supported(caps))
        caps.supportedCommands = [0x08: [0x01, 0x03]]
        XCTAssertTrue(AlarmSync.supported(caps))
        XCTAssertFalse(AlarmSync.smartSupported(caps))
        caps.supportedCommands = [0x08: [0x01, 0x02, 0x03, 0x04]]
        XCTAssertTrue(AlarmSync.smartSupported(caps))
        caps.supportedCommands = [0x08: [0x02]]
        XCTAssertFalse(AlarmSync.smartSupported(caps), "a smart alarm without the change command is not usable")
    }

    // MARK: AlarmSync over a scripted watch

    private func capsWithAlarms(smart: Bool = true) -> DeviceCaps {
        let caps = DeviceCaps()
        caps.supportedCommands = [0x08: smart ? [0x01, 0x02, 0x03, 0x04] : [0x01, 0x03]]
        return caps
    }

    private func slotTlv(_ index: Int, status: Bool?, time: Int?, repeatMask: Int?, name: String?) -> HuaweiTLV {
        var t = HuaweiTLV()
        t.put(0x03, byte: UInt8(index))
        if let status { t.put(0x04, bool: status) }
        if let time { t.put(0x05, short: Int16(truncatingIfNeeded: time)) }
        if let repeatMask { t.put(0x06, byte: UInt8(repeatMask)) }
        if let name { t.put(0x07, string: name) }
        return t
    }

    private func listReply(_ slots: [HuaweiTLV]) -> Bytes {
        var list = HuaweiTLV()
        for s in slots { list.put(0x82, tlv: s) }
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: list)
        return SleepFilesFakeWatch.tlvFrame(service: 0x08, command: 0x03, tlv)
    }

    private func smartReply(_ alarm: HuaweiTLV?) -> Bytes {
        var inner = HuaweiTLV()
        if let alarm { inner.put(0x82, tlv: alarm) }
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: inner)
        return SleepFilesFakeWatch.tlvFrame(service: 0x08, command: 0x04, tlv)
    }

    func testReadSkipsEmptySlotsSortsAndReadsSmart() async throws {
        let h = SleepFilesHarness()
        h.watch.responder = { r in
            guard r.service == 0x08 else { return [] }
            switch r.command {
            case 0x03:
                return [self.listReply([
                    self.slotTlv(3, status: false, time: 0x1702, repeatMask: 0, name: ""),
                    self.slotTlv(1, status: true, time: 0x071E, repeatMask: 0x1F, name: "Work"),
                    self.slotTlv(2, status: nil, time: nil, repeatMask: nil, name: nil),  // empty slot: no time
                    self.slotTlv(9, status: true, time: 0x0800, repeatMask: 0, name: "Out"),  // not a slot of the band
                    self.slotTlv(5, status: true, time: 0x17C8, repeatMask: 0xFF, name: "High"),  // minute 200 reads unsigned
                ])]
            case 0x04:
                return [self.smartReply(self.slotTlv(1, status: true, time: 0x062D, repeatMask: 0x7F, name: nil).withAhead(10))]
            default: return []
            }
        }
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let alarms = try await AlarmSync.read(session: h.session, caps: capsWithAlarms(), log: h.log.sink, now: now)
        XCTAssertEqual(alarms.event.map(\.slot), [1, 3, 5])
        XCTAssertEqual(alarms.event[0], WatchAlarm(slot: 1, enabled: true, hour: 7, minute: 30, repeatMask: 31, name: "Work"))
        XCTAssertEqual(alarms.event[2].minute, 200)
        XCTAssertEqual(alarms.event[2].repeatMask, 255)
        XCTAssertEqual(alarms.smart, WatchSmartAlarm(enabled: true, hour: 6, minute: 45, repeatMask: 127, aheadMinutes: 10))
        XCTAssertEqual(alarms.updatedAtMs, 1_700_000_000_000)
        XCTAssertTrue(h.log.contains("EventAlarmList: skipped EventAlarm{index=2"))
        XCTAssertTrue(h.log.contains("EventAlarmList: skipped EventAlarm{index=9"))
        XCTAssertTrue(h.log.contains("EventAlarmList: 3 alarm(s) #1 07:30, #3 23:02, #5 23:200"))
        XCTAssertTrue(h.log.contains("SmartAlarmList: 06:45 enabled=true"))
        XCTAssertEqual(h.watch.count(0x08, 0x03), 1)
        XCTAssertEqual(h.watch.count(0x08, 0x04), 1)
    }

    func testReadWithoutSmartSupportNeverAsksForIt() async throws {
        let h = SleepFilesHarness()
        h.watch.responder = { r in r.service == 0x08 && r.command == 0x03 ? [self.listReply([])] : [] }
        let alarms = try await AlarmSync.read(session: h.session, caps: capsWithAlarms(smart: false), log: h.log.sink)
        XCTAssertEqual(alarms.event, [])
        XCTAssertNil(alarms.smart)
        XCTAssertEqual(h.watch.count(0x08, 0x04), 0)
    }

    func testReadAndWriteRefuseAWatchWithoutAlarmSupport() async {
        let h = SleepFilesHarness()
        do {
            _ = try await AlarmSync.read(session: h.session, caps: DeviceCaps(), log: h.log.sink)
            XCTFail("read")
        } catch let e as WearError { XCTAssertEqual(e.code, .unsupported) } catch { XCTFail("\(error)") }
        do {
            try await AlarmSync.write(session: h.session, caps: DeviceCaps(), log: h.log.sink, alarms: .empty)
            XCTFail("write")
        } catch let e as WearError { XCTAssertEqual(e.code, .unsupported) } catch { XCTFail("\(error)") }
        XCTAssertTrue(h.watch.requests.isEmpty)
    }

    func testWriteSendsSmartFirstThenTheEventAlarms() async throws {
        let h = SleepFilesHarness()
        h.watch.responder = { r in
            guard r.service == 0x08, r.command == 0x01 || r.command == 0x02 else { return [] }
            return [SleepFilesFakeWatch.tlvFrame(service: 0x08, command: r.command, HuaweiTLV())]
        }
        let alarms = WatchAlarms(
            event: [WatchAlarm(slot: 2, enabled: true, hour: 6, minute: 30, repeatMask: 0x1F, name: "Run")],
            smart: WatchSmartAlarm(enabled: true, hour: 7, minute: 0, repeatMask: 127, aheadMinutes: 15), updatedAtMs: nil
        )
        try await AlarmSync.write(session: h.session, caps: capsWithAlarms(), log: h.log.sink, alarms: alarms)
        let sent = h.watch.requests.filter { $0.service == 0x08 }
        XCTAssertEqual(sent.map(\.command), [0x02, 0x01])
        XCTAssertTrue(sent.allSatisfy { $0.encrypted })
        let smart = try sent[0].tlv.object(0x81).object(0x82)
        XCTAssertEqual(try smart.byte(0x03), 1)
        XCTAssertEqual(try smart.bool(0x04), true)
        XCTAssertEqual(try smart.short(0x05), 0x0700)
        XCTAssertEqual(try smart.byte(0x06), 127)
        XCTAssertEqual(try smart.byte(0x07), 15)
        let event = try sent[1].tlv.object(0x81).objects(0x82)
        XCTAssertEqual(event.count, 1)
        XCTAssertEqual(try event[0].byte(0x03), 2)
        XCTAssertEqual(try event[0].short(0x05), 0x061E)
        XCTAssertEqual(try event[0].string(0x07), "Run")
        XCTAssertTrue(h.log.contains("Alarms pushed: 1 event alarm(s), smart alarm"))
    }

    func testWriteOfNothingClearsWithBareIndexOne() async throws {
        let h = SleepFilesHarness()
        h.watch.responder = { r in [SleepFilesFakeWatch.tlvFrame(service: 0x08, command: r.command, HuaweiTLV())] }
        try await AlarmSync.write(session: h.session, caps: capsWithAlarms(), log: h.log.sink, alarms: .empty)
        let sent = h.watch.requests.filter { $0.service == 0x08 }
        XCTAssertEqual(sent.map(\.command), [0x01])
        let entries = try sent[0].tlv.object(0x81).objects(0x82)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].serialize().hexLower, "030101")
    }

    func testAMissingAcknowledgmentIsLoggedNotFailed() async throws {
        let h = SleepFilesHarness()
        let alarms = WatchAlarms(event: [WatchAlarm(slot: 1, enabled: true, hour: 6, minute: 0, repeatMask: 0, name: "A")], smart: nil, updatedAtMs: nil)
        try await AlarmSync.write(session: h.session, caps: capsWithAlarms(), log: h.log.sink, alarms: alarms, queryMs: 50)
        XCTAssertTrue(h.log.containsError("EventAlarms: no acknowledgment from the watch"))
        XCTAssertEqual(h.watch.count(0x08, 0x01), 1)
    }

    func testWriteRefusesASmartAlarmTheWatchDoesNotHaveAndSendsNothing() async {
        let h = SleepFilesHarness()
        let alarms = WatchAlarms(event: [], smart: WatchSmartAlarm(enabled: true, hour: 6, minute: 0, repeatMask: 0, aheadMinutes: 5), updatedAtMs: nil)
        do {
            try await AlarmSync.write(session: h.session, caps: capsWithAlarms(smart: false), log: h.log.sink, alarms: alarms)
            XCTFail("sent a smart alarm to a watch without one")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
        } catch { XCTFail("\(error)") }
        XCTAssertTrue(h.watch.requests.isEmpty)
    }

    func testWriteValidatesBeforeTalkingToTheWatch() async {
        let h = SleepFilesHarness()
        let bad = WatchAlarms(event: [WatchAlarm(slot: 7, enabled: true, hour: 6, minute: 0, repeatMask: 0, name: "A")], smart: nil, updatedAtMs: nil)
        do {
            try await AlarmSync.write(session: h.session, caps: capsWithAlarms(), log: h.log.sink, alarms: bad)
            XCTFail("accepted slot 7")
        } catch let e as WearError { XCTAssertEqual(e.code, .invalidArgument) } catch { XCTFail("\(error)") }
        XCTAssertTrue(h.watch.requests.isEmpty)
    }
}

private extension HuaweiTLV {
    /// Smart alarm replies carry the window in tag 0x07.
    func withAhead(_ minutes: Int) -> HuaweiTLV {
        var copy = self
        copy.put(0x07, byte: UInt8(minutes))
        return copy
    }
}

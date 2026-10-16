import XCTest
@testable import HuaweiProtocol

/// Byte-exact against the Java the Android app runs (GoldenGen/src/GoldenP2p.java): the P2P packet, the manager, the base service, the sub-message
/// header and the data dictionary sync with every dictionary handler.
final class P2PTests: XCTestCase {
    // MARK: helpers

    /// Records what the manager sends, in the shape GoldenP2p.java dumps it.
    final class Capture: P2PTransport, @unchecked Sendable {
        private let lock = NSLock()
        private var _sent: [[String: Any]] = []
        var expand14 = true

        func sendP2P(
            cmdId: UInt8, sequence: Int16, srcPackage: String?, dstPackage: String?, srcFingerprint: String?, dstFingerprint: String?, sendData: Bytes?,
            sendCode: Int32
        ) throws {
            let packet = P2P.P2PCommand.request(
                cmdId: cmdId, sequenceId: sequence, srcPackage: srcPackage, dstPackage: dstPackage, srcFingerprint: srcFingerprint,
                dstFingerprint: dstFingerprint, sendData: sendData, sendCode: sendCode
            )
            let entry: [String: Any] = [
                "cmd": Int(cmdId), "seq": Int(sequence), "src": srcPackage ?? NSNull(), "dst": dstPackage ?? NSNull(), "srcFp": srcFingerprint ?? NSNull(),
                "dstFp": dstFingerprint ?? NSNull(), "data": sendData.map { $0.hexLower as Any } ?? NSNull(), "code": Int(sendCode),
                "tlv": packet.tlv!.serialize().hexLower,
            ]
            lock.lock()
            _sent.append(entry)
            lock.unlock()
        }

        func supportsExpandCapability(_ which: Int) -> Bool { which == 14 ? expand14 : false }
        func log(_ message: String) {}

        func take() -> [[String: Any]] {
            lock.lock()
            defer { lock.unlock() }
            defer { _sent = [] }
            return _sent
        }
    }

    final class Probe: P2PService, @unchecked Sendable {
        var events: [String] = []
        var pingAnswer = 0xcf
        var dataAnswer = 0xcf
        override var module: String { "probe.module" }
        override var package: String { "probe.package" }
        override var fingerprint: String { "ProbeFp" }
        override func registered() { events.append("registered") }
        override func unregister() { events.append("unregister") }
        override func handleData(_ data: Bytes) throws { events.append("data:" + data.hexLower) }
        override func onPingPacket(_ packet: P2P.P2PCommand.Response) -> Int { pingAnswer }
        override func onDataPacket(_ packet: P2P.P2PCommand.Response) -> Int { dataAnswer }
        override func handleFile(filename: String, data: Bytes) { events.append("file:\(filename):\(data.hexLower)") }
    }

    static func response(_ cmd: Int, _ seq: Int, _ src: String, _ dst: String, _ data: Bytes?, _ code: Int?, codeAsByte: Bool = false) throws -> P2P.P2PCommand.Response {
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: UInt8(cmd))
        tlv.put(0x02, short: Int16(seq))
        tlv.put(0x03, string: src)
        tlv.put(0x04, string: dst)
        if let data { tlv.put(0x07, bytes: data) }
        if let code {
            if codeAsByte { tlv.put(0x08, byte: UInt8(truncatingIfNeeded: code)) } else { tlv.put(0x08, int: Int32(code)) }
        }
        return try P2P.P2PCommand.Response(packet: HuaweiPacket(serviceId: 0x34, commandId: 0x01, tlv: tlv))
    }

    private func same(_ a: Any, _ b: Any, _ message: String = "", file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(PacketsKit.canonical(a), PacketsKit.canonical(b), message, file: file, line: line)
    }

    // MARK: packets

    func testRequestsMatchJava() throws {
        let cases = try Golden.load("p2p").list("requests")
        XCTAssertEqual(cases.count, 8)
        for c in cases {
            let name = c.str("name")
            let packet = P2P.P2PCommand.request(
                cmdId: UInt8(c.int("cmd")), sequenceId: Int16(c.int("seq")), srcPackage: c.str("src"), dstPackage: c.str("dst"), srcFingerprint: c.opt("srcFp"),
                dstFingerprint: c.opt("dstFp"), sendData: c.optBytes("data"), sendCode: Int32(c.int("code"))
            )
            XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name)
            XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name)
            XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name)
            XCTAssertEqual(packet.isSliced, c.bool("sliced"), name)
            XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), name)
            XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], name)
        }
    }

    func testResponsesMatchJava() throws {
        for c in try Golden.load("p2p").list("responses") {
            let name = c.str("name")
            let packet = try PacketsKit.tlvPacket(c.int("service"), c.int("command"), c.str("tlv"))
            if !c.bool("ok") {
                XCTAssertThrowsError(try P2P.P2PCommand.Response(packet: packet), name)
                continue
            }
            let r = try P2P.P2PCommand.Response(packet: packet)
            let f = c["fields"] as! [String: Any]
            XCTAssertEqual(Int(r.cmdId), f.int("cmdId"), name)
            XCTAssertEqual(Int(r.sequenceId), f.int("sequenceId"), name)
            XCTAssertEqual(r.srcPackage, f.str("srcPackage"), name)
            XCTAssertEqual(r.dstPackage, f.str("dstPackage"), name)
            XCTAssertEqual(r.srcFingerprint, f.opt("srcFingerprint"), name)
            XCTAssertEqual(r.dstFingerprint, f.opt("dstFingerprint"), name)
            XCTAssertEqual(r.respData, f.optBytes("respData"), name)
            XCTAssertEqual(Int(r.respCode), f.int("respCode"), name)
        }
    }

    func testSubMessagesMatchJava() throws {
        let cases = try Golden.load("p2p").list("subMessages")
        XCTAssertEqual(cases.count, 7)
        for c in cases {
            if c.opt("bytes") != nil {
                let m = P2PSubMsg(type: c.int("type"), messageId: c.int("messageId"), data: c.bytes("data"))
                XCTAssertEqual(m.bytes.hexLower, c.str("bytes"))
                let back = try P2PSubMsg(parsing: m.bytes)
                XCTAssertEqual(Int(back.type), c.int("parsedType"))
                XCTAssertEqual(Int(back.version), c.int("parsedVersion"))
                XCTAssertEqual(Int(back.totalLength), c.int("parsedLength"))
                XCTAssertEqual(Int(back.messageId), c.int("parsedMessageId"))
                XCTAssertEqual(back.data, c.optBytes("parsedData"))
            } else if c.bool("throws") {
                XCTAssertThrowsError(try P2PSubMsg(parsing: c.optBytes("raw")))
            } else {
                let m = try P2PSubMsg(parsing: c.optBytes("raw"))
                XCTAssertEqual(Int(m.type), c.int("parsedType"))
                XCTAssertEqual(Int(m.version), c.int("parsedVersion"))
                XCTAssertEqual(Int(m.totalLength), c.int("parsedLength"))
                XCTAssertEqual(Int(m.messageId), c.int("parsedMessageId"))
                XCTAssertEqual(m.data, c.optBytes("parsedData"))
            }
        }
    }

    func testTheMessageIdCounterCountsUpAndWraps() {
        let a = P2PSubMsg.nextMessageId()
        let b = P2PSubMsg.nextMessageId()
        XCTAssertEqual(b, (a + 1) % 1_000_000)
    }

    func testASubMessageThatIsShorterThanItsLengthFieldThrows() {
        var bytes = P2PSubMsg(type: 3, messageId: 1, data: [1, 2, 3]).bytes
        bytes.removeLast()
        XCTAssertThrowsError(try P2PSubMsg(parsing: bytes))
    }

    func testSequenceNumbersMatchJava() throws {
        let manager = P2PManager(transport: Capture())
        let expected = try Golden.load("p2p")["sequence"] as! [[Int]]
        var wanted = [Int: Int](uniqueKeysWithValues: expected.map { ($0[0], $0[1]) })
        for i in 1...33_000 {
            let s = Int(manager.nextSequence())
            if let w = wanted.removeValue(forKey: i) { XCTAssertEqual(s, w, "call \(i)") }
        }
        XCTAssertTrue(wanted.isEmpty)
    }

    // MARK: manager and base service

    func testManagerAndBaseServiceBehaveLikeJava() throws {
        let capture = Capture()
        let manager = P2PManager(transport: capture)
        let probe = Probe(manager: manager)
        probe.register()
        let golden = try Golden.load("p2p")["manager"] as! [String: Any]
        let steps = golden["steps"] as! [[String: Any]]
        var index = 0
        func check(_ name: String, extra: [String: Any] = [:], file: StaticString = #filePath, line: UInt = #line) {
            let expected = steps[index]
            index += 1
            XCTAssertEqual(expected.str("do"), name, file: file, line: line)
            same(capture.take(), expected["sent"] as! [Any], name, file: file, line: line)
            for (key, value) in extra { same(value, expected[key] ?? NSNull(), "\(name): \(key)", file: file, line: line) }
        }
        let lock = NSLock()
        var answered = -1
        var got: Bytes?

        probe.sendPing { code, _ in lock.lock(); answered = code; lock.unlock() }
        check("sendPing")
        try manager.handlePacket(Self.response(2, 2, "probe.package", "com.huawei.health", nil, 0xca, codeAsByte: true))
        check("answer ping 0xca", extra: ["callback": answered])
        probe.sendCommand([7, 8, 9]) { code, data in lock.lock(); answered = code; got = data; lock.unlock() }
        check("sendCommand")
        try manager.handlePacket(Self.response(2, 3, "probe.package", "probe.module", [0x55], 0xcf, codeAsByte: true))
        check("answer command", extra: ["callback": answered, "data": got!.hexLower])
        probe.sendGetVersion(nil)
        check("sendGetVersion")
        capture.expand14 = false
        probe.sendGetVersion(nil)
        check("sendGetVersion without bit 14")
        try manager.handlePacket(Self.response(1, 40, "probe.package", "probe.module", nil, nil))
        check("watch ping")
        probe.pingAnswer = 0xca
        try manager.handlePacket(Self.response(1, 41, "probe.package", "probe.module", nil, nil))
        check("watch ping, answer 0xca")
        try manager.handlePacket(Self.response(2, 42, "probe.package", "probe.module", [1, 2], nil))
        check("watch data")
        try manager.handlePacket(Self.response(2, 43, "probe.package", "probe.module", nil, nil))
        check("watch data without payload")
        try manager.handlePacket(Self.response(2, 44, "other.package", "probe.module", [3], nil))
        check("watch data of another package")
        try manager.handlePacket(Self.response(3, 45, "probe.package", "probe.module", nil, 0xcf, codeAsByte: true))
        check("watch ack nobody waits for")
        manager.handleFile(srcPackage: "probe.package", dstPackage: "x", srcFingerprint: "y", dstFingerprint: "z", filename: "f.bin", data: [1])
        manager.handleFile(srcPackage: "other", dstPackage: "x", srcFingerprint: "y", dstFingerprint: "z", filename: "g.bin", data: [2])
        try manager.handlePacket(Self.response(1, 50, "w.watch", "a.b.wakeapp", nil, nil))
        check("wakeapp without data")
        var link = HuaweiTLV()
        link.put(0x04, string: "some://link")
        try manager.handlePacket(Self.response(1, 51, "w.watch", "a.b.wakeapp", link.serialize(), nil))
        check("wakeapp with link")
        var other = HuaweiTLV()
        other.put(0x05, string: "x")
        try manager.handlePacket(Self.response(1, 52, "w.watch", "a.b.wakeapp", other.serialize(), nil))
        check("wakeapp without link")
        try manager.handlePacket(Self.response(1, 53, "w.watch", "a.b", nil, nil))
        check("short destination")
        let second = Probe(manager: manager)
        second.register()
        manager.unregisterAllServices()
        XCTAssertEqual(index, steps.count)
        XCTAssertEqual(probe.events, golden["probeEvents"] as! [String])
        XCTAssertEqual(second.events, golden["secondEvents"] as! [String])
    }

    // MARK: dictionary sync

    static func dictBytes(_ v: Int) -> Bytes { P2PDictionarySyncService.dictToBytes(v) }

    static func doubleBytes(_ v: Double) -> Bytes { (0..<8).map { UInt8((v.bitPattern >> UInt64(8 * (7 - $0))) & 0xFF) } }

    /// GoldenP2p.answer: one answer of the watch.
    static func answer(_ operation: Int, _ dictClass: Int, _ entries: [[Int64]], _ type: Int, _ value: Double) -> Bytes {
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: UInt8(operation))
        tlv.put(0x02, bytes: dictBytes(dictClass))
        var block = HuaweiTLV()
        for e in entries {
            var l = HuaweiTLV()
            l.put(0x05, long: e[0])
            if e[1] != 0 { l.put(0x06, long: e[1]) }
            if e[2] != 0 { l.put(0x0c, long: e[2]) }
            var inner = HuaweiTLV()
            inner.put(0x09, int: Int32(type))
            inner.put(0x0a, bytes: doubleBytes(value))
            var wrap = HuaweiTLV()
            wrap.put(0x88, tlv: inner)
            l.put(0x87, tlv: wrap)
            block.put(0x84, tlv: l)
        }
        if !entries.isEmpty { tlv.put(0x83, tlv: block) }
        return [1] + tlv.serialize()
    }

    static func dump(_ dictClass: Int, _ data: [DictData]) -> [String: Any] {
        [
            "onData": dictClass,
            "entries": data.map { d -> [String: Any] in
                [
                    "start": d.startTimestamp, "end": d.endTimestamp, "modify": d.modifyTimestamp,
                    "values": d.data.map { ["type": $0.dataType, "tag": Int($0.tag), "value": ($0.value ?? []).hexLower] as [String: Any] },
                ]
            },
        ]
    }

    final class Callback: DictionarySyncCallback, @unchecked Sendable {
        private let lock = NSLock()
        private var _events: [Any] = []
        var lastTs: Int64 = 0

        func lastDataSyncTimestamp(dictClass: Int) -> Int64 {
            lock.lock(); _events.append("last:\(dictClass)"); lock.unlock()
            return lastTs
        }

        func onData(dictClass: Int, dictData: [DictData]) throws {
            lock.lock(); _events.append(P2PTests.dump(dictClass, dictData)); lock.unlock()
        }

        func onComplete(_ complete: Bool) {
            lock.lock(); _events.append("complete:\(complete)"); lock.unlock()
        }

        func take() -> [Any] {
            lock.lock(); defer { lock.unlock() }
            defer { _events = [] }
            return _events
        }
    }

    /// The request of the dictionary service carries the phone's clock in tag 6: both sides are compared with it zeroed.
    private func masked(_ sent: [[String: Any]]) -> [[String: Any]] {
        sent.map { entry in
            var e = entry
            e["tlv"] = nil
            if let hex = e["data"] as? String, hex.hasPrefix("01"), let bytes = Bytes(hex: hex), let tlv = try? HuaweiTLV(parsing: Array(bytes.dropFirst())) {
                var out = HuaweiTLV()
                for entry in tlv.entries { out.put(Int(entry.tag), bytes: entry.tag == 0x06 ? Bytes(repeating: 0, count: entry.value.count) : entry.value) }
                e["data"] = ([1] + out.serialize()).hexLower
            }
            return e
        }
    }

    func testDictionarySyncBehavesLikeJava() throws {
        let capture = Capture()
        let manager = P2PManager(transport: capture)
        let service = P2PDictionarySyncService(manager: manager, nowMs: { 1_790_000_000_000 })
        let pings = NSMutableArray()
        service.setAvailabilityListener { pings.add($0) }
        let steps = try Golden.load("p2p")["dictionary"] as! [[String: Any]]
        var index = 0
        let callback = Callback()
        func check(_ name: String, file: StaticString = #filePath, line: UInt = #line) {
            let expected = steps[index]
            index += 1
            XCTAssertEqual(expected.str("do"), name, file: file, line: line)
            same(masked(capture.take()), masked(expected["sent"] as! [[String: Any]]), name, file: file, line: line)
            if let events = expected["events"] { same(callback.take(), events, "\(name): callback events", file: file, line: line) }
        }
        let watch = "hw.watch.health.filesync"
        let phone = "hw.unitedevice.datadictionarysync"

        service.register()
        check("register")
        callback.lastTs = 0
        service.startSync([500044], callback: callback)
        check("start while unavailable")
        try manager.handlePacket(Self.response(2, 2, watch, "com.huawei.health", nil, 0xca, codeAsByte: true))
        check("ping answered 0xca")
        same(Array(pings), steps[index - 1]["pings"]!)
        XCTAssertTrue(service.isAvailable)
        callback.lastTs = 1_700_000_000_000
        service.startSync([500044, 400012, 500031], callback: callback)
        check("start three classes")
        try manager.handlePacket(
            Self.response(
                2, 60, watch, phone, Self.answer(1, 500044, [[1_700_000_100_000, 1_700_000_160_000, 0], [1_700_000_200_000, 0, 1_700_000_260_000]], 500044831, 45.9), nil
            )
        )
        check("page 1")
        try manager.handlePacket(Self.response(2, 61, watch, phone, Self.answer(1, 500044, [], 0, 0), nil))
        check("empty page")
        try manager.handlePacket(Self.response(2, 62, watch, phone, Self.answer(1, 400012, [[1_700_000_300_000, 1_700_000_300_000, 0]], 400012430, 36.6), nil))
        check("temperature page")
        try manager.handlePacket(Self.response(2, 63, watch, phone, Self.answer(1, 400012, [], 0, 0), nil))
        check("empty temperature page")
        try manager.handlePacket(Self.response(2, 64, watch, phone, Self.answer(2, 500031, [], 0, 0), nil))
        check("unknown operation")
        try manager.handlePacket(Self.response(2, 65, watch, phone, Self.answer(1, 700004, [], 0, 0), nil))
        check("unrequested class")
        service.startSync([500002], callback: callback)
        service.startSync([500002], callback: callback)
        check("class in progress")
        service.cancelSync()
        service.startSync([], callback: callback)
        check("empty list")
        callback.lastTs = -5
        service.startSync([500002], callback: callback)
        check("negative start")
        service.cancelSync()
        try manager.handlePacket(Self.response(2, 66, watch, phone, [7, 1, 2], nil))
        try manager.handlePacket(Self.response(2, 67, watch, phone, [], nil))
        check("ignored data")
        callback.lastTs = 0
        service.startSync([500044], callback: callback)
        _ = capture.take()
        var l = HuaweiTLV()
        l.put(0x06, long: 5)
        var block = HuaweiTLV()
        block.put(0x84, tlv: l)
        var bad = HuaweiTLV()
        bad.put(0x01, byte: 1)
        bad.put(0x02, bytes: Self.dictBytes(500044))
        bad.put(0x83, tlv: block)
        try manager.handlePacket(Self.response(2, 68, watch, phone, [1] + bad.serialize(), nil))
        check("missing start time")
        XCTAssertEqual(index, steps.count)
    }

    func testDictToBytesMatchesJava() throws {
        for pair in try Golden.load("p2p")["dictToBytes"] as! [[Any]] {
            XCTAssertEqual(P2PDictionarySyncService.dictToBytes((pair[0] as! NSNumber).intValue).hexLower, pair[1] as! String)
        }
    }

    // MARK: handlers

    final class MemoryStore: DictionarySyncStore, @unchecked Sendable {
        var rows: [DictionaryRow] = []
        func lastFetchTimestamp(_ type: String) -> Int64 { 0 }
        func persist(_ rows: [DictionaryRow]) throws { self.rows.append(contentsOf: rows) }
    }

    func testHandlerGatesMatchJava() throws {
        let handlers = P2PDictionarySyncService.syncHandlers()
        let gates = try Golden.load("p2p").list("handlerGates")
        XCTAssertEqual(handlers.count, gates.count)
        for (handler, g) in zip(handlers, gates) {
            XCTAssertEqual(handler.dataClass, g.int("class"))
            XCTAssertEqual(handler.metricType, g.str("type"))
            XCTAssertEqual(handler.title, g.str("title"))
            XCTAssertEqual(handler.gate, g.str("gate"))
            XCTAssertEqual(handler.supports { _ in false }, g.bool("supportsNone"))
            for pair in g["supportsOnly"] as! [[Any]] {
                let bit = (pair[0] as! NSNumber).intValue
                XCTAssertEqual(handler.supports { $0 == bit }, (pair[1] as! NSNumber).boolValue, "\(handler.metricType) bit \(bit)")
            }
        }
    }

    func testHandlerRowsMatchJava() throws {
        let cases = try Golden.load("p2p").list("handlerCases")
        XCTAssertGreaterThan(cases.count, 30)
        for c in cases {
            let dictClass = c.int("onData")
            let entries = c["entries"] as! [[String: Any]]
            let data = entries.map { e -> DictData in
                DictData(
                    dictClass: dictClass, startTimestamp: (e["start"] as! NSNumber).int64Value, endTimestamp: (e["end"] as! NSNumber).int64Value,
                    modifyTimestamp: (e["modify"] as! NSNumber).int64Value,
                    data: (e["values"] as! [[String: Any]]).map { DictData.Value(dataType: $0.int("type"), tag: UInt8($0.int("tag")), value: $0.bytes("value")) }
                )
            }
            let store = MemoryStore()
            for handler in P2PDictionarySyncService.syncHandlers() where handler.dataClass == dictClass {
                try handler.handleData(store: store, dictData: data)
            }
            let expected = c["rows"] as! [[String: Any]]
            XCTAssertEqual(store.rows.count, expected.count, "class \(dictClass) \(c)")
            for (row, e) in zip(store.rows, expected) {
                XCTAssertEqual(row.type, e.str("type"))
                XCTAssertEqual(row.timestamp, (e["timestamp"] as! NSNumber).int64Value)
                XCTAssertEqual(row.lastTimestamp, (e["lastTimestamp"] as! NSNumber).int64Value)
                if let v = e["value"] as? NSNumber { XCTAssertEqual(row.value, v.doubleValue, "class \(dictClass)") } else { XCTAssertNil(row.value) }
                let parsed = try JSONSerialization.jsonObject(with: Data(row.valuesJson.utf8))
                same(parsed, e["valuesJson"]!, "class \(dictClass) values_json \(row.valuesJson)")
            }
        }
    }
}

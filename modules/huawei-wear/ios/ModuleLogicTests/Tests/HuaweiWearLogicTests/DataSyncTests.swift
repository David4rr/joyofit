import XCTest
@testable import HuaweiWearLogic

/// Events sink of the DataSync tests: the log and the pushed face configurations.
final class SyncEvents: WearEvents, @unchecked Sendable {
    private let lock = NSLock()
    private var _logs: [LogEntry] = []
    private var _faces: [[String: Any]] = []
    var logs: [LogEntry] { lock.locked { _logs } }
    var faces: [[String: Any]] { lock.locked { _faces } }
    func state(_ state: LinkState, error: String?) {}
    func battery(_ level: Int) {}
    func syncComplete(_ summary: SyncSummary) {}
    func log(_ entry: LogEntry) { lock.locked { _logs.append(entry) } }
    func faceCustomization(_ payload: [String: Any]) { lock.locked { _faces.append(payload) } }
    func contains(_ fragment: String) -> Bool { logs.contains { $0.message.contains(fragment) } }
    func containsError(_ fragment: String) -> Bool { logs.contains { $0.direction == .error && $0.message.contains(fragment) } }
}

/// What the phone wrote, decoded like the watch would; `responder` answers with frames fed back into the session.
final class RigWatch: FrameSink, @unchecked Sendable {
    struct Sent {
        let service: UInt8
        let command: UInt8
        let tlv: HuaweiTLV
    }

    private let lock = NSLock()
    private var assembler = PacketAssembler()
    private var _sent: [Sent] = []
    var session: HuaweiSession?
    var responder: (Sent) -> [Bytes] = { _ in [] }

    var sent: [Sent] { lock.locked { _sent } }

    func write(_ frames: [Bytes]) async throws {
        guard let session else { return }
        for f in frames {
            var local = lock.locked { assembler }
            let result = try local.feed(f, params: session.params)
            lock.locked { assembler = local }
            guard let packet = result.packet else { continue }
            let item = Sent(service: packet.serviceId, command: packet.commandId, tlv: packet.tlv ?? HuaweiTLV())
            lock.locked { _sent.append(item) }
            for r in responder(item) { session.onData(r) }
        }
    }
}

final class RigSource: LinkHandleSource, @unchecked Sendable {
    var current: LinkHandle?
    func handle() -> LinkHandle? { current }
}

/// A connected-watch stand-in for the DataSync framework and the features on it.
final class DataSyncRig {
    let watch = RigWatch()
    let session: HuaweiSession
    let caps = DeviceCaps()
    let source = RigSource()
    let events = SyncEvents()
    let service: DataSyncService

    init(bits: [Int] = [83, 84], connected: Bool = true, connectDelayMs: Int = 0) {
        session = HuaweiSession(sink: watch, log: { _ in })
        session.params.secretKey = Bytes(repeating: 0, count: 16)
        watch.session = session
        var bitmap = Bytes(repeating: 0, count: 24)
        for bit in bits { bitmap[bit / 8] |= UInt8(1 << (bit % 8)) }
        caps.expandCapabilities = bitmap
        if connected { source.current = LinkHandle(address: "A", session: session, caps: caps, operationLock: AsyncLock()) }
        service = DataSyncService(link: source, events: events, connectDelayMs: connectDelayMs)
    }

    func attach() async { if let h = source.current { await service.linkConnected(h) } }

    /// An unsliced, unencrypted watch frame.
    static func frame(_ command: UInt8, _ tlv: HuaweiTLV) -> Bytes {
        var body = Bytes([huaweiMagic])
        let inner = Bytes([0x37, command]) + tlv.serialize()
        body.appendBE(UInt16(inner.count + 1))
        body.append(0)
        body += inner
        body.appendBE(CRC16.checksum(body))
        return body
    }

    static func eventFrame(src: String, wear: String, id: Int, data: Bytes?, code: Int32? = nil) -> Bytes {
        var t = HuaweiTLV()
        t.put(0x01, string: src)
        t.put(0x02, string: wear)
        t.put(0x03, int: Int32(id))
        t.put(0x04, byte: 0)
        if let data { t.put(0x05, bytes: data) }
        if let code { t.put(0x7F, int: code) }
        return frame(0x02, t)
    }

    static func configFrame(src: String, wear: String, items: [ConfigItem], code: Int32? = nil) -> Bytes {
        var list = HuaweiTLV()
        for item in items {
            var e = HuaweiTLV()
            e.put(0x05, int: Int32(item.configId))
            e.put(0x06, byte: UInt8(item.action))
            list.put(0x84, tlv: e)
        }
        var t = HuaweiTLV()
        t.put(0x01, string: src)
        t.put(0x02, string: wear)
        if !items.isEmpty { t.put(0x83, tlv: list) }
        if let code { t.put(0x7F, int: code) }
        return frame(0x01, t)
    }
}

private final class Collector<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var _items: [T] = []
    var items: [T] { lock.locked { _items } }
    func add(_ item: T) { lock.locked { _items.append(item) } }
}

private final class TestFeature: DataSyncFeature, @unchecked Sendable {
    let name: String
    let fail: Bool
    private let lock = NSLock()
    private var _registered = 0
    private var _connected = 0
    var registered: Int { lock.locked { _registered } }
    var connectedCalls: Int { lock.locked { _connected } }

    init(name: String = "test", fail: Bool = false) {
        self.name = name
        self.fail = fail
    }

    func register(service: DataSyncService) { lock.locked { _registered += 1 } }

    func onConnected() async throws {
        lock.locked { _connected += 1 }
        if fail { throw WearError(.protocolError, "boom") }
    }
}

final class DataSyncServiceTests: XCTestCase {
    let phone = "hw.unitedevice.weightMgr"
    let watchPkg = "hw.sport.dietcal"

    func testAWatchEventReachesTheHandlerMatchedOnItsPackagesAndId() async {
        let rig = DataSyncRig()
        let got = Collector<SampleEvent>()
        rig.service.onEvent(phonePkg: phone, watchPkg: watchPkg, eventId: 77) { got.add($0) }
        await rig.attach()

        rig.session.onData(DataSyncRig.eventFrame(src: watchPkg, wear: phone, id: 77, data: [1, 2, 3]))

        await eventually { !got.items.isEmpty }
        XCTAssertEqual(got.items.count, 1)
        XCTAssertEqual(got.items[0].eventId, 77)
        XCTAssertEqual(got.items[0].data, [1, 2, 3])
        XCTAssertEqual(got.items[0].phonePkg, phone)
        XCTAssertEqual(got.items[0].watchPkg, watchPkg)
        XCTAssertTrue(rig.events.contains("DataSync event from watch: src=hw.sport.dietcal wear=hw.unitedevice.weightMgr id=77"))
    }

    func testThePackagesMayAlsoBeWrittenTheOtherWayRound() async {
        let rig = DataSyncRig()
        let got = Collector<SampleEvent>()
        rig.service.onEvent(phonePkg: phone, watchPkg: watchPkg, eventId: nil) { got.add($0) }
        await rig.attach()

        rig.session.onData(DataSyncRig.eventFrame(src: phone, wear: watchPkg, id: 5, data: nil))

        await eventually { !got.items.isEmpty }
        XCTAssertEqual(got.items[0].phonePkg, phone)
    }

    func testAnEventNobodyWantsIsLoggedAndNotDispatched() async {
        let rig = DataSyncRig()
        let got = Collector<SampleEvent>()
        rig.service.onEvent(phonePkg: phone, watchPkg: watchPkg, eventId: 77) { got.add($0) }
        await rig.attach()

        rig.session.onData(DataSyncRig.eventFrame(src: watchPkg, wear: phone, id: 78, data: nil))
        rig.session.onData(DataSyncRig.eventFrame(src: "other", wear: "pkg", id: 77, data: nil))

        await eventually { rig.events.logs.filter { $0.message.contains("no handler") }.count == 2 }
        XCTAssertTrue(got.items.isEmpty)
    }

    func testAWatchAnswerWithACodeIsAnAnswerNotARequest() async {
        let rig = DataSyncRig()
        let got = Collector<SampleEvent>()
        rig.service.onEvent(phonePkg: phone, watchPkg: watchPkg, eventId: nil) { got.add($0) }
        await rig.attach()

        rig.session.onData(DataSyncRig.eventFrame(src: watchPkg, wear: phone, id: 77, data: nil, code: 100_000))
        rig.session.onData(DataSyncRig.eventFrame(src: watchPkg, wear: phone, id: 77, data: nil, code: 100_001))

        await eventually { rig.events.containsError("watch answer with code 100001") }
        XCTAssertTrue(rig.events.contains("watch answer with code 100000 (100000 is OK), not dispatched"))
        XCTAssertTrue(got.items.isEmpty)
    }

    func testAConfigIsDispatchedOncePerItemThatMatches() async {
        let rig = DataSyncRig()
        let all = Collector<Int>()
        let only = Collector<Int>()
        rig.service.onConfig(phonePkg: nil, watchPkg: "findDevice", configId: nil) { all.add($0.items[0].configId) }
        rig.service.onConfig(phonePkg: nil, watchPkg: "findDevice", configId: 2) { only.add($0.items[0].configId) }
        await rig.attach()

        rig.session.onData(DataSyncRig.configFrame(src: "findDevice", wear: "hw.unitedevice.finddevice", items: [ConfigItem(configId: 1, action: 2), ConfigItem(configId: 2, action: 2)]))

        await eventually { all.items.count == 2 && only.items.count == 1 }
        XCTAssertEqual(all.items.sorted(), [1, 2])
        XCTAssertEqual(only.items, [2])
    }

    func testTheFindWatchReplyIsLogged() async {
        let rig = DataSyncRig()
        await rig.attach()

        rig.session.onData(DataSyncRig.configFrame(src: "findDevice", wear: "hw.unitedevice.finddevice", items: [ConfigItem(configId: 900_100_002, action: 2)]))

        await eventually { rig.events.contains("DataSync config from watch") }
        XCTAssertTrue(rig.events.contains("DataSync config from watch: src=findDevice wear=hw.unitedevice.finddevice code=- id=900100002 action=2"))
    }

    func testAWatchErrorReplyIsAnError() async {
        let rig = DataSyncRig()
        await rig.attach()

        rig.session.onData(DataSyncRig.configFrame(src: "findDevice", wear: "hw.unitedevice.finddevice", items: [], code: 100_001))

        await eventually { rig.events.containsError("code=100001") }
    }

    func testAnUnreadablePacketIsLoggedAndTheLinkLivesOn() async {
        let rig = DataSyncRig()
        await rig.attach()
        var t = HuaweiTLV()
        t.put(0x83, bytes: [0x84, 0x09])

        rig.session.onData(DataSyncRig.frame(0x01, t))

        await eventually { rig.events.containsError("could not parse the watch's packet") }
    }

    // MARK: outbound

    func testAnEventGoesOutOnlyWhenTheWatchReportsTheBit() async throws {
        let missing = DataSyncRig(bits: [83])
        let sentMissing = try await missing.service.sendEvent(phonePkg: phone, watchPkg: watchPkg, eventId: 5, data: [1])
        XCTAssertFalse(sentMissing)
        XCTAssertTrue(missing.watch.sent.isEmpty)
        XCTAssertTrue(missing.events.contains("needs ExpandCapability 84: NOT set"))

        let rig = DataSyncRig(bits: [84])
        let sent = try await rig.service.sendEvent(phonePkg: phone, watchPkg: watchPkg, eventId: 5, data: [1], level: 3)
        XCTAssertTrue(sent)
        let packet = try XCTUnwrap(rig.watch.sent.first)
        XCTAssertEqual(packet.service, 0x37)
        XCTAssertEqual(packet.command, 0x02)
        XCTAssertEqual(try packet.tlv.string(0x01), phone)
        XCTAssertEqual(try packet.tlv.string(0x02), watchPkg)
        XCTAssertEqual(try packet.tlv.int(0x03), 5)
        XCTAssertEqual(try packet.tlv.byte(0x04), 3)
        XCTAssertEqual(try packet.tlv.bytes(0x05), [1])
        XCTAssertTrue(rig.events.contains("needs ExpandCapability 84: set"))
    }

    func testEveryCommandIsGatedOnItsOwnBit() async throws {
        let rig = DataSyncRig(bits: [])
        let sentConfig = try await rig.service.sendConfig(phonePkg: phone, watchPkg: watchPkg, configId: 1, data: nil)
        let sentPoint = try await rig.service.sendSamplePoint(phonePkg: phone, watchPkg: watchPkg, dictType: 1, values: [])
        let sentDict = try await rig.service.sendDictionary(phonePkg: phone, watchPkg: watchPkg, dictType: 1, rows: [])
        XCTAssertFalse(sentConfig)
        XCTAssertFalse(sentPoint)
        XCTAssertFalse(sentDict)
        for bit in [83, 85, 173] { XCTAssertTrue(rig.events.contains("ExpandCapability \(bit): NOT set"), "\(bit)") }
        let all = DataSyncRig(bits: [83, 85, 173])
        let results = [
            try await all.service.sendConfig(phonePkg: phone, watchPkg: watchPkg, configId: 1, data: [9], modifyMs: 5),
            try await all.service.sendSamplePoint(phonePkg: phone, watchPkg: watchPkg, dictType: 1, values: [PointValue(key: 1, value: [2])]),
            try await all.service.sendDictionary(phonePkg: phone, watchPkg: watchPkg, dictType: 1, rows: [DictRow(startMs: 1, endMs: 2)]),
        ]
        XCTAssertEqual(results, [true, true, true])
        XCTAssertEqual(all.watch.sent.map(\.command), [0x01, 0x03, 0x04])
    }

    func testNothingIsSentWithoutAConnectedWatch() async throws {
        let rig = DataSyncRig(connected: false)
        let sent = try await rig.service.sendEvent(phonePkg: phone, watchPkg: watchPkg, eventId: 5, data: nil)
        XCTAssertFalse(sent)
        XCTAssertTrue(rig.events.contains("not sent, no connected watch"))
        XCTAssertFalse(rig.service.connected())
        XCTAssertFalse(rig.service.supports(84))
    }

    // MARK: features and link lifetime

    func testAFeatureIsRegisteredAtOnceAndToldOnceAfterTheLinkIsUp() async {
        let rig = DataSyncRig(connectDelayMs: 20)
        let good = TestFeature(name: "good")
        let bad = TestFeature(name: "bad", fail: true)
        let after = TestFeature(name: "after")
        for f in [good, bad, after] { rig.service.register(f) }
        XCTAssertEqual(good.registered, 1)
        XCTAssertTrue(rig.events.contains("feature 'good' registered"))

        await rig.attach()
        await rig.attach() // the same session again: announced once by LinkObservers, and ignored here too

        XCTAssertEqual([good.connectedCalls, bad.connectedCalls, after.connectedCalls], [1, 1, 1], "a failing feature does not stop the others")
        XCTAssertTrue(rig.events.containsError("feature 'bad': onConnected failed"))
    }

    func testALinkThatDropsBeforeTheDelayEndsSkipsTheFeatures() async {
        let rig = DataSyncRig(connectDelayMs: 150)
        let feature = TestFeature()
        rig.service.register(feature)
        let task = Task { await rig.attach() }
        await sleepMs(30)
        rig.service.linkDisconnected()
        await task.value
        XCTAssertEqual(feature.connectedCalls, 0)
    }

    func testACancelledRegistrationHearsNothing() async {
        let rig = DataSyncRig()
        let got = Collector<SampleEvent>()
        let registration = rig.service.onEvent(phonePkg: phone, watchPkg: watchPkg, eventId: nil) { got.add($0) }
        await rig.attach()
        registration.cancel()
        rig.session.onData(DataSyncRig.eventFrame(src: watchPkg, wear: phone, id: 1, data: nil))
        await eventually { rig.events.contains("no handler") }
        XCTAssertTrue(got.items.isEmpty)
    }
}

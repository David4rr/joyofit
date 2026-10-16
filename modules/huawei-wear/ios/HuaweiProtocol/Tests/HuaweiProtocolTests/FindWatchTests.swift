import XCTest
@testable import HuaweiProtocol

/// Find my watch end to end over a real `HuaweiSession` and the fake watch: the capability gates, the command the watch receives and the
/// reply log. The ExpandCapability bitmap is decoded exactly as on Android (`DeviceCaps.expandCapability`).
final class FindWatchTests: XCTestCase {
    private func caps(bits: [Int]) -> DeviceCaps {
        let caps = DeviceCaps()
        var map = Bytes(repeating: 0, count: 32)
        for bit in bits { map[bit / 8] |= UInt8(1 << (bit % 8)) }
        caps.expandCapabilities = map
        return caps
    }

    private func action(_ request: SleepFilesFakeWatch.Request) throws -> (id: Int32, action: Int8) {
        let item = try request.tlv.object(0x83).objects(0x84)[0]
        return (try item.int(0x05), try item.byte(0x06))
    }

    func testSupportNeedsBothBits() {
        XCTAssertTrue(FindWatch.supported(caps(bits: [79, 83])))
        XCTAssertFalse(FindWatch.supported(caps(bits: [79])))
        XCTAssertFalse(FindWatch.supported(caps(bits: [83])))
        XCTAssertFalse(FindWatch.supported(DeviceCaps()), "no bitmap reported")
        XCTAssertNil(FindWatch.unsupportedReason(caps(bits: [79, 83])))
        XCTAssertTrue(FindWatch.unsupportedReason(caps(bits: [83]))!.contains("ExpandCapability 79"))
        XCTAssertTrue(FindWatch.unsupportedReason(caps(bits: [79]))!.contains("ExpandCapability 83"))
    }

    func testStartAndStopReachTheWatchEncryptedAsDataSyncConfig() async throws {
        let h = SleepFilesHarness()
        let caps = caps(bits: [79, 83])
        try await FindWatch.send(session: h.session, caps: caps, log: h.log.sink, start: true)
        try await FindWatch.send(session: h.session, caps: caps, log: h.log.sink, start: false)

        let requests = h.watch.requests.filter { $0.service == 0x37 && $0.command == 0x01 }
        XCTAssertEqual(requests.count, 2)
        XCTAssertTrue(requests.allSatisfy { $0.encrypted }, "like every Java default, the TLV is encrypted")
        XCTAssertEqual(try requests[0].tlv.string(0x01), "hw.unitedevice.finddevice")
        XCTAssertEqual(try requests[0].tlv.string(0x02), "findDevice")
        XCTAssertEqual(try action(requests[0]).id, 900_100_002)
        XCTAssertEqual(try action(requests[0]).action, 2)
        XCTAssertEqual(try action(requests[1]).action, 1)
        XCTAssertTrue(h.log.contains("Find watch: start"))
        XCTAssertTrue(h.log.contains("Find watch: stop"))
    }

    func testAWatchWithoutTheBitsIsNeverSentAnything() async {
        for bits in [[Int](), [79], [83]] {
            let h = SleepFilesHarness()
            do {
                try await FindWatch.send(session: h.session, caps: caps(bits: bits), log: h.log.sink, start: true)
                XCTFail("sent to a watch that did not report find-device support (bits \(bits))")
            } catch let e as WearError {
                XCTAssertEqual(e.code, .unsupported)
            } catch {
                XCTFail("\(error)")
            }
            XCTAssertTrue(h.watch.requests.isEmpty)
        }
    }

    func testTheWatchReplyIsLogged() async throws {
        let h = SleepFilesHarness()
        _ = await FindWatch.attach(session: h.session, log: h.log.sink)
        h.watch.responder = { request in
            guard request.service == 0x37 else { return [] }
            var reply = HuaweiTLV()
            reply.put(0x01, string: "findDevice")
            reply.put(0x02, string: "hw.unitedevice.finddevice")
            var item = HuaweiTLV()
            item.put(0x05, int: 900_100_002)
            item.put(0x06, byte: 2)
            var list = HuaweiTLV()
            list.put(0x84, tlv: item)
            reply.put(0x83, tlv: list)
            return [SleepFilesFakeWatch.tlvFrame(service: 0x37, command: 0x01, reply)]
        }
        try await FindWatch.send(session: h.session, caps: caps(bits: [79, 83]), log: h.log.sink, start: true)
        for _ in 0..<50 where !h.log.contains("DataSync config from watch") { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertTrue(h.log.contains("DataSync config from watch: src=findDevice wear=hw.unitedevice.finddevice code=100000"))
        XCTAssertTrue(h.log.contains("id=900100002 action=2"))
    }

    func testAWatchErrorReplyIsAnError() async throws {
        let h = SleepFilesHarness()
        _ = await FindWatch.attach(session: h.session, log: h.log.sink)
        h.watch.responder = { request in
            guard request.service == 0x37 else { return [] }
            var reply = HuaweiTLV()
            reply.put(0x01, string: "findDevice")
            reply.put(0x02, string: "hw.unitedevice.finddevice")
            reply.put(0x7F, int: 100_001)
            return [SleepFilesFakeWatch.tlvFrame(service: 0x37, command: 0x01, reply)]
        }
        try await FindWatch.send(session: h.session, caps: caps(bits: [79, 83]), log: h.log.sink, start: true)
        for _ in 0..<50 where !h.log.containsError("code=100001") { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertTrue(h.log.containsError("code=100001"))
    }
}

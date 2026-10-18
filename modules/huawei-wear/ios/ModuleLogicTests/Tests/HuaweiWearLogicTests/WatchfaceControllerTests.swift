import XCTest
@testable import HuaweiWearLogic

/// Records the upload events next to the log.
private final class UploadEvents: WearEvents, @unchecked Sendable {
    private let lock = NSLock()
    private var _progress: [(Int, Int)] = []
    private var _results: [(ok: Bool, fileName: String, code: Int?, message: String)] = []
    var progress: [(Int, Int)] { lock.locked { _progress } }
    var results: [(ok: Bool, fileName: String, code: Int?, message: String)] { lock.locked { _results } }
    func state(_ state: LinkState, error: String?) {}
    func battery(_ level: Int) {}
    func syncComplete(_ summary: SyncSummary) {}
    func log(_ entry: LogEntry) {}
    func uploadProgress(bytes: Int, total: Int) { lock.locked { _progress.append((bytes, total)) } }
    func uploadResult(ok: Bool, fileName: String, code: Int?, message: String) { lock.locked { _results.append((ok, fileName, code, message)) } }
}

/// A watch that lists two faces and answers a file info with a fixed status; everything else is silent.
private final class MiniWatch: FrameSink, @unchecked Sendable {
    private let lock = NSLock()
    private var assembler = PacketAssembler()
    private var session: HuaweiSession?
    var fileInfoStatus: Int32 = 100_000
    private(set) var received: [(UInt8, UInt8)] = []
    var faces = ["1000", "2000"]

    func attach(_ session: HuaweiSession) { lock.locked { self.session = session } }

    private func frame(_ service: UInt8, _ command: UInt8, _ tlv: HuaweiTLV) -> Bytes {
        var body = Bytes([huaweiMagic])
        let inner = Bytes([service, command]) + tlv.serialize()
        body.appendBE(UInt16(inner.count + 1))
        body.append(0)
        body += inner
        body.appendBE(CRC16.checksum(body))
        return body
    }

    func write(_ frames: [Bytes]) async throws {
        let session = lock.locked { self.session }!
        for f in frames {
            var local = lock.locked { assembler }
            let result = try local.feed(f, params: session.params)
            lock.locked { assembler = local }
            guard let packet = result.packet else { continue }
            lock.locked { received.append((packet.serviceId, packet.commandId)) }
            switch (packet.serviceId, packet.commandId) {
            case (0x27, 0x02):
                var list = HuaweiTLV()
                for (i, id) in faces.enumerated() {
                    var face = HuaweiTLV()
                    face.put(0x03, string: id)
                    face.put(0x04, string: "1.0.0")
                    face.put(0x05, byte: i == 0 ? 3 : 0)
                    list.put(0x82, tlv: face)
                }
                var t = HuaweiTLV()
                t.put(0x81, tlv: list)
                session.onData(frame(0x27, 0x02, t))
            case (0x27, 0x06):
                var names = HuaweiTLV()
                for id in lock.locked({ faces }) {
                    var n = HuaweiTLV()
                    n.put(0x04, string: id)
                    n.put(0x05, string: "Face \(id)")
                    names.put(0x83, tlv: n)
                }
                var t = HuaweiTLV()
                t.put(0x82, tlv: names)
                session.onData(frame(0x27, 0x06, t))
            case (0x27, 0x03):
                let op = try packet.tlv!.byte(0x03)
                let id = try packet.tlv!.string(0x01)
                if op == 2 { lock.locked { faces.removeAll { $0 == id } } }
                var t = HuaweiTLV()
                t.put(0x7f, int: 100_000)
                session.onData(frame(0x27, 0x03, t))
            case (0x28, 0x02):
                var t = HuaweiTLV()
                t.put(0x7f, int: fileInfoStatus)
                session.onData(frame(0x28, 0x02, t))
            default: break
            }
        }
    }
}

private final class Source: LinkHandleSource, @unchecked Sendable {
    var current: LinkHandle?
    func handle() -> LinkHandle? { current }
}

final class WatchfaceControllerTests: XCTestCase {
    private func make(connected: Bool = true) -> (WatchfaceController, UploadEvents, MiniWatch, Source) {
        let watch = MiniWatch()
        let session = HuaweiSession(sink: watch, log: { _ in })
        session.params.secretKey = Bytes(repeating: 0, count: 16)
        watch.attach(session)
        let source = Source()
        if connected { source.current = LinkHandle(address: "A", session: session, caps: DeviceCaps(), operationLock: AsyncLock()) }
        let events = UploadEvents()
        return (WatchfaceController(link: source, events: events, progressIntervalMs: 0), events, watch, source)
    }

    private func hwt() -> URL {
        let description = "<HwTheme><title>Night Run</title><author>J</author><screen>HWHD13</screen><version>2.1.0</version></HwTheme>"
        let data = Bytes(description.utf8)
        var zip = Bytes()
        func entry(_ name: String, _ content: Bytes) {
            func le16(_ v: Int) { zip.append(UInt8(v & 0xFF)); zip.append(UInt8(v >> 8)) }
            func le32(_ v: UInt32) { le16(Int(v & 0xFFFF)); le16(Int(v >> 16)) }
            le32(0x0403_4B50); le16(20); le16(0); le16(0); le16(0); le16(0x21)
            le32(CRC32.checksum(content)); le32(UInt32(content.count)); le32(UInt32(content.count))
            le16(name.utf8.count); le16(0)
            zip += Bytes(name.utf8)
            zip += content
        }
        entry("description.xml", data)
        entry("com.huawei.watchface", Bytes(repeating: 5, count: 500))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("face-\(UUID().uuidString).hwt")
        try! Data(zip).write(to: url)
        return url
    }

    func testEveryOperationNeedsAConnectedWatch() async {
        let (controller, events, _, _) = make(connected: false)
        for call in [
            { _ = try await controller.list() }, { _ = try await controller.setActive("1") }, { _ = try await controller.delete("1") },
            { _ = try await controller.install(uri: "/nonexistent") },
        ] as [() async throws -> Void] {
            do {
                try await call()
                XCTFail("expected not connected")
            } catch let e as WearError {
                XCTAssertEqual(e.code, .notConnected)
            } catch {
                XCTFail("\(error)")
            }
        }
        XCTAssertTrue(events.results.isEmpty)
    }

    func testListAndDeleteGoThroughTheWatchesAnswers() async throws {
        let (controller, _, watch, _) = make()
        let list = try await controller.list()
        XCTAssertEqual((list["faces"] as? [[String: Any]])?.map { $0["id"] as? String }, ["1000", "2000"])
        let after = try await controller.delete("2000")
        XCTAssertEqual((after["faces"] as? [[String: Any]])?.count, 1)
        XCTAssertTrue(watch.received.contains { $0 == (0x27, 0x03) })
        let entries = try await controller.entries()
        XCTAssertEqual(entries.map(\.id), ["1000"])
    }

    func testAFileThatIsNoWatchfaceFailsBeforeAnythingIsSentAndEmitsNoResult() async throws {
        let (controller, events, watch, _) = make()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("junk-\(UUID().uuidString).hwt")
        try Data(repeating: 7, count: 40).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        do {
            _ = try await controller.install(uri: url.absoluteString)
            XCTFail("expected a refusal")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .invalidArgument)
        }
        XCTAssertTrue(watch.received.isEmpty)
        XCTAssertTrue(events.results.isEmpty)
    }

    func testABadInstallNameIsRefusedBeforeTheWatchIsAsked() async throws {
        let (controller, events, watch, _) = make()
        let url = hwt()
        defer { try? FileManager.default.removeItem(at: url) }
        for name in ["noversion", "_1.0.0"] {
            do {
                _ = try await controller.install(uri: url.absoluteString, fileName: name)
                XCTFail("expected a refusal")
            } catch let e as WearError {
                XCTAssertEqual(e.code, .invalidArgument)
                XCTAssertTrue(e.message.contains("<id>_<version>"))
            }
        }
        XCTAssertTrue(watch.received.isEmpty)
        XCTAssertTrue(events.results.isEmpty)
    }

    func testARejectedInstallEmitsProgressStartAndAFailedResultWithTheWatchsCode() async throws {
        let (controller, events, watch, _) = make()
        watch.fileInfoStatus = 140_004
        let url = hwt()
        defer { try? FileManager.default.removeItem(at: url) }
        do {
            _ = try await controller.install(uri: url.absoluteString, fileName: "123_2.1.0")
            XCTFail("expected a rejection")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .uploadRejected)
            XCTAssertEqual(e.statusCode, 140_004)
        }
        XCTAssertEqual(events.progress.first?.0, 0)
        XCTAssertEqual(events.progress.first?.1, 500)
        XCTAssertEqual(events.results.count, 1)
        XCTAssertEqual(events.results[0].ok, false)
        XCTAssertEqual(events.results[0].fileName, "123_2.1.0")
        XCTAssertEqual(events.results[0].code, 140_004)
        XCTAssertTrue(events.results[0].message.contains("too many"))
    }

    func testAnOperationFailsWhenTheLinkDropsWhileItWaitsForTheLock() async throws {
        let (controller, _, _, source) = make()
        let lock = source.current!.operationLock
        await lock.acquire()
        let pending = Task { try await controller.list() }
        await sleepMs(50)
        source.current = nil
        lock.release()
        do {
            _ = try await pending.value
            XCTFail("expected not connected")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .notConnected)
        }
    }

    func testTheProgressThrottleEmitsTheFirstAndLastReportAndSpacesTheRest() async {
        let throttle = ProgressThrottle(intervalMs: 10_000)
        XCTAssertTrue(throttle.shouldEmit(done: 0, total: 100))
        XCTAssertFalse(throttle.shouldEmit(done: 10, total: 100))
        XCTAssertFalse(throttle.shouldEmit(done: 99, total: 100))
        XCTAssertTrue(throttle.shouldEmit(done: 100, total: 100))
    }
}

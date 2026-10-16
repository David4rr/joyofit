import Foundation
import XCTest
@testable import HuaweiProtocol

/// The watch side of the 0x28 upload (and the 0x27 watch face services), over the real `HuaweiSession` wire format: a `FrameSink` that
/// reassembles what the phone writes (sliced frames included), decrypts it like the watch does, hands each message to a responder and feeds
/// the answer frames back through `session.onData`. Chunk packets (28/06) are not TLV: their payload is the encrypted TLV wrapper of
/// `fileId, index, position, data`, or the plain bytes when the watch said no encryption.
final class UploadFakeWatch: FrameSink, @unchecked Sendable {
    struct Msg {
        let service: UInt8
        let command: UInt8
        let tlv: HuaweiTLV?
        /// The decrypted body of a chunk packet (`fileId, index, position, data`).
        let payload: Bytes
    }

    typealias Responder = (Msg) -> [Bytes]

    private let lock = NSLock()
    private var _messages = [Msg]()
    private var assembler = PacketAssembler()
    private var session: HuaweiSession?
    private var _framesWritten = 0
    let decryptChunks: Bool
    var responder: Responder

    init(decryptChunks: Bool = true, _ responder: @escaping Responder = { _ in [] }) {
        self.decryptChunks = decryptChunks
        self.responder = responder
    }

    func attach(_ session: HuaweiSession) {
        lock.lock()
        self.session = session
        lock.unlock()
    }

    var messages: [Msg] {
        lock.lock()
        defer { lock.unlock() }
        return _messages
    }

    var framesWritten: Int {
        lock.lock()
        defer { lock.unlock() }
        return _framesWritten
    }

    func all(_ service: UInt8, _ command: UInt8) -> [Msg] { messages.filter { $0.service == service && $0.command == command } }

    func index(_ service: UInt8, _ command: UInt8) -> Int? { messages.firstIndex { $0.service == service && $0.command == command } }

    func write(_ frames: [Bytes]) async throws {
        for f in frames { try handle(frame: f) }
    }

    private func handle(frame f: Bytes) throws {
        lock.lock()
        _framesWritten += 1
        let session = self.session
        var local = assembler
        lock.unlock()
        guard let session else { throw WearError(.notConnected, "fake watch has no session") }
        let packet: HuaweiPacket
        do {
            let result = try local.feed(f, params: session.params)
            lock.lock()
            assembler = local
            lock.unlock()
            guard let p = result.packet else { return }
            packet = p
        } catch {
            XCTFail("the phone wrote a frame the watch cannot read: \(error)")
            return
        }
        var plain = Bytes()
        if packet.serviceId == 0x28 && packet.commandId == 0x06 {
            let body = packet.payload!
            if decryptChunks {
                do {
                    plain = try HuaweiTLV(parsing: body, offset: 2, length: body.count - 2).fileDownloadDecryptRaw(params: session.params)
                } catch {
                    XCTFail("chunk does not decrypt: \(error)")
                }
            } else {
                plain = Array(body[2...])
            }
        }
        let msg = Msg(service: packet.serviceId, command: packet.commandId, tlv: packet.tlv, payload: plain)
        lock.lock()
        _messages.append(msg)
        lock.unlock()
        for response in responder(msg) { session.onData(response) }
    }

    static func tlvFrame(_ service: UInt8, _ command: UInt8, _ tlv: HuaweiTLV) -> Bytes {
        SleepFilesFakeWatch.tlvFrame(service: service, command: command, tlv)
    }
}

/// A watch that follows GB's flow for one file (the Kotlin FileUploadTest `StandardWatch`).
final class StandardUploadWatch: @unchecked Sendable {
    let file: Bytes
    let unit: Int
    let chunk: Int
    let noEncrypt: Bool
    let fileId: UInt8
    /// `reportType` of the 27/05 confirmation sent after the result; nil sends none.
    let confirmReport: Int32?
    let resultStatus: UInt8
    private let lock = NSLock()
    private(set) var received: Bytes
    private(set) var receivedBytes = 0
    var requestedEnd = 0
    private(set) var requests = [(position: Int, size: Int)]()
    private(set) var packetIndexes = [Int]()
    private(set) var nameSeen = ""

    init(
        file: Bytes, unit: Int, chunk: Int, noEncrypt: Bool = false, fileId: UInt8 = 7, confirmReport: Int32? = 2, resultStatus: UInt8 = 0
    ) {
        self.file = file
        self.unit = unit
        self.chunk = chunk
        self.noEncrypt = noEncrypt
        self.fileId = fileId
        self.confirmReport = confirmReport
        self.resultStatus = resultStatus
        self.received = Bytes(repeating: 0, count: file.count)
    }

    func nextRequest() -> [Bytes] {
        lock.lock()
        defer { lock.unlock() }
        let position = requestedEnd
        let size = min(chunk, file.count - position)
        requestedEnd = position + size
        requests.append((position, size))
        var tlv = HuaweiTLV()
        tlv.put(0x02, int: Int32(position))
        tlv.put(0x03, int: Int32(size))
        return [UploadFakeWatch.tlvFrame(0x28, 0x05, tlv)]
    }

    func respond(_ m: UploadFakeWatch.Msg) -> [Bytes] {
        switch (m.service, m.command) {
        case (0x28, 0x02):
            nameSeen = (try? m.tlv?.string(0x01)) ?? ""
            var ok = HuaweiTLV()
            ok.put(0x7f, int: 100_000)
            var id = HuaweiTLV()
            id.put(0x01, byte: fileId)
            return [UploadFakeWatch.tlvFrame(0x28, 0x02, ok), UploadFakeWatch.tlvFrame(0x28, 0x03, id)]
        case (0x28, 0x03):
            var t = HuaweiTLV()
            t.put(0x01, byte: fileId)
            t.put(0x02, string: "1.0")
            t.put(0x03, int: 5000)
            t.put(0x04, int: 0)
            t.put(0x05, int: Int32(unit))
            t.put(0x06, int: Int32(chunk))
            t.put(0x07, int: 10)
            t.put(0x08, int: 0)
            t.put(0x09, byte: noEncrypt ? 1 : 0)
            return [UploadFakeWatch.tlvFrame(0x28, 0x04, t)]
        case (0x28, 0x04):
            return nextRequest()
        case (0x28, 0x06):
            let p = m.payload
            XCTAssertEqual(p[0], fileId)
            lock.lock()
            packetIndexes.append(Int(p[1]))
            let position = Int(p.u32be(2))
            let data = Array(p[6...])
            received.replaceSubrange(position..<position + data.count, with: data)
            receivedBytes += data.count
            let done = receivedBytes
            lock.unlock()
            if done == file.count {
                var t = HuaweiTLV()
                t.put(0x02, byte: resultStatus)
                return [UploadFakeWatch.tlvFrame(0x28, 0x07, t)]
            }
            if done == requestedEnd { return nextRequest() }
            return []
        case (0x28, 0x07):
            guard let confirmReport else { return [] }
            var t = HuaweiTLV()
            let parts = javaSplit(nameSeen, separator: "_")
            t.put(0x01, string: parts[0])
            t.put(0x02, string: parts.count > 1 ? parts[1] : "")
            t.put(0x03, int: confirmReport)
            return [UploadFakeWatch.tlvFrame(0x27, 0x05, t)]
        case (0x27, 0x03):
            var t = HuaweiTLV()
            t.put(0x7f, int: 100_000)
            return [UploadFakeWatch.tlvFrame(0x27, 0x03, t)]
        default:
            return []
        }
    }
}

/// Records every `onProgress` call.
final class ProgressRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var _values = [(Int, Int)]()

    var callback: @Sendable (Int, Int) -> Void {
        { [self] done, total in
            lock.lock()
            _values.append((done, total))
            lock.unlock()
        }
    }

    var values: [(Int, Int)] {
        lock.lock()
        defer { lock.unlock() }
        return _values
    }
}

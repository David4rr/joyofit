import Foundation
import XCTest
@testable import HuaweiProtocol

/// Collects what the protocol layers log (`LogSink`), thread-safe.
final class SleepFilesLogCollector: @unchecked Sendable {
    private let lock = NSLock()
    private var _entries = [LogEntry]()

    var sink: LogSink {
        { [self] entry in
            lock.lock()
            _entries.append(entry)
            lock.unlock()
        }
    }

    var entries: [LogEntry] {
        lock.lock()
        defer { lock.unlock() }
        return _entries
    }

    var messages: [String] { entries.map { $0.message } }

    func contains(_ fragment: String) -> Bool { messages.contains { $0.contains(fragment) } }

    func containsError(_ fragment: String) -> Bool { entries.contains { $0.direction == .error && $0.message.contains(fragment) } }
}

/// The watch side of the file download services, over the real `HuaweiSession` wire format: a `FrameSink` that reassembles what the
/// phone writes (decrypting TLVs with the session's key like the watch does), hands each request to a responder and feeds the answer
/// frames back through `session.onData`. The two `Server` classes answer the 0x2C (new sync) and 0x0A (old sync) protocols for given
/// file contents, the way the Kotlin FileDownloadTest's inline watches do (and with the SHA-256 the file hash request would carry).
final class SleepFilesFakeWatch: FrameSink, @unchecked Sendable {
    struct Request {
        let service: UInt8
        let command: UInt8
        let tlv: HuaweiTLV
        /// The TLV arrived as `7C/7D/7E` on the wire and was decrypted.
        let encrypted: Bool
    }

    typealias Responder = (Request) -> [Bytes]

    private let lock = NSLock()
    private var _requests = [Request]()
    private var assembler = PacketAssembler()
    private var session: HuaweiSession?
    var responder: Responder

    init(_ responder: @escaping Responder = { _ in [] }) {
        self.responder = responder
    }

    func attach(_ session: HuaweiSession) {
        lock.lock()
        self.session = session
        lock.unlock()
    }

    var requests: [Request] {
        lock.lock()
        defer { lock.unlock() }
        return _requests
    }

    func count(_ service: UInt8, _ command: UInt8) -> Int {
        requests.filter { $0.service == service && $0.command == command }.count
    }

    func write(_ frames: [Bytes]) async throws {
        for f in frames { try handle(frame: f) }
    }

    /// One written frame: reassemble, record, answer. Synchronous so the locks never span a suspension point.
    private func handle(frame f: Bytes) throws {
        lock.lock()
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
        let request = Request(service: packet.serviceId, command: packet.commandId, tlv: packet.tlv ?? HuaweiTLV(), encrypted: packet.isEncrypted)
        lock.lock()
        _requests.append(request)
        lock.unlock()
        for response in responder(request) { session.onData(response) }
    }

    // MARK: frames

    /// An unsliced wire frame: magic, length, 0, service, command, body, CRC16.
    static func frame(service: UInt8, command: UInt8, body: Bytes) -> Bytes {
        var buffer = Bytes([huaweiMagic])
        buffer.appendBE(UInt16(2 + body.count + 1))
        buffer.append(0x00)
        buffer.append(service)
        buffer.append(command)
        buffer += body
        buffer.appendBE(CRC16.checksum(buffer))
        return buffer
    }

    static func tlvFrame(service: UInt8, command: UInt8, _ tlv: HuaweiTLV) -> Bytes {
        frame(service: service, command: command, body: tlv.serialize())
    }

    static func be32(_ v: Int) -> Bytes {
        var b = Bytes()
        b.appendBE(UInt32(truncatingIfNeeded: v))
        return b
    }

    // MARK: 0x2C

    /// Watch side of the new sync: init (0x01), hash (0x02), info (0x03), block request (0x04, answered by pushing 0x05 packets),
    /// complete (0x06).
    final class NewSyncServer {
        struct File {
            var name: String
            var typeByte: UInt8
            var fileId: UInt8
            var content: Bytes
        }

        var files: [File]
        let params: ParamsProvider
        /// What the watch allows per block request.
        var maxBlockSize = 4096
        /// Data bytes per pushed 0x05 packet.
        var burst = 200
        /// Seconds the phone waits for the next packet of a block.
        var timeout: UInt8 = 5
        /// Tells the phone not to encrypt its block requests; the pushed data is encrypted only if `encryptBlocks` says so.
        var noEncrypt = true
        var encryptBlocks = false
        /// The size reported for a file that is not served (GB: the watch answers 0xFFFFFFFF).
        var missingFileSize: Int32 = -1
        /// Push nothing after a block request.
        var silent = false
        /// Overrides for misbehaving watches.
        var dataFileId: UInt8?
        var dataOffsetShift = 0
        var initFileName: String?
        var infoFileId: UInt8?
        var reportedMaxBlockSize: Int32?
        var reportedSize: Int32?
        /// Block requests seen: (offset, size).
        private(set) var blockRequests: [(offset: Int, size: Int)] = []

        init(files: [File], params: ParamsProvider) {
            self.files = files
            self.params = params
        }

        private func file(id: UInt8) -> File? { files.first { $0.fileId == id } }

        func respond(_ r: Request) -> [Bytes] {
            guard r.service == 0x2c else { return [] }
            switch r.command {
            case 0x01:
                let name = (try? r.tlv.string(0x01)) ?? ""
                var out = HuaweiTLV()
                if let f = files.first(where: { $0.name == name }) {
                    out.put(0x01, string: initFileName ?? f.name)
                    out.put(0x02, byte: f.typeByte)
                    out.put(0x03, byte: f.fileId)
                    out.put(0x04, int: reportedSize ?? Int32(f.content.count))
                } else {
                    out.put(0x01, string: name)
                    out.put(0x02, byte: (try? UInt8(bitPattern: r.tlv.byte(0x02))) ?? 0)
                    out.put(0x03, byte: 0)
                    out.put(0x04, int: missingFileSize)
                }
                return [tlvFrame(service: 0x2c, command: 0x01, out)]
            case 0x02:
                guard let id = (try? UInt8(bitPattern: r.tlv.byte(0x01))), let f = file(id: id) else { return [] }
                var out = HuaweiTLV()
                out.put(0x01, byte: f.fileId)
                out.put(0x03, bytes: SHA256.hash(f.content))
                return [tlvFrame(service: 0x2c, command: 0x02, out)]
            case 0x03:
                guard let id = (try? UInt8(bitPattern: r.tlv.byte(0x01))) else { return [] }
                var out = HuaweiTLV()
                out.put(0x01, byte: infoFileId ?? id)
                out.put(0x02, byte: timeout)
                out.put(0x03, short: Int16(burst))
                out.put(0x04, int: reportedMaxBlockSize ?? Int32(maxBlockSize))
                out.put(0x05, bool: noEncrypt)
                return [tlvFrame(service: 0x2c, command: 0x03, out)]
            case 0x04:
                guard let id = (try? UInt8(bitPattern: r.tlv.byte(0x01))), let f = file(id: id),
                      let offset = (try? Int(r.tlv.int(0x02))), let size = (try? Int(r.tlv.int(0x03))) else { return [] }
                blockRequests.append((offset, size))
                if silent { return [] }
                var frames = [Bytes]()
                var pos = offset
                while pos < offset + size {
                    let end = min(pos + burst, offset + size)
                    var body = Bytes([dataFileId ?? f.fileId]) + SleepFilesFakeWatch.be32(pos + dataOffsetShift) + [0]
                    body += f.content[pos..<end]
                    if encryptBlocks, let wrapped = try? HuaweiTLV.encryptRaw(params: params, data: body) { body = wrapped.serialize() }
                    frames.append(SleepFilesFakeWatch.frame(service: 0x2c, command: 0x05, body: body))
                    pos = end
                }
                return frames
            default:
                return []
            }
        }
    }

    // MARK: 0x0A

    /// Watch side of the old sync: init with a file list (0x01), parameters (0x02), info (0x03), block request (0x04, answered by
    /// pushing numbered 0x05 packets), complete (0x06).
    final class OldSyncServer {
        var files: [String: Bytes]
        /// The file list the init answers with, in order (also what `files` does not hold).
        var listing: [String]
        let params: ParamsProvider
        var maxBlockSize: Int16 = 4096
        var timeout: Int16 = 5
        /// Data bytes per pushed 0x05 packet.
        var burst = 100
        /// Encrypt each packet's TLV like the real watch; false pushes the number and data as they are.
        var encryptBlocks = true
        var silent = false
        /// Added to every packet number (a watch that skips or repeats numbers).
        var numberShift = 0
        private(set) var blockRequests: [(name: String, offset: Int, size: Int)] = []
        private(set) var parametersFileTypes: [UInt8] = []

        init(files: [String: Bytes], listing: [String]? = nil, params: ParamsProvider) {
            self.files = files
            self.listing = listing ?? files.keys.sorted()
            self.params = params
        }

        func respond(_ r: Request) -> [Bytes] {
            guard r.service == 0x0a else { return [] }
            switch r.command {
            case 0x01:
                var out = HuaweiTLV()
                let kind = (try? r.tlv.byte(0x02)) ?? 0
                let names = listing.joined(separator: ";")
                if kind == 2 { // GPS: the list sits in 0x8b / 0x8c / 0x0d
                    var inner = HuaweiTLV()
                    inner.put(0x0d, string: names)
                    var mid = HuaweiTLV()
                    mid.put(0x8c, tlv: inner)
                    out.put(0x8b, tlv: mid)
                } else {
                    out.put(0x01, string: names)
                }
                return [tlvFrame(service: 0x0a, command: 0x01, out)]
            case 0x02:
                parametersFileTypes.append((try? UInt8(bitPattern: r.tlv.byte(0x06))) ?? 0)
                var out = HuaweiTLV()
                out.put(0x01, string: "v1")
                out.put(0x02, bool: true)
                out.put(0x03, short: 100)
                out.put(0x04, short: maxBlockSize)
                out.put(0x05, short: timeout)
                return [tlvFrame(service: 0x0a, command: 0x02, out)]
            case 0x03:
                let name = (try? r.tlv.string(0x01)) ?? ""
                var out = HuaweiTLV()
                out.put(0x02, int: Int32(files[name]?.count ?? 0))
                return [tlvFrame(service: 0x0a, command: 0x03, out)]
            case 0x04:
                guard let name = try? r.tlv.string(0x01), let content = files[name],
                      let offset = (try? Int(r.tlv.int(0x02))), let size = (try? Int(r.tlv.int(0x03))) else { return [] }
                blockRequests.append((name, offset, size))
                if silent { return [] }
                var frames = [Bytes]()
                var number = 0
                var pos = offset
                while pos < offset + size {
                    let end = min(pos + burst, offset + size)
                    var body = Bytes([UInt8(truncatingIfNeeded: number + numberShift)]) + content[pos..<end]
                    if encryptBlocks, let wrapped = try? HuaweiTLV.encryptRaw(params: params, data: body) { body = wrapped.serialize() }
                    frames.append(SleepFilesFakeWatch.frame(service: 0x0a, command: 0x05, body: body))
                    number += 1
                    pos = end
                }
                return frames
            default:
                return []
            }
        }
    }
}

/// A session wired to a fake watch: the secret key is set directly (encryptMethod 0, so AES-CBC for TLVs; no authentication) and
/// the watch decrypts requests with it.
struct SleepFilesHarness {
    let watch: SleepFilesFakeWatch
    let session: HuaweiSession
    let log: SleepFilesLogCollector

    init(key: Bytes = Bytes(repeating: 0, count: 16), encryptMethod: UInt8 = 0, deviceSupportType: UInt8 = 1) {
        log = SleepFilesLogCollector()
        watch = SleepFilesFakeWatch()
        session = HuaweiSession(sink: watch, log: log.sink)
        session.params.secretKey = key
        session.params.encryptMethod = encryptMethod
        session.params.deviceSupportType = deviceSupportType
        watch.attach(session)
    }

    func newSyncServer(_ files: [SleepFilesFakeWatch.NewSyncServer.File]) -> SleepFilesFakeWatch.NewSyncServer {
        let server = SleepFilesFakeWatch.NewSyncServer(files: files, params: session.params)
        watch.responder = server.respond
        return server
    }

    func oldSyncServer(_ files: [String: Bytes], listing: [String]? = nil) -> SleepFilesFakeWatch.OldSyncServer {
        let server = SleepFilesFakeWatch.OldSyncServer(files: files, listing: listing, params: session.params)
        watch.responder = server.respond
        return server
    }
}

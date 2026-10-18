// A ZIP reader for archives that do not fit in memory: it reads the central directory (ZIP64 included), then streams one member at a time,
// decrypting (WinZip AES-128/192/256 with its password check and authentication code, or the PKWARE traditional cipher) and inflating chunk by
// chunk into a sink. The counterpart of what zip4j gives the Android import. `ZipReader` (the forward-only in-memory reader of watch faces) is
// unrelated; this one never holds more than a few hundred KiB of a member.
//
// Not supported, as in zip4j: split archives, Deflate64, bzip2/LZMA members, the strong encryption of PKWARE's SES.
import Foundation

public enum ZipError: Error, Equatable, CustomStringConvertible {
    /// Not a ZIP file, or its directory is unreadable.
    case notAZip(String)
    case unsupported(String)
    case wrongPassword
    /// The archive has encrypted members and no password was given.
    case passwordRequired
    /// A member is damaged: bad deflate data, a size or CRC that does not match, a failed authentication code.
    case corrupt(String)
    case io(String)

    public var description: String {
        switch self {
        case .notAZip(let m): return "not a ZIP file: \(m)"
        case .unsupported(let m): return "unsupported ZIP feature: \(m)"
        case .wrongPassword: return "wrong ZIP password"
        case .passwordRequired: return "the ZIP is encrypted and needs a password"
        case .corrupt(let m): return "damaged ZIP member: \(m)"
        case .io(let m): return "could not read the ZIP: \(m)"
        }
    }
}

/// Random access to the bytes of an archive.
public protocol ZipByteSource: AnyObject {
    var size: UInt64 { get }
    /// Up to `count` bytes at `offset`; fewer only at the end of the data.
    func read(at offset: UInt64, count: Int) throws -> Bytes
}

public final class MemoryZipSource: ZipByteSource {
    private let data: Bytes

    public init(_ data: Bytes) { self.data = data }

    public var size: UInt64 { UInt64(data.count) }

    public func read(at offset: UInt64, count: Int) throws -> Bytes {
        guard offset < UInt64(data.count) else { return [] }
        let start = Int(offset)
        return Array(data[start..<min(data.count, start + count)])
    }
}

/// An archive on disk, read with `pread`: nothing is copied and several GB cost nothing until they are read.
public final class FileZipSource: ZipByteSource {
    private let descriptor: Int32
    public let size: UInt64

    public init(path: String) throws {
        let fd = open(path, O_RDONLY)
        guard fd >= 0 else { throw ZipError.io(String(cString: strerror(errno))) }
        var info = stat()
        guard fstat(fd, &info) == 0 else {
            let message = String(cString: strerror(errno))
            close(fd)
            throw ZipError.io(message)
        }
        guard (info.st_mode & S_IFMT) == S_IFREG else {
            close(fd)
            throw ZipError.notAZip("not a regular file")
        }
        descriptor = fd
        size = UInt64(max(0, Int64(info.st_size)))
    }

    deinit { close(descriptor) }

    public func read(at offset: UInt64, count: Int) throws -> Bytes {
        guard offset < size, count > 0 else { return [] }
        let wanted = Int(min(UInt64(count), size - offset))
        var out = Bytes(repeating: 0, count: wanted)
        var done = 0
        while done < wanted {
            let n = out.withUnsafeMutableBytes { pread(descriptor, $0.baseAddress! + done, wanted - done, off_t(offset) + off_t(done)) }
            if n < 0 {
                if errno == EINTR { continue }
                throw ZipError.io(String(cString: strerror(errno)))
            }
            if n == 0 { break }
            done += n
        }
        if done < wanted { out.removeLast(wanted - done) }
        return out
    }
}

public enum ZipEncryption: Equatable, Sendable {
    case none
    /// PKWARE traditional ("ZipCrypto").
    case traditional
    /// WinZip AES: `strength` 1, 2, 3 for 128, 192, 256 bits; `version` 1 (AE-1, CRC kept) or 2 (AE-2, CRC zeroed).
    case aes(strength: Int, version: Int)
}

public struct ZipEntry: Equatable, Sendable {
    public let name: String
    public let isDirectory: Bool
    public let size: UInt64
    public let compressedSize: UInt64
    public let crc: UInt32
    /// 0 stored, 8 deflated (for AES members the method hidden behind 99).
    public let method: Int
    public let encryption: ZipEncryption
    let flags: UInt16
    let dosTime: UInt16
    let localOffset: UInt64

    public var isEncrypted: Bool { encryption != .none }
}

public final class ZipArchive {
    public private(set) var entries: [ZipEntry] = []
    private let source: ZipByteSource
    private let chunkBytes: Int

    /// `chunkBytes` is how much of a member is read from the source at a time.
    public init(source: ZipByteSource, chunkBytes: Int = 64 * 1024) throws {
        self.source = source
        self.chunkBytes = max(1, chunkBytes)
        try readDirectory()
    }

    // MARK: central directory

    private func readDirectory() throws {
        let size = source.size
        guard size >= 22 else { throw ZipError.notAZip("the file is too short") }
        let tailLength = Int(min(size, 22 + 65_535))
        let tailStart = size - UInt64(tailLength)
        let tail = try source.read(at: tailStart, count: tailLength)
        guard tail.count == tailLength else { throw ZipError.io("short read at the end of the file") }
        var eocd: Int?
        var i = tail.count - 22
        while i >= 0 {
            if tail[i] == 0x50, tail[i + 1] == 0x4B, tail[i + 2] == 0x05, tail[i + 3] == 0x06 {
                eocd = i
                break
            }
            i -= 1
        }
        guard let eocd else { throw ZipError.notAZip("no end of central directory") }
        var disk = UInt32(tail.u16le(eocd + 4))
        var cdDisk = UInt32(tail.u16le(eocd + 6))
        var total = UInt64(tail.u16le(eocd + 10))
        var cdSize = UInt64(tail.u32le(eocd + 12))
        var cdOffset = UInt64(tail.u32le(eocd + 16))
        if total == 0xFFFF || cdSize == 0xFFFF_FFFF || cdOffset == 0xFFFF_FFFF {
            let eocdPosition = tailStart + UInt64(eocd)
            if eocdPosition >= 20 {
                let locator = try source.read(at: eocdPosition - 20, count: 20)
                if locator.count == 20, locator.u32le(0) == 0x0706_4B50 {
                    let record = try source.read(at: locator.u64le(8), count: 56)
                    guard record.count == 56, record.u32le(0) == 0x0606_4B50 else { throw ZipError.notAZip("bad ZIP64 end of central directory") }
                    disk = record.u32le(16)
                    cdDisk = record.u32le(20)
                    total = record.u64le(32)
                    cdSize = record.u64le(40)
                    cdOffset = record.u64le(48)
                }
            }
        }
        guard disk == 0, cdDisk == 0 else { throw ZipError.unsupported("split archives") }
        guard cdOffset <= size, cdSize <= size - cdOffset else { throw ZipError.notAZip("the central directory lies outside the file") }
        guard cdSize <= 256 * 1024 * 1024 else { throw ZipError.notAZip("the central directory is too large") }
        let directory = try source.read(at: cdOffset, count: Int(cdSize))
        guard directory.count == Int(cdSize) else { throw ZipError.io("short read of the central directory") }

        var byName = [String: Int]()
        var out = [ZipEntry]()
        var p = 0
        var index: UInt64 = 0
        while p + 46 <= directory.count, index < total || total == 0xFFFF {
            guard directory.u32le(p) == 0x0201_4B50 else { break }
            let flags = directory.u16le(p + 8)
            let method = Int(directory.u16le(p + 10))
            let dosTime = directory.u16le(p + 12)
            let crc = directory.u32le(p + 16)
            var compressed = UInt64(directory.u32le(p + 20))
            var uncompressed = UInt64(directory.u32le(p + 24))
            let nameLength = Int(directory.u16le(p + 28))
            let extraLength = Int(directory.u16le(p + 30))
            let commentLength = Int(directory.u16le(p + 32))
            var offset = UInt64(directory.u32le(p + 42))
            let next = p + 46 + nameLength + extraLength + commentLength
            guard next <= directory.count else { throw ZipError.notAZip("a central directory entry is cut off") }
            let name = String(decoding: directory[(p + 46)..<(p + 46 + nameLength)], as: UTF8.self)

            var aes: (strength: Int, version: Int, method: Int)?
            var e = p + 46 + nameLength
            let extraEnd = e + extraLength
            while e + 4 <= extraEnd {
                let id = directory.u16le(e)
                let length = Int(directory.u16le(e + 2))
                let body = e + 4
                guard body + length <= extraEnd else { break }
                if id == 0x0001 {
                    var f = body
                    func take() -> UInt64? {
                        guard f + 8 <= body + length else { return nil }
                        defer { f += 8 }
                        return directory.u64le(f)
                    }
                    if uncompressed == 0xFFFF_FFFF, let v = take() { uncompressed = v }
                    if compressed == 0xFFFF_FFFF, let v = take() { compressed = v }
                    if offset == 0xFFFF_FFFF, let v = take() { offset = v }
                } else if id == 0x9901, length >= 7 {
                    aes = (Int(directory[body + 4]), Int(directory.u16le(body)), Int(directory.u16le(body + 5)))
                }
                e = body + length
            }

            var realMethod = method
            var encryption = ZipEncryption.none
            if method == 99 {
                guard let aes, (1...3).contains(aes.strength) else { throw ZipError.unsupported("an AES member without valid AES data") }
                realMethod = aes.method
                encryption = .aes(strength: aes.strength, version: aes.version)
            } else if flags & 1 != 0 {
                guard flags & 0x40 == 0 else { throw ZipError.unsupported("strong encryption (PKWARE SES)") }
                encryption = .traditional
            }
            let isDirectory = name.hasSuffix("/") || name.hasSuffix("\\")
            let entry = ZipEntry(
                name: name, isDirectory: isDirectory, size: uncompressed, compressedSize: compressed, crc: crc, method: realMethod,
                encryption: encryption, flags: flags, dosTime: dosTime, localOffset: offset
            )
            // A later member of the same name replaces an earlier one but keeps its place, as a LinkedHashMap does.
            if let existing = byName[name] {
                out[existing] = entry
            } else {
                byName[name] = out.count
                out.append(entry)
            }
            p = next
            index += 1
        }
        entries = out
    }

    // MARK: member data

    /// The decrypted, still compressed bytes of one member, a chunk at a time; `finish()` checks the authentication code.
    private final class Payload {
        let source: ZipByteSource
        let chunkBytes: Int
        var position: UInt64
        var remaining: UInt64
        var ctr: ZipAESCTR?
        var mac: HMACSHA1Stream?
        var traditional: ZipCryptoCipher?
        var expectedMac = Bytes()
        let macOffset: UInt64

        init(source: ZipByteSource, chunkBytes: Int, position: UInt64, length: UInt64) {
            self.source = source
            self.chunkBytes = chunkBytes
            self.position = position
            remaining = length
            macOffset = position + length
        }

        func next() throws -> Bytes? {
            guard remaining > 0 else { return nil }
            let want = Int(min(remaining, UInt64(chunkBytes)))
            var chunk = try source.read(at: position, count: want)
            guard chunk.count == want else { throw ZipError.corrupt("the member is cut off") }
            position += UInt64(want)
            remaining -= UInt64(want)
            if ctr != nil {
                mac!.update(chunk)
                ctr!.apply(&chunk)
            } else if traditional != nil {
                traditional!.decrypt(&chunk)
            }
            return chunk
        }

        /// Reads whatever the inflater left (the stream may end before the member's last byte) and checks the authentication code.
        func finish() throws {
            while try next() != nil {}
            if let mac {
                let stored = try source.read(at: macOffset, count: 10)
                guard stored.count == 10, stored == Array(mac.finalized().prefix(10)) else {
                    throw ZipError.corrupt("the AES authentication code does not match")
                }
            }
        }
    }

    private func openPayload(_ entry: ZipEntry, password: Bytes) throws -> Payload {
        let header = try source.read(at: entry.localOffset, count: 30)
        guard header.count == 30, header.u32le(0) == 0x0403_4B50 else { throw ZipError.corrupt("bad local header of \(entry.name)") }
        let dataStart = entry.localOffset + 30 + UInt64(header.u16le(26)) + UInt64(header.u16le(28))
        guard dataStart <= source.size, entry.compressedSize <= source.size - dataStart else { throw ZipError.corrupt("\(entry.name) lies outside the file") }

        switch entry.encryption {
        case .none:
            return Payload(source: source, chunkBytes: chunkBytes, position: dataStart, length: entry.compressedSize)
        case .traditional:
            guard !password.isEmpty else { throw ZipError.passwordRequired }
            guard entry.compressedSize >= 12 else { throw ZipError.corrupt("the encryption header is cut off") }
            var cipher = ZipCryptoCipher(password: password)
            var head = try source.read(at: dataStart, count: 12)
            guard head.count == 12 else { throw ZipError.corrupt("the encryption header is cut off") }
            cipher.decrypt(&head)
            let crcCheck = UInt8(truncatingIfNeeded: entry.crc >> 24)
            let timeCheck = UInt8(truncatingIfNeeded: entry.dosTime >> 8)
            // With a data descriptor (bit 3) writers put the high byte of the time there instead of the CRC.
            let ok = entry.flags & 8 != 0 ? (head[11] == timeCheck || head[11] == crcCheck) : head[11] == crcCheck
            guard ok else { throw ZipError.wrongPassword }
            let payload = Payload(source: source, chunkBytes: chunkBytes, position: dataStart + 12, length: entry.compressedSize - 12)
            payload.traditional = cipher
            return payload
        case .aes(let strength, _):
            guard !password.isEmpty else { throw ZipError.passwordRequired }
            let saltLength = [8, 12, 16][strength - 1]
            let keyLength = [16, 24, 32][strength - 1]
            guard entry.compressedSize >= UInt64(saltLength + 2 + 10) else { throw ZipError.corrupt("the AES header is cut off") }
            let head = try source.read(at: dataStart, count: saltLength + 2)
            guard head.count == saltLength + 2 else { throw ZipError.corrupt("the AES header is cut off") }
            let derived = PBKDF2SHA1.derive(password: password, salt: Array(head[0..<saltLength]), iterations: 1000, length: 2 * keyLength + 2)
            guard Array(derived[(2 * keyLength)...]) == Array(head[saltLength...]) else { throw ZipError.wrongPassword }
            let payload = Payload(
                source: source, chunkBytes: chunkBytes, position: dataStart + UInt64(saltLength + 2), length: entry.compressedSize - UInt64(saltLength + 2 + 10)
            )
            payload.ctr = try ZipAESCTR(key: Array(derived[0..<keyLength]))
            payload.mac = HMACSHA1Stream(key: Array(derived[keyLength..<(2 * keyLength)]))
            return payload
        }
    }

    /// Reads the member's header and checks the password against it, without reading any data. Members without encryption always pass.
    public func checkPassword(_ entry: ZipEntry, password: Bytes) throws {
        _ = try openPayload(entry, password: password)
    }

    /// Streams the member's content into `sink`, in chunks. Errors the sink throws come out unchanged; the archive's own failures are `ZipError`
    /// (a damaged member, a CRC or size that does not match, a failed authentication code).
    public func extract(_ entry: ZipEntry, password: Bytes = [], sink: (Bytes) throws -> Void) throws {
        try withoutActuallyEscaping(sink) { try extractStreaming(entry, password: password, sink: $0) }
    }

    private func extractStreaming(_ entry: ZipEntry, password: Bytes, sink: @escaping (Bytes) throws -> Void) throws {
        guard !entry.isDirectory else { return }
        let payload = try openPayload(entry, password: password)
        var crc = RunningCRC32()
        var produced: UInt64 = 0
        let checked: (Bytes) throws -> Void = { chunk in
            crc.update(chunk)
            produced += UInt64(chunk.count)
            try sink(chunk)
        }
        switch entry.method {
        case 0:
            guard payload.remaining == entry.size else { throw ZipError.corrupt("\(entry.name): stored sizes differ") }
            while let chunk = try payload.next() { try checked(chunk) }
        case 8:
            do {
                try StreamInflater(pull: { try payload.next() }, limit: entry.size, sink: checked).run()
            } catch let e as InflateError {
                throw ZipError.corrupt("\(entry.name): \(e)")
            }
        default:
            throw ZipError.unsupported("compression method \(entry.method) of \(entry.name)")
        }
        try payload.finish()
        guard produced == entry.size else { throw ZipError.corrupt("\(entry.name): \(produced) bytes instead of \(entry.size)") }
        if case .aes(_, let version) = entry.encryption, version == 2 { return }
        guard crc.checksum == entry.crc else { throw ZipError.corrupt("\(entry.name): the CRC does not match") }
    }
}

extension Array where Element == UInt8 {
    func u64le(_ o: Int) -> UInt64 { UInt64(u32le(o)) | UInt64(u32le(o + 4)) << 32 }
}

/// RFC 1951 inflate over a pull source, writing through a sliding window into a sink; the streaming sibling of `Inflate.inflate` (same tables,
/// same checks). Output beyond `limit` bytes is an error, which bounds a zip bomb by the size the directory declares.
final class StreamInflater {
    private static let capacity = 128 * 1024
    private static let history = 32 * 1024

    private let pull: () throws -> Bytes?
    private let sink: (Bytes) throws -> Void
    private let limit: UInt64
    private var total: UInt64 = 0

    private var chunk = Bytes()
    private var chunkPosition = 0
    private var bitBuffer: UInt64 = 0
    private var bitCount = 0

    private let window: UnsafeMutablePointer<UInt8>
    private var filled = 0
    private var flushed = 0

    init(pull: @escaping () throws -> Bytes?, limit: UInt64, sink: @escaping (Bytes) throws -> Void) {
        self.pull = pull
        self.sink = sink
        self.limit = limit
        window = UnsafeMutablePointer<UInt8>.allocate(capacity: StreamInflater.capacity)
        window.initialize(repeating: 0, count: StreamInflater.capacity)
    }

    deinit { window.deallocate() }

    func run() throws {
        var final = false
        while !final {
            final = try bits(1) == 1
            switch try bits(2) {
            case 0: try stored()
            case 1: try block(Inflate.fixedLiteral, Inflate.fixedDistance)
            case 2: try dynamic()
            default: throw InflateError.invalid("reserved block type")
            }
        }
        try flush(final: true)
    }

    // MARK: bits

    private func fill() throws {
        while bitCount <= 56 {
            if chunkPosition < chunk.count {
                bitBuffer |= UInt64(chunk[chunkPosition]) << UInt64(bitCount)
                chunkPosition += 1
                bitCount += 8
            } else {
                guard let next = try pull(), !next.isEmpty else { return }
                chunk = next
                chunkPosition = 0
            }
        }
    }

    private func bits(_ n: Int) throws -> Int {
        if n == 0 { return 0 }
        if bitCount < n { try fill() }
        guard bitCount >= n else { throw InflateError.truncated }
        let v = Int(bitBuffer & ((1 << UInt64(n)) - 1))
        bitBuffer >>= UInt64(n)
        bitCount -= n
        return v
    }

    private func symbol(_ table: Inflate.Table) throws -> Int {
        if bitCount < table.maxBits { try fill() }
        let entry = table.entries[Int(bitBuffer & ((1 << UInt64(table.maxBits)) - 1))]
        let len = Int(entry & 15)
        guard len > 0 else {
            if bitCount < table.maxBits { throw InflateError.truncated }
            throw InflateError.invalid("unused Huffman code")
        }
        guard bitCount >= len else { throw InflateError.truncated }
        bitBuffer >>= UInt64(len)
        bitCount -= len
        return Int(entry >> 4)
    }

    // MARK: output

    /// Hands what was produced since the last flush to the sink and keeps the last 32 KiB as the window for back references.
    private func flush(final: Bool) throws {
        if filled > flushed {
            try sink(Bytes(UnsafeBufferPointer(start: window + flushed, count: filled - flushed)))
        }
        if final { return }
        if filled > StreamInflater.history {
            window.update(from: window + (filled - StreamInflater.history), count: StreamInflater.history)
            filled = StreamInflater.history
        }
        flushed = filled
    }

    @inline(__always) private func room(_ count: Int) throws {
        total += UInt64(count)
        if total > limit { throw InflateError.tooLarge }
        if filled + count > StreamInflater.capacity { try flush(final: false) }
    }

    // MARK: blocks

    private func stored() throws {
        let drop = bitCount % 8
        bitBuffer >>= UInt64(drop)
        bitCount -= drop
        let len = try bits(16)
        let nlen = try bits(16)
        guard len == (~nlen & 0xFFFF) else { throw InflateError.invalid("stored block length check failed") }
        var remaining = len
        while remaining > 0 {
            if bitCount >= 8 {
                try room(1)
                window[filled] = UInt8(truncatingIfNeeded: try bits(8))
                filled += 1
                remaining -= 1
            } else if chunkPosition < chunk.count {
                let take = min(remaining, chunk.count - chunkPosition)
                try room(take)
                chunk.withUnsafeBufferPointer { p in
                    (window + filled).update(from: p.baseAddress! + chunkPosition, count: take)
                }
                filled += take
                chunkPosition += take
                remaining -= take
            } else {
                guard let next = try pull(), !next.isEmpty else { throw InflateError.truncated }
                chunk = next
                chunkPosition = 0
            }
        }
    }

    private func dynamic() throws {
        let nlen = try bits(5) + 257
        let ndist = try bits(5) + 1
        let ncode = try bits(4) + 4
        guard nlen <= 286, ndist <= 30 else { throw InflateError.invalid("too many length or distance codes") }
        var lengths = [UInt8](repeating: 0, count: 19)
        for i in 0..<ncode { lengths[Inflate.codeLengthOrder[i]] = UInt8(try bits(3)) }
        let codeTable = try Inflate.Table(lengths: lengths)
        var all = [UInt8]()
        all.reserveCapacity(nlen + ndist)
        while all.count < nlen + ndist {
            let sym = try symbol(codeTable)
            if sym < 16 {
                all.append(UInt8(sym))
                continue
            }
            var repeatValue: UInt8 = 0
            let times: Int
            switch sym {
            case 16:
                guard let last = all.last else { throw InflateError.invalid("repeat with no previous length") }
                repeatValue = last
                times = 3 + (try bits(2))
            case 17: times = 3 + (try bits(3))
            default: times = 11 + (try bits(7))
            }
            guard all.count + times <= nlen + ndist else { throw InflateError.invalid("too many code lengths") }
            all += [UInt8](repeating: repeatValue, count: times)
        }
        guard all[256] != 0 else { throw InflateError.invalid("no end-of-block code") }
        try block(try Inflate.Table(lengths: Array(all[0..<nlen])), try Inflate.Table(lengths: Array(all[nlen...])))
    }

    private func block(_ literal: Inflate.Table, _ distance: Inflate.Table) throws {
        while true {
            let sym = try symbol(literal)
            if sym < 256 {
                try room(1)
                window[filled] = UInt8(truncatingIfNeeded: sym)
                filled += 1
            } else if sym == 256 {
                return
            } else {
                let index = sym - 257
                guard index < Inflate.lengthBase.count else { throw InflateError.invalid("bad length symbol") }
                let length = Inflate.lengthBase[index] + (try bits(Inflate.lengthExtra[index]))
                let dsym = try symbol(distance)
                guard dsym < Inflate.distBase.count else { throw InflateError.invalid("bad distance symbol") }
                let dist = Inflate.distBase[dsym] + (try bits(Inflate.distExtra[dsym]))
                guard dist <= filled else { throw InflateError.invalid("distance too far back") }
                // A flush inside `room` keeps the last 32 KiB, so the distance still reaches back that far.
                try room(length)
                var from = filled - dist
                for _ in 0..<length {
                    window[filled] = window[from]
                    filled += 1
                    from += 1
                }
            }
        }
    }
}

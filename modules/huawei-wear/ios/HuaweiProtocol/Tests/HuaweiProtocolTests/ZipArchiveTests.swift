import Foundation
import XCTest
@testable import HuaweiProtocol

// MARK: test archive writer

/// Writes ZIPs for the tests: stored members (optionally encrypted with the WinZip AES or the traditional cipher), a central directory, optionally
/// in ZIP64 form. Deflated members come from zip4j (Fixtures/importZip.json); this writer exists for the shapes zip4j will not produce.
enum TestExportZip {
    enum Encryption {
        case none
        case aes(strength: Int, version: Int)
        case traditional(dataDescriptor: Bool)
    }

    struct Member {
        var name: String
        var data: Bytes
        var encryption: Encryption = .none
        /// Raw deflate stream stored instead of `data` (method 8); `data` is then what it inflates to.
        var deflated: Bytes?
    }

    static func le16(_ v: Int) -> Bytes { [UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF)] }
    static func le32(_ v: UInt32) -> Bytes { le16(Int(v & 0xFFFF)) + le16(Int(v >> 16)) }
    static func le64(_ v: UInt64) -> Bytes { le32(UInt32(v & 0xFFFF_FFFF)) + le32(UInt32(v >> 32)) }

    static func build(_ members: [Member], password: String = "", zip64: Bool = false, comment: String = "") -> Bytes {
        var out = Bytes()
        var central = Bytes()
        for (index, m) in members.enumerated() {
            let plain = m.deflated ?? m.data
            let crc = CRC32.checksum(m.data)
            var method = m.deflated == nil ? 0 : 8
            var flags = 0
            var payload = plain
            var storedCrc = crc
            var extra = Bytes()
            switch m.encryption {
            case .none: break
            case .aes(let strength, let version):
                let saltLength = [8, 12, 16][strength - 1]
                let keyLength = [16, 24, 32][strength - 1]
                let salt = (0..<saltLength).map { UInt8(truncatingIfNeeded: $0 * 17 + index) }
                let derived = PBKDF2SHA1.derive(password: Bytes(password.utf8), salt: salt, iterations: 1000, length: 2 * keyLength + 2)
                var ctr = try! ZipAESCTR(key: Array(derived[0..<keyLength]))
                var cipher = plain
                ctr.apply(&cipher)
                let mac = HMACSHA1Stream.mac(key: Array(derived[keyLength..<(2 * keyLength)]), message: cipher)
                payload = salt + Array(derived[(2 * keyLength)...]) + cipher + Array(mac.prefix(10))
                extra = le16(0x9901) + le16(7) + le16(version) + [0x41, 0x45, UInt8(strength)] + le16(method)
                method = 99
                flags = 1
                if version == 2 { storedCrc = 0 }
            case .traditional(let descriptor):
                var keys = (k0: UInt32(0x1234_5678), k1: UInt32(0x2345_6789), k2: UInt32(0x3456_7890))
                func update(_ c: UInt8) {
                    keys.k0 = RunningCRC32.table[Int((keys.k0 ^ UInt32(c)) & 0xFF)] ^ (keys.k0 >> 8)
                    keys.k1 = (keys.k1 &+ (keys.k0 & 0xFF)) &* 134_775_813 &+ 1
                    keys.k2 = RunningCRC32.table[Int((keys.k2 ^ (keys.k1 >> 24)) & 0xFF)] ^ (keys.k2 >> 8)
                }
                for b in password.utf8 { update(b) }
                let time = 0x6C21  // check byte 0x6C when a data descriptor is announced
                var header = (0..<11).map { UInt8(truncatingIfNeeded: $0 * 29 + 5) }
                header.append(descriptor ? UInt8(time >> 8) : UInt8(truncatingIfNeeded: crc >> 24))
                var cipher = Bytes()
                for p in header + plain {
                    let t = (keys.k2 | 2) & 0xFFFF
                    cipher.append(p ^ UInt8(truncatingIfNeeded: (t &* (t ^ 1)) >> 8))
                    update(p)
                }
                payload = cipher
                flags = 1 | (descriptor ? 8 : 0)
            }
            let nameBytes = Bytes(m.name.utf8)
            let big = zip64 && true
            let offset = UInt64(out.count)
            // local header (sizes in the local header are not read by the reader; the directory has them)
            out += le32(0x0403_4B50) + le16(20) + le16(flags) + le16(method) + le16(0x6C21) + le16(0x2A21) + le32(storedCrc)
            out += le32(UInt32(payload.count)) + le32(UInt32(m.data.count)) + le16(nameBytes.count) + le16(3) + nameBytes + [0xAA, 0xBB, 0xCC]
            out += payload

            central += le32(0x0201_4B50) + le16(45) + le16(20) + le16(flags) + le16(method) + le16(0x6C21) + le16(0x2A21) + le32(storedCrc)
            var zipExtra = Bytes()
            if big {
                central += le32(0xFFFF_FFFF) + le32(0xFFFF_FFFF)
                zipExtra = le16(0x0001) + le16(24) + le64(UInt64(m.data.count)) + le64(UInt64(payload.count)) + le64(offset)
            } else {
                central += le32(UInt32(payload.count)) + le32(UInt32(m.data.count))
            }
            let fullExtra = zipExtra + extra
            central += le16(nameBytes.count) + le16(fullExtra.count) + le16(0) + le16(0) + le16(0) + le32(0)
            central += big ? le32(0xFFFF_FFFF) : le32(UInt32(offset))
            central += nameBytes + fullExtra
        }
        let cdOffset = UInt64(out.count)
        out += central
        if zip64 {
            let eocd64 = UInt64(out.count)
            out += le32(0x0606_4B50) + le64(44) + le16(45) + le16(45) + le32(0) + le32(0) + le64(UInt64(members.count)) + le64(UInt64(members.count))
            out += le64(UInt64(central.count)) + le64(cdOffset)
            out += le32(0x0706_4B50) + le32(0) + le64(eocd64) + le32(1)
            out += le32(0x0605_4B50) + le16(0) + le16(0) + le16(0xFFFF) + le16(0xFFFF) + le32(0xFFFF_FFFF) + le32(0xFFFF_FFFF)
        } else {
            out += le32(0x0605_4B50) + le16(0) + le16(0) + le16(members.count) + le16(members.count) + le32(UInt32(central.count)) + le32(UInt32(cdOffset))
        }
        out += le16(comment.utf8.count) + Bytes(comment.utf8)
        return out
    }

    /// A raw deflate stream of stored blocks.
    static func storedDeflate(_ data: Bytes) -> Bytes {
        var out = Bytes()
        var at = 0
        repeat {
            let n = min(65535, data.count - at)
            let final = at + n >= data.count
            out += [final ? 1 : 0] + le16(n) + le16(~n & 0xFFFF) + data[at..<(at + n)]
            at += n
        } while at < data.count
        return out
    }
}

private func extractAll(_ archive: ZipArchive, _ entry: ZipEntry, password: Bytes = []) throws -> (data: Bytes, chunks: Int) {
    var out = Bytes()
    var chunks = 0
    try archive.extract(entry, password: password) {
        out += $0
        chunks += 1
    }
    return (out, chunks)
}

// MARK: crypto primitives

final class ZipCryptoPrimitiveTests: XCTestCase {
    func hex(_ b: Bytes) -> String { b.hexLower }

    func testSHA1KnownAnswers() {
        XCTAssertEqual(hex(SHA1Hasher.hash([])), "da39a3ee5e6b4b0d3255bfef95601890afd80709")
        XCTAssertEqual(hex(SHA1Hasher.hash(Bytes("abc".utf8))), "a9993e364706816aba3e25717850c26c9cd0d89d")
        XCTAssertEqual(
            hex(SHA1Hasher.hash(Bytes("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".utf8))), "84983e441c3bd26ebaae4aa1f95129e5e54670f1")
        var million = SHA1Hasher()
        let block = Bytes(repeating: 0x61, count: 1000)
        for _ in 0..<1000 { million.update(block) }
        XCTAssertEqual(hex(million.finalized()), "34aa973cd4c4daa4f61eeb2bdbad27316534016f")
    }

    func testSHA1IsIndependentOfHowTheInputIsCut() {
        let data = ZipStreamVectors.lcg(1000, period: 997)
        let whole = SHA1Hasher.hash(data)
        for piece in [1, 3, 55, 56, 63, 64, 65, 200] {
            var h = SHA1Hasher()
            var at = 0
            while at < data.count {
                h.update(Array(data[at..<min(data.count, at + piece)]))
                at += piece
            }
            XCTAssertEqual(h.finalized(), whole, "piece \(piece)")
        }
    }

    func testHMACSHA1Rfc2202() {
        XCTAssertEqual(hex(HMACSHA1Stream.mac(key: Bytes(repeating: 0x0B, count: 20), message: Bytes("Hi There".utf8))), "b617318655057264e28bc0b6fb378c8ef146be00")
        XCTAssertEqual(
            hex(HMACSHA1Stream.mac(key: Bytes("Jefe".utf8), message: Bytes("what do ya want for nothing?".utf8))), "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79")
        XCTAssertEqual(
            hex(HMACSHA1Stream.mac(key: Bytes(repeating: 0xAA, count: 80), message: Bytes("Test Using Larger Than Block-Size Key - Hash Key First".utf8))),
            "aa4ae5e15272d00e95705637ce8a3b55ed402112")
    }

    func testPBKDF2SHA1Rfc6070() {
        func derive(_ p: String, _ s: String, _ c: Int, _ n: Int) -> String { hex(PBKDF2SHA1.derive(password: Bytes(p.utf8), salt: Bytes(s.utf8), iterations: c, length: n)) }
        XCTAssertEqual(derive("password", "salt", 1, 20), "0c60c80f961f0e71f3a9b524af6012062fe037a6")
        XCTAssertEqual(derive("password", "salt", 2, 20), "ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957")
        XCTAssertEqual(derive("password", "salt", 4096, 20), "4b007901b765489abead49d926f721d065a429c1")
        XCTAssertEqual(derive("passwordPASSWORDpassword", "saltSALTsaltSALTsaltSALTsaltSALTsalt", 4096, 25), "3d2eec4fe41c849b80c8d83662c0e44a8b291a964cf2f07038")
    }

    func testAESCTRMatchesTheBlockCipherWithALittleEndianCounter() throws {
        for keyLength in [16, 24, 32] {
            let key = (0..<keyLength).map { UInt8($0 * 3 + 1) }
            let block = try AES(key: key)
            var expected = Bytes()
            for counter in 1...9 {
                var counterBlock = Bytes(repeating: 0, count: 16)
                counterBlock[0] = UInt8(counter)
                expected += block.encryptBlock(counterBlock)
            }
            // The 255 -> 256 carry runs into the second byte.
            var whole = Bytes(repeating: 0, count: 9 * 16)
            var ctr = try ZipAESCTR(key: key)
            ctr.apply(&whole)
            XCTAssertEqual(whole, expected, "key \(keyLength)")
            // Any cutting of the data gives the same stream.
            var cut = Bytes(repeating: 0, count: 9 * 16)
            var ctr2 = try ZipAESCTR(key: key)
            var at = 0
            for size in [1, 15, 17, 33, 2, 76] {
                var piece = Bytes(repeating: 0, count: size)
                ctr2.apply(&piece)
                cut.replaceSubrange(at..<(at + size), with: piece)
                at += size
            }
            XCTAssertEqual(cut, expected)
        }
        var long = Bytes(repeating: 0, count: 16 * 300)
        var ctr = try ZipAESCTR(key: Bytes(repeating: 7, count: 16))
        ctr.apply(&long)
        var counterBlock = Bytes(repeating: 0, count: 16)
        counterBlock[0] = 0
        counterBlock[1] = 1  // counter 256
        XCTAssertEqual(Array(long[(255 * 16)..<(256 * 16)]), try AES(key: Bytes(repeating: 7, count: 16)).encryptBlock(counterBlock))
    }

    func testAESCTRRejectsOtherKeyLengths() {
        XCTAssertThrowsError(try ZipAESCTR(key: Bytes(repeating: 0, count: 20)))
    }

    func testRunningCRCMatchesTheOneShotOne() {
        var crc = RunningCRC32()
        crc.update(Bytes("1234".utf8))
        crc.update(Bytes("56789".utf8))
        XCTAssertEqual(crc.checksum, 0xCBF4_3926)
    }
}

// MARK: streaming inflate

final class StreamInflaterTests: XCTestCase {
    private func inflate(_ stream: Bytes, pull pieceSize: Int, limit: UInt64 = 1 << 40) throws -> Bytes {
        var at = 0
        var out = Bytes()
        try StreamInflater(
            pull: {
                guard at < stream.count else { return nil }
                defer { at += pieceSize }
                return Array(stream[at..<min(stream.count, at + pieceSize)])
            }, limit: limit,
            sink: { out += $0 }
        ).run()
        return out
    }

    func testMatchesZlibForFixedDynamicStoredAndLongRunsWhateverTheInputPieces() throws {
        for v in ZipVectors.streams {
            for piece in [1, 2, 7, 64, 1 << 20] {
                XCTAssertEqual(try inflate(Bytes(hex: v.hex)!, pull: piece), v.input, "\(v.name) piece \(piece)")
            }
        }
    }

    func testBackReferencesStayValidAcrossTheWindowFlushes() throws {
        let expected = ZipStreamVectors.lcg(200_000, period: 3000)
        let stream = Bytes(hex: ZipStreamVectors.longMatchHex)!
        for piece in [1, 5, 4096, 1 << 20] {
            XCTAssertEqual(try inflate(stream, pull: piece), expected, "piece \(piece)")
        }
    }

    /// 32 768 random bytes in a stored block, then 1 000 matches of length 258 at distance 32 768 in a fixed-Huffman block.
    func testTheFullThirtyTwoKilobyteDistanceSurvivesFlushes() throws {
        var bits = Bytes()
        var acc: UInt32 = 0
        var count = 0
        func put(_ value: UInt32, _ n: Int) {
            for i in 0..<n {
                acc |= ((value >> UInt32(i)) & 1) << UInt32(count)
                count += 1
                if count == 8 {
                    bits.append(UInt8(acc))
                    acc = 0
                    count = 0
                }
            }
        }
        func huffman(_ code: UInt32, _ n: Int) { for i in stride(from: n - 1, through: 0, by: -1) { put((code >> UInt32(i)) & 1, 1) } }
        let prefix = ZipStreamVectors.lcg(32768, period: 32768)
        // the stored block, byte aligned: header 000, then pad to the byte
        put(0, 3)
        while count != 0 { put(0, 1) }
        bits += TestExportZip.le16(32768) + TestExportZip.le16(~32768 & 0xFFFF) + prefix
        put(1, 1)  // final
        put(1, 2)  // fixed
        let matches = 1000
        for _ in 0..<matches {
            huffman(0b1100_0101, 8)  // length symbol 285 = 258
            huffman(29, 5)  // distance symbol 29: base 24577, 13 extra bits
            put(32768 - 24577, 13)
        }
        huffman(0, 7)  // end of block
        while count != 0 { put(0, 1) }

        var expected = prefix
        for _ in 0..<matches { for _ in 0..<258 { expected.append(expected[expected.count - 32768]) } }
        XCTAssertEqual(expected.count, 32768 + 258 * matches)
        for piece in [3, 1 << 20] {
            XCTAssertEqual(try inflate(bits, pull: piece), expected, "piece \(piece)")
        }
    }

    func testStoredBlocksLargerThanTheWindow() throws {
        let data = ZipStreamVectors.lcg(300_000, period: 299_999)
        let stream = TestExportZip.storedDeflate(data)
        for piece in [1000, 1 << 20] {
            XCTAssertEqual(try inflate(stream, pull: piece), data, "piece \(piece)")
        }
    }

    func testOutputBeyondTheDeclaredSizeIsRefused() {
        let v = ZipVectors.streams.first { $0.name == "dynamic" }!
        XCTAssertThrowsError(try inflate(Bytes(hex: v.hex)!, pull: 100, limit: UInt64(v.input.count - 1))) { XCTAssertEqual($0 as? InflateError, .tooLarge) }
        XCTAssertEqual(try inflate(Bytes(hex: v.hex)!, pull: 100, limit: UInt64(v.input.count)), v.input)
    }

    func testTruncatedAndBrokenStreamsFail() {
        let v = ZipVectors.streams.first { $0.name == "dynamic" }!
        let stream = Bytes(hex: v.hex)!
        XCTAssertThrowsError(try inflate(Array(stream.prefix(stream.count / 2)), pull: 10)) { XCTAssertEqual($0 as? InflateError, .truncated) }
        XCTAssertThrowsError(try inflate([0x07], pull: 1))  // reserved block type
        XCTAssertThrowsError(try inflate([0x01, 0x05, 0x00, 0x00, 0x00], pull: 1))  // stored length check
    }

    func testASinkErrorComesOutUnchanged() {
        struct Stop: Error {}
        let v = ZipVectors.streams.first { $0.name == "rle" }!
        XCTAssertThrowsError(try StreamInflater(pull: { nil }, limit: 10, sink: { _ in throw Stop() }).run()) { XCTAssertTrue($0 is InflateError) }
        var first = true
        let stream = Bytes(hex: v.hex)!
        var given = false
        XCTAssertThrowsError(
            try StreamInflater(
                pull: {
                    defer { given = true }
                    return given ? nil : stream
                }, limit: 1 << 30,
                sink: { _ in
                    if first {
                        first = false
                        throw Stop()
                    }
                }
            ).run()
        ) { XCTAssertTrue($0 is Stop) }
    }
}

// MARK: archives

final class ZipArchiveTests: XCTestCase {
    private func b64(_ s: Any?) -> Bytes { Bytes(Data(base64Encoded: (s as? String) ?? "") ?? Data()) }

    private func golden() throws -> (files: [(String, Bytes)], cases: [[String: Any]]) {
        let g = try Golden.load("importZip")
        let files = (g["files"] as? [String: String] ?? [:]).map { ($0.key, Bytes(Data(base64Encoded: $0.value) ?? Data())) }.sorted { $0.0 < $1.0 }
        return (files, g.list("cases"))
    }

    func testZip4jArchivesOfEveryKindReadBackByteForByte() throws {
        let (files, cases) = try golden()
        XCTAssertEqual(cases.map { $0.str("name") }, ["plainDeflate", "plainStored", "aes256", "aes256Ae1", "aes256Unicode", "aes128", "aes256Stored", "zipCrypto", "zipCryptoStored"])
        XCTAssertEqual(files.count, 4)
        for c in cases {
            let name = c.str("name")
            let password = Bytes((c.opt("password") ?? "").utf8)
            for chunk in [97, 64 * 1024] {
                let archive = try ZipArchive(source: MemoryZipSource(b64(c["zip"])), chunkBytes: chunk)
                XCTAssertEqual(archive.entries.map(\.name).sorted(), files.map { $0.0 }, name)
                for entry in archive.entries {
                    let expected = files.first { $0.0 == entry.name }!.1
                    XCTAssertEqual(entry.size, UInt64(expected.count), name)
                    let got = try extractAll(archive, entry, password: password)
                    XCTAssertEqual(got.data, expected, "\(name) \(entry.name) chunk \(chunk)")
                    // Stored members reach the sink as they are read: with 97-byte reads that is many pieces.
                    if chunk == 97 && entry.method == 0 && expected.count > 1000 { XCTAssertGreaterThan(got.chunks, 1, name) }
                }
            }
        }
    }

    func testTheEncryptionOfEachArchiveIsWhatZip4jWrote() throws {
        let (_, cases) = try golden()
        func encryption(_ name: String) throws -> Set<String> {
            let c = cases.first { $0.str("name") == name }!
            return Set(try ZipArchive(source: MemoryZipSource(b64(c["zip"]))).entries.map { "\($0.encryption)" })
        }
        XCTAssertEqual(try encryption("plainDeflate"), ["none"])
        XCTAssertEqual(try encryption("aes256"), ["aes(strength: 3, version: 2)"])
        XCTAssertEqual(try encryption("aes256Ae1"), ["aes(strength: 3, version: 1)"])
        XCTAssertEqual(try encryption("aes128"), ["aes(strength: 1, version: 2)"])
        XCTAssertEqual(try encryption("zipCrypto"), ["traditional"])
        let methods = Set(try ZipArchive(source: MemoryZipSource(b64(cases.first { $0.str("name") == "aes256Stored" }!["zip"]))).entries.map(\.method))
        XCTAssertEqual(methods, [0])
    }

    func testAWrongOrMissingPasswordIsRefusedBeforeAnyData() throws {
        let (_, cases) = try golden()
        for name in ["aes256", "aes256Ae1", "aes256Unicode", "aes128", "aes256Stored"] {
            let c = cases.first { $0.str("name") == name }!
            let archive = try ZipArchive(source: MemoryZipSource(b64(c["zip"])))
            let entry = archive.entries[0]
            XCTAssertThrowsError(try archive.checkPassword(entry, password: Bytes("wrong".utf8)), name) { XCTAssertEqual($0 as? ZipError, .wrongPassword) }
            XCTAssertThrowsError(try archive.checkPassword(entry, password: []), name) { XCTAssertEqual($0 as? ZipError, .passwordRequired) }
            XCTAssertNoThrow(try archive.checkPassword(entry, password: Bytes(c.str("password").utf8)), name)
        }
    }

    func testTheTraditionalCipherChecksItsHeaderByteAndTheCRC() throws {
        let (files, cases) = try golden()
        for name in ["zipCrypto", "zipCryptoStored"] {
            let c = cases.first { $0.str("name") == name }!
            let archive = try ZipArchive(source: MemoryZipSource(b64(c["zip"])))
            let entry = archive.entries[0]
            XCTAssertNoThrow(try archive.checkPassword(entry, password: Bytes("classic".utf8)))
            XCTAssertThrowsError(try archive.checkPassword(entry, password: [])) { XCTAssertEqual($0 as? ZipError, .passwordRequired) }
            // The check byte lets one wrong password in 256 through; those fail on the CRC instead.
            var refused = 0
            for i in 0..<40 {
                let wrong = Bytes("wrong-\(i)".utf8)
                do {
                    try archive.checkPassword(entry, password: wrong)
                    XCTAssertThrowsError(try extractAll(archive, entry, password: wrong)) { XCTAssertTrue(($0 as? ZipError).map { if case .corrupt = $0 { return true } else { return false } } ?? false) }
                } catch ZipError.wrongPassword {
                    refused += 1
                }
            }
            XCTAssertGreaterThan(refused, 30, name)
            XCTAssertEqual(try extractAll(archive, entry, password: Bytes("classic".utf8)).data, files.first { $0.0 == entry.name }!.1)
        }
    }

    func testADamagedMemberIsReportedNotReturned() throws {
        let (_, cases) = try golden()
        for name in ["plainStored", "plainDeflate", "aes256", "aes256Stored", "zipCrypto"] {
            let c = cases.first { $0.str("name") == name }!
            let password = Bytes(c.str("password").utf8)
            let clean = b64(c["zip"])
            let archive = try ZipArchive(source: MemoryZipSource(clean))
            let entry = archive.entries.first { $0.size > 1000 }!
            // A byte in the middle of that member's data.
            var damaged = clean
            let local = Int(entry.localOffset)
            let dataStart = local + 30 + Int(clean.u16le(local + 26)) + Int(clean.u16le(local + 28))
            damaged[dataStart + Int(entry.compressedSize) / 2] ^= 0x40
            let bad = try ZipArchive(source: MemoryZipSource(damaged))
            XCTAssertThrowsError(try extractAll(bad, bad.entries.first { $0.name == entry.name }!, password: password), name) {
                guard case ZipError.corrupt = $0 else { return XCTFail("\(name): \($0)") }
            }
            // The other members are unharmed.
            for other in bad.entries where other.name != entry.name {
                XCTAssertNoThrow(try extractAll(bad, other, password: password), name)
            }
        }
    }

    func testAMemberCutOffByTheEndOfTheFileIsReported() throws {
        let zip = TestExportZip.build([.init(name: "a.json", data: Bytes(repeating: 7, count: 5000))])
        // Move the directory's offset past the real data: the member now lies outside the file.
        var broken = zip
        let eocd = broken.count - 22
        let cdOffset = Int(broken.u32le(eocd + 16))
        broken[cdOffset + 42] = 0xF0
        broken[cdOffset + 43] = 0xFF
        let archive = try ZipArchive(source: MemoryZipSource(broken))
        XCTAssertThrowsError(try extractAll(archive, archive.entries[0])) { guard case ZipError.corrupt = $0 else { return XCTFail("\($0)") } }
    }

    func testZip64DirectoriesAreRead() throws {
        let data = ZipStreamVectors.lcg(70_000, period: 9973)
        let zip = TestExportZip.build(
            [.init(name: "dir/", data: []), .init(name: "dir/a.bin", data: data), .init(name: "b.txt", data: Bytes("hello".utf8), deflated: TestExportZip.storedDeflate(Bytes("hello".utf8)))],
            zip64: true, comment: "a comment that does not hide the end record")
        let archive = try ZipArchive(source: MemoryZipSource(zip), chunkBytes: 1000)
        XCTAssertEqual(archive.entries.map(\.name), ["dir/", "dir/a.bin", "b.txt"])
        XCTAssertEqual(archive.entries.map(\.isDirectory), [true, false, false])
        XCTAssertEqual(archive.entries[1].size, 70_000)
        XCTAssertEqual(try extractAll(archive, archive.entries[1]).data, data)
        XCTAssertEqual(try extractAll(archive, archive.entries[2]).data, Bytes("hello".utf8))
        XCTAssertEqual(try extractAll(archive, archive.entries[0]).data, [])
    }

    func testAes192AndEveryStrengthRoundTripThroughTheWriterAndTheReader() throws {
        let data = ZipStreamVectors.lcg(5000, period: 4999)
        for strength in 1...3 {
            for version in 1...2 {
                let zip = TestExportZip.build([.init(name: "x.json", data: data, encryption: .aes(strength: strength, version: version))], password: "pw")
                let archive = try ZipArchive(source: MemoryZipSource(zip), chunkBytes: 333)
                XCTAssertEqual(archive.entries[0].encryption, .aes(strength: strength, version: version))
                XCTAssertEqual(try extractAll(archive, archive.entries[0], password: Bytes("pw".utf8)).data, data, "strength \(strength) version \(version)")
                XCTAssertThrowsError(try extractAll(archive, archive.entries[0], password: Bytes("px".utf8))) { XCTAssertEqual($0 as? ZipError, .wrongPassword) }
            }
        }
    }

    func testTraditionalEncryptionWithADataDescriptorChecksTheTimeByte() throws {
        let data = Bytes("{\"a\":1}".utf8)
        for descriptor in [false, true] {
            let zip = TestExportZip.build([.init(name: "x.json", data: data, encryption: .traditional(dataDescriptor: descriptor))], password: "pw")
            let archive = try ZipArchive(source: MemoryZipSource(zip))
            XCTAssertEqual(try extractAll(archive, archive.entries[0], password: Bytes("pw".utf8)).data, data)
            XCTAssertThrowsError(try archive.checkPassword(archive.entries[0], password: Bytes("q".utf8)))
        }
    }

    func testNotAZipFails() {
        for bytes: Bytes in [[], Bytes("hello".utf8), Bytes(repeating: 0, count: 100), Array(TestExportZip.build([.init(name: "a", data: [1])]).prefix(40))] {
            XCTAssertThrowsError(try ZipArchive(source: MemoryZipSource(bytes)), "\(bytes.count) bytes") { guard case ZipError.notAZip = $0 else { return XCTFail("\($0)") } }
        }
    }

    func testUnsupportedMethodsAreReportedWhenReadNotWhenListed() throws {
        var zip = TestExportZip.build([.init(name: "a.bin", data: [1, 2, 3])])
        let eocd = zip.count - 22
        let cdOffset = Int(zip.u32le(eocd + 16))
        zip[cdOffset + 10] = 12  // bzip2
        let archive = try ZipArchive(source: MemoryZipSource(zip))
        XCTAssertEqual(archive.entries.count, 1)
        XCTAssertThrowsError(try extractAll(archive, archive.entries[0])) { guard case ZipError.unsupported = $0 else { return XCTFail("\($0)") } }
    }

    func testAFileOnDiskIsReadInPlace() throws {
        let data = ZipStreamVectors.lcg(200_000, period: 199_999)
        let zip = TestExportZip.build([.init(name: "big.bin", data: data, encryption: .aes(strength: 3, version: 2))], password: "pw")
        let path = NSTemporaryDirectory() + "huawei-zip-test-\(UUID().uuidString).zip"
        try Data(zip).write(to: URL(fileURLWithPath: path))
        defer { try? FileManager.default.removeItem(atPath: path) }
        let archive = try ZipArchive(source: try FileZipSource(path: path))
        XCTAssertEqual(try extractAll(archive, archive.entries[0], password: Bytes("pw".utf8)).data, data)
        XCTAssertThrowsError(try FileZipSource(path: NSTemporaryDirectory())) { guard case ZipError.notAZip = $0 else { return XCTFail("\($0)") } }
        XCTAssertThrowsError(try FileZipSource(path: path + ".missing")) { guard case ZipError.io = $0 else { return XCTFail("\($0)") } }
    }
}

// MARK: the export source

final class HuaweiExportZipTests: XCTestCase {
    private let healthFile = "Health detail data & description/Health detail data1.json"
    private let motionFile = "Motion path detail data & description/Motion path detail data1.json"
    private let t0: Int64 = 1_750_000_020_000

    private final class Collect: HuaweiImportStore {
        var minutes = [Int?]()
        var workouts = 0
        func writeMinutes(_ rows: [ImportedMinute]) throws -> Int { minutes += rows.map(\.heartRate); return rows.count }
        func writeSleep(_ segments: [ImportedSleep]) throws -> Int { segments.count }
        func writeStress(_ points: [ImportedStress]) throws -> Int { points.count }
        func writeWorkout(_ workout: ImportedWorkout) throws -> WorkoutWrite { workouts += 1; return WorkoutWrite(added: true, points: workout.points.count) }
    }

    private func exportFiles() -> [(String, String)] {
        let health = "[{\"startTime\":\(t0),\"endTime\":\(t0 + 60_000),\"samplePoints\":[{\"key\":\"DATA_POINT_DYNAMIC_HEARTRATE\",\"startTime\":\(t0),\"endTime\":\(t0),\"value\":\"66\"}]}]"
        let motion = "[{\"abnormalTrack\":\"\",\"sportType\":4,\"startTime\":\(t0),\"endTime\":\(t0 + 600_000),\"totalDistance\":1200,\"attribute\":\"tp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=\(t0 / 1000).0;\\n\"}]"
        return [(healthFile, health), (motionFile, motion), ("readme.txt", "not data")]
    }

    private func zip(_ encryption: TestExportZip.Encryption, password: String) -> Bytes {
        TestExportZip.build(exportFiles().map { .init(name: $0.0, data: Bytes($0.1.utf8), encryption: encryption) }, password: password)
    }

    func testReadsAnAesEncryptedZipWithThePassword() throws {
        let store = Collect()
        let source = try ZipExportSource.open(source: MemoryZipSource(zip(.aes(strength: 3, version: 2), password: "s3cret-Pass")), password: Bytes("s3cret-Pass".utf8), chunkBytes: 64)
        let summary = try HuaweiExportImporter(store: store, onProgress: { _ in }).run(source)
        XCTAssertEqual(summary.filesRead, 2)
        XCTAssertEqual(summary.filesIgnored, 1)
        XCTAssertEqual(store.minutes, [66])
        XCTAssertEqual(store.workouts, 1)
    }

    func testReadsAZipThatIsNotEncryptedAndATraditionalOne() throws {
        for (encryption, password) in [(TestExportZip.Encryption.none, ""), (.traditional(dataDescriptor: false), "pw"), (.traditional(dataDescriptor: true), "pw")] {
            let store = Collect()
            let source = try ZipExportSource.open(source: MemoryZipSource(zip(encryption, password: password)), password: Bytes(password.utf8))
            let summary = try HuaweiExportImporter(store: store, onProgress: { _ in }).run(source)
            XCTAssertEqual(summary.filesRead, 2)
            XCTAssertEqual(store.minutes, [66])
        }
    }

    func testAnArchiveWrittenByZip4jFeedsTheImporterToo() throws {
        let g = try Golden.load("importZip")
        let c = g.list("cases").first { $0.str("name") == "aes256" }!
        let source = try ZipExportSource.open(source: MemoryZipSource(Bytes(Data(base64Encoded: c.str("zip"))!)), password: Bytes(c.str("password").utf8))
        // The contents are filler text, not an export: the folders are right, the records are not JSON objects.
        let summary = try HuaweiExportImporter(store: Collect(), onProgress: { _ in }).run(source)
        XCTAssertEqual(summary.filesRead, 3)
        XCTAssertEqual(summary.filesIgnored, 1)
        XCTAssertEqual(summary.filesFailed, 0)
    }

    func testAWrongOrMissingPasswordFailsBeforeAnyWork() {
        let data = zip(.aes(strength: 3, version: 2), password: "right")
        for password in ["wrong", ""] {
            XCTAssertThrowsError(try ZipExportSource.open(source: MemoryZipSource(data), password: Bytes(password.utf8)), "'\(password)'") {
                XCTAssertEqual(($0 as? HuaweiImportException)?.kind, .badPassword)
            }
        }
    }

    func testAFileThatIsNotAZipIsRejected() throws {
        XCTAssertThrowsError(try ZipExportSource.open(source: MemoryZipSource(Bytes("hello".utf8)), password: Bytes("x".utf8))) {
            XCTAssertEqual(($0 as? HuaweiImportException)?.kind, .notAZip)
        }
        let path = NSTemporaryDirectory() + "huawei-not-a-zip-\(UUID().uuidString).zip"
        try Data("hello".utf8).write(to: URL(fileURLWithPath: path))
        defer { try? FileManager.default.removeItem(atPath: path) }
        XCTAssertThrowsError(try ZipExportSource.open(path: path, password: "x")) { XCTAssertEqual(($0 as? HuaweiImportException)?.kind, .notAZip) }
        XCTAssertThrowsError(try ZipExportSource.open(path: path + ".missing", password: "x")) { XCTAssertEqual(($0 as? HuaweiImportException)?.kind, .notAZip) }
    }

    func testADamagedMemberCostsThatFileOnly() throws {
        var data = zip(.none, password: "")
        let archive = try ZipArchive(source: MemoryZipSource(data))
        let health = archive.entries.first { $0.name == healthFile }!
        let local = Int(health.localOffset)
        data[local + 30 + Int(data.u16le(local + 26)) + Int(data.u16le(local + 28)) + 5] ^= 0x20
        let source = try ZipExportSource.open(source: MemoryZipSource(data), password: [])
        let store = Collect()
        let summary = try HuaweiExportImporter(store: store, onProgress: { _ in }).run(source)
        XCTAssertEqual(summary.filesFailed, 1)
        XCTAssertEqual(summary.filesRead, 1)
        XCTAssertEqual(store.workouts, 1)
    }

    func testWithExportReadsAFileURLInPlace() throws {
        let path = NSTemporaryDirectory() + "huawei-export-\(UUID().uuidString).zip"
        try Data(zip(.aes(strength: 3, version: 2), password: "pw")).write(to: URL(fileURLWithPath: path))
        defer { try? FileManager.default.removeItem(atPath: path) }
        for uri in [path, URL(fileURLWithPath: path).absoluteString] {
            let summary = try HuaweiExportFiles.withExport(uri: uri, password: "pw") { source in
                try HuaweiExportImporter(store: Collect(), onProgress: { _ in }).run(source)
            }
            XCTAssertEqual(summary.filesRead, 2, uri)
        }
        XCTAssertThrowsError(try HuaweiExportFiles.withExport(uri: "content://x/y", password: "pw") { _ in 1 }) {
            XCTAssertEqual(($0 as? HuaweiImportException)?.kind, .notAZip)
        }
    }
}

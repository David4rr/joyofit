import XCTest
@testable import HuaweiProtocol

final class PrimitivesTests: XCTestCase {
    let g = try! Golden.load("primitives")

    func testCRC16() {
        XCTAssertFalse(g.list("crc16").isEmpty)
        for c in g.list("crc16") {
            let data = c.bytes("data")
            XCTAssertEqual(Int(CRC16.checksum(data, initial: 0x0000)), c.int("init0"))
            XCTAssertEqual(Int(CRC16.checksum(data, initial: 0xFFFF)), c.int("initFFFF"))
        }
    }

    func testSHA256() {
        XCTAssertEqual(SHA256.hash([]).hexLower, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        XCTAssertEqual(SHA256.hash(Array("abc".utf8)).hexLower, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        for c in g.list("sha256") {
            XCTAssertEqual(SHA256.hash(c.bytes("data")), c.bytes("digest"), "len \(c.bytes("data").count)")
        }
    }

    func testHMAC() {
        XCTAssertFalse(g.list("hmacSha256").isEmpty)
        for c in g.list("hmacSha256") {
            XCTAssertEqual(HMACSHA256.mac(key: c.bytes("key"), message: c.bytes("message")), c.bytes("mac"))
        }
    }

    func testHKDF() {
        XCTAssertFalse(g.list("hkdfSha256").isEmpty)
        for c in g.list("hkdfSha256") {
            XCTAssertEqual(
                HKDFSHA256.derive(secretKey: c.bytes("secretKey"), salt: c.bytes("salt"), info: c.bytes("info"), outputLength: c.int("length")),
                c.bytes("okm")
            )
        }
    }

    func testPBKDF2() {
        XCTAssertFalse(g.list("pbkdf2Sha256").isEmpty)
        for c in g.list("pbkdf2Sha256") {
            XCTAssertEqual(
                PBKDF2SHA256.derive(password: Array(c.str("key").utf8), salt: Array(c.str("iv").utf8), iterations: c.int("count"), keyBits: c.int("bits")),
                c.bytes("derived")
            )
        }
    }

    func testAESKnownAnswer() throws {
        // FIPS 197 appendix C.1 / C.3.
        let key128 = Bytes(hex: "000102030405060708090a0b0c0d0e0f")!
        let key256 = Bytes(hex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")!
        let plain = Bytes(hex: "00112233445566778899aabbccddeeff")!
        XCTAssertEqual(try AES(key: key128).encryptBlock(plain).hexLower, "69c4e0d86a7b0430d8cdb78070b4c55a")
        XCTAssertEqual(try AES(key: key256).encryptBlock(plain).hexLower, "8ea2b7ca516745bfeafc49904b496089")
        XCTAssertEqual(try AES(key: key128).decryptBlock(Bytes(hex: "69c4e0d86a7b0430d8cdb78070b4c55a")!), plain)
        XCTAssertEqual(try AES(key: key256).decryptBlock(Bytes(hex: "8ea2b7ca516745bfeafc49904b496089")!), plain)
    }

    func testAESCBC() throws {
        XCTAssertFalse(g.list("aesCbc").isEmpty)
        for c in g.list("aesCbc") {
            let cipher = try AES.encryptCBC(c.bytes("plain"), key: c.bytes("key"), iv: c.bytes("iv"))
            XCTAssertEqual(cipher, c.bytes("cipher"))
            XCTAssertEqual(try AES.decryptCBC(cipher, key: c.bytes("key"), iv: c.bytes("iv")), c.bytes("plain"))
        }
    }

    func testAESCBCRejectsBadPadding() throws {
        let key = Bytes(repeating: 7, count: 16), iv = Bytes(repeating: 1, count: 16)
        var cipher = try AES.encryptCBC([1, 2, 3], key: key, iv: iv)
        cipher[cipher.count - 1] ^= 0x55
        XCTAssertThrowsError(try AES.decryptCBC(cipher, key: key, iv: iv))
        XCTAssertThrowsError(try AES.decryptCBC([], key: key, iv: iv))
        XCTAssertThrowsError(try AES.decryptCBC([1, 2, 3], key: key, iv: iv))
    }

    func testAESGCM() throws {
        XCTAssertFalse(g.list("aesGcm").isEmpty)
        for c in g.list("aesGcm") {
            let aad = c.optBytes("aad")
            let cipher = try AES.encryptGCM(c.bytes("plain"), key: c.bytes("key"), iv: c.bytes("iv"), aad: aad)
            XCTAssertEqual(cipher, c.bytes("cipher"), "key \(c.bytes("key").count) iv \(c.bytes("iv").count) data \(c.bytes("plain").count)")
            XCTAssertEqual(try AES.decryptGCM(cipher, key: c.bytes("key"), iv: c.bytes("iv"), aad: aad), c.bytes("plain"))
        }
    }

    func testAESGCMRejectsTamper() throws {
        let key = Bytes(repeating: 9, count: 16), iv = Bytes(repeating: 2, count: 12)
        var cipher = try AES.encryptGCM([1, 2, 3, 4], key: key, iv: iv, aad: [5])
        XCTAssertThrowsError(try AES.decryptGCM(cipher, key: key, iv: iv, aad: [6]))
        cipher[0] ^= 1
        XCTAssertThrowsError(try AES.decryptGCM(cipher, key: key, iv: iv, aad: [5]))
    }

    func testCreateSecretKey() {
        XCTAssertFalse(g.list("createSecretKey").isEmpty)
        for c in g.list("createSecretKey") {
            XCTAssertEqual(HuaweiCrypto(authVersion: c.int("authVersion")).createSecretKey(macAddress: c.str("mac")), c.bytes("key"))
        }
    }

    func testDigests() throws {
        XCTAssertFalse(g.list("digests").isEmpty)
        for c in g.list("digests") {
            let crypto = HuaweiCrypto(
                authVersion: c.int("authVersion"),
                authAlgo: UInt8(c.int("authAlgo")),
                deviceSupportType: c.int("deviceSupportType"),
                authMode: UInt8(c.int("authMode"))
            )
            let key = c.optBytes("key")
            XCTAssertEqual(try crypto.digestChallenge(secretKey: key, nonce: c.bytes("nonce")), c.optBytes("challenge"), "challenge \(c)")
            XCTAssertEqual(try crypto.digestResponse(secretKey: key, nonce: c.bytes("nonce")), c.optBytes("response"), "response \(c)")
        }
    }

    func testInitializationVectorCounter() {
        XCTAssertFalse(g.list("initializationVector").isEmpty)
        for c in g.list("initializationVector") {
            let result = HuaweiCrypto.initializationVector(counter: UInt32(c.int("counter")))
            XCTAssertEqual(Bytes(result.iv[12..<16]), c.bytes("lastFour"))
            XCTAssertEqual(Int(result.counter), c.int("next"))
            XCTAssertEqual(result.iv.count, 16)
        }
    }

    func testBondingKey() throws {
        XCTAssertFalse(g.list("bondingKey").isEmpty)
        for c in g.list("bondingKey") {
            let crypto = HuaweiCrypto(authVersion: 1)
            let out = try crypto.encryptBondingKey(encryptMethod: UInt8(c.int("encryptMethod")), data: c.bytes("data"), key: c.bytes("key"), iv: c.bytes("iv"))
            XCTAssertEqual(out, c.bytes("encrypted"))
            XCTAssertEqual(try crypto.decryptBondingKey(encryptMethod: UInt8(c.int("encryptMethod")), data: out, key: c.bytes("key"), iv: c.bytes("iv")), c.bytes("data"))
        }
    }

    func testTLVBuild() throws {
        var t = HuaweiTLV()
        t.put(0x01)
        t.put(0x02, byte: 0x7f)
        t.put(0x03, byte: 0xff)
        t.put(0x04, bool: true)
        t.put(0x05, short: 0x1234)
        t.put(0x06, int: 0x01020304)
        t.put(0x07, long: 0x0102030405060708)
        t.put(0x08, string: "héllo")
        t.put(0x09, bytes: Bytes(repeating: 0, count: 127))
        t.put(0x0a, bytes: Bytes(repeating: 0, count: 128))
        t.put(0x0b, bytes: Bytes(repeating: 0, count: 16383))
        t.put(0x0c, bytes: Bytes(repeating: 0, count: 16384))
        t.put(0x0d, double: 1.5)
        var inner = HuaweiTLV()
        inner.put(0x01, byte: 1)
        var innermost = HuaweiTLV()
        innermost.put(0x02, short: 7)
        inner.put(0x82, tlv: innermost)
        t.put(0x81, tlv: inner)
        t.put(0xff, bytes: [1, 2, 3])
        let c = g.list("tlvBuild")[0]
        XCTAssertEqual(t.serialize(), c.bytes("serialized"))
        XCTAssertEqual(t.length, c.int("length"))
        XCTAssertEqual(try HuaweiTLV(parsing: t.serialize()), t)
    }

    func testTLVParse() throws {
        XCTAssertFalse(g.list("tlvParse").isEmpty)
        for c in g.list("tlvParse") {
            let input = c.bytes("input")
            if c.opt("error") != nil {
                XCTAssertThrowsError(try HuaweiTLV(parsing: input), "input \(c.str("input"))")
                continue
            }
            let parsed = try HuaweiTLV(parsing: input)
            let expected = c.list("entries")
            XCTAssertEqual(parsed.entries.count, expected.count, "input \(c.str("input"))")
            for (a, e) in zip(parsed.entries, expected) {
                XCTAssertEqual(Int(a.tag), e.int("tag"))
                XCTAssertEqual(a.value, e.bytes("value"))
            }
        }
    }

    func testTLVAccessors() throws {
        var t = HuaweiTLV()
        t.put(1, byte: 0xff)
        t.put(2, short: -2)
        t.put(3, int: -3)
        t.put(4, bytes: [0x12, 0x34])
        t.put(5, bytes: [0x01, 0x02, 0x03])
        XCTAssertEqual(try t.byte(1), -1)
        XCTAssertEqual(try t.short(2), -2)
        XCTAssertEqual(try t.int(3), -3)
        XCTAssertEqual(try t.asInteger(1), 255)
        XCTAssertEqual(try t.asInteger(4), 0x1234)
        XCTAssertEqual(t.asInteger(5, default: -1), 0x010203)
        XCTAssertEqual(t.asInteger(9, default: -1), -1)
        XCTAssertThrowsError(try t.bytes(9))
    }
}

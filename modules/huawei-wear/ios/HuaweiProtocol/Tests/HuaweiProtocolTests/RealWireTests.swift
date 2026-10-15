import XCTest
@testable import HuaweiProtocol

/// Frames captured from the real Watch Fit 4 Pro over BLE (Fixtures/real-ble-frames.txt): the parser and the PIN decryption must hold on real bytes.
final class RealWireTests: XCTestCase {
    struct Frame { let dir: String; let service: UInt8; let command: UInt8; let bytes: Bytes; let message: String }

    func frames() throws -> [Frame] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/real-ble-frames.txt")
        let text = try String(contentsOf: url, encoding: .utf8)
        return text.split(separator: "\n").compactMap { line in
            guard !line.hasPrefix("#") else { return nil }
            let parts = line.split(separator: " ", maxSplits: 4, omittingEmptySubsequences: true)
            guard parts.count >= 4, let s = UInt8(parts[1], radix: 16), let c = UInt8(parts[2], radix: 16), let b = Bytes(hex: String(parts[3])) else { return nil }
            return Frame(dir: String(parts[0]), service: s, command: c, bytes: b, message: parts.count > 4 ? String(parts[4]) : "")
        }
    }

    private func parse(_ f: Frame) throws -> HuaweiPacket {
        var assembler = PacketAssembler()
        let result = try assembler.feed(f.bytes, params: ParamsProvider())
        XCTAssertEqual(result.left, 0)
        return try XCTUnwrap(result.packet, f.message)
    }

    func testEveryCapturedFrameParses() throws {
        let all = try frames()
        XCTAssertEqual(all.count, 6)
        for f in all {
            let p = try parse(f)
            XCTAssertEqual(p.serviceId, f.service, f.message)
            XCTAssertEqual(p.commandId, f.command, f.message)
        }
    }

    func testLinkParamsResponseValues() throws {
        let f = try XCTUnwrap(frames().first { $0.dir == "rx" && $0.service == 1 && $0.command == 1 })
        let tlv = try XCTUnwrap(parse(f).tlv)
        XCTAssertEqual(try tlv.byte(0x01), 2) // protocolVersion
        XCTAssertEqual(try tlv.short(0x02), 1022) // sliceSize
        XCTAssertEqual(try tlv.short(0x03), 514) // mtu
        let auth = try tlv.bytes(0x05)
        XCTAssertEqual(auth.count, 18)
        XCTAssertEqual(auth[1], 1) // authVersion
        XCTAssertEqual(try tlv.byte(0x07), 4) // deviceSupportType
        XCTAssertFalse(tlv.contains(0x08)) // authAlgo absent: stays 0
        XCTAssertEqual(try tlv.byte(0x09), 0) // bondState
        XCTAssertFalse(tlv.contains(0x0C)) // encryptMethod absent: stays 0, AES-CBC
    }

    func testOurLinkParamsRequestMatchesTheWire() throws {
        // GB's request for deviceType BLE: tags 01..04 empty, unencrypted, unsliced.
        let sent = try XCTUnwrap(frames().first { $0.dir == "tx" && $0.service == 1 && $0.command == 1 })
        var tlv = HuaweiTLV()
        tlv.put(0x01); tlv.put(0x02); tlv.put(0x03); tlv.put(0x04)
        let packet = HuaweiPacket(serviceId: 1, commandId: 1, tlv: tlv, isEncrypted: false, isSliced: false)
        XCTAssertEqual(try packet.serialize(params: ParamsProvider()), [sent.bytes])
    }

    func testSecurityNegotiationForANewIdentity() throws {
        let f = try XCTUnwrap(frames().first { $0.dir == "rx" && $0.service == 1 && $0.command == 0x33 })
        let tlv = try parse(f).tlv!
        XCTAssertEqual(try tlv.byte(0x01), 4)
        XCTAssertEqual(try tlv.byte(0x02), 1) // pairType 1: the watch does not know this id; 1 ^ 4 = authType 5
        XCTAssertEqual(try tlv.bytes(0x05).count, 64) // the watch's authId, 64 ASCII hex characters
    }

    func testPinCodeDecryptsToDecimalDigitNibbles() throws {
        let f = try XCTUnwrap(frames().first { $0.dir == "rx" && $0.service == 1 && $0.command == 0x2c })
        let tlv = try parse(f).tlv!
        let cipher = try tlv.bytes(0x01), iv = try tlv.bytes(0x02)
        XCTAssertEqual(cipher.count, 80)
        XCTAssertEqual(iv.count, 16)
        // authVersion 1 -> DIGEST_SECRET_v1, encryptMethod 0 -> AES-CBC/PKCS5; the plaintext is 64 bytes whose every nibble is a decimal digit.
        let pin = try HuaweiCrypto(authVersion: 1).decryptPinCode(encryptMethod: 0, message: cipher, iv: iv)
        XCTAssertEqual(pin.count, 64)
        for b in pin {
            XCTAssertLessThanOrEqual(b >> 4, 9)
            XCTAssertLessThanOrEqual(b & 0x0F, 9)
        }
    }
}

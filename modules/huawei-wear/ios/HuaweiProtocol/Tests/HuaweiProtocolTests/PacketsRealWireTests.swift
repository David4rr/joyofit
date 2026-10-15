import XCTest
@testable import HuaweiProtocol

/// The typed packets against frames captured from the real Watch Fit 4 Pro over BLE (Fixtures/real-ble-frames.txt, the throwaway identity
/// `t1`): requests must serialize to the bytes the Android app sent, responses must parse to the values the watch meant.
final class PacketsRealWireTests: XCTestCase {
    private struct Frame { let dir: String; let service: UInt8; let command: UInt8; let bytes: Bytes }

    private func frames() throws -> [Frame] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/real-ble-frames.txt")
        let text = try String(contentsOf: url, encoding: .utf8)
        return text.split(separator: "\n").compactMap { line in
            guard !line.hasPrefix("#") else { return nil }
            let parts = line.split(separator: " ", maxSplits: 4, omittingEmptySubsequences: true)
            guard parts.count >= 4, let s = UInt8(parts[1], radix: 16), let c = UInt8(parts[2], radix: 16), let b = Bytes(hex: String(parts[3])) else { return nil }
            return Frame(dir: String(parts[0]), service: s, command: c, bytes: b)
        }
    }

    private func frame(_ dir: String, _ service: UInt8, _ command: UInt8) throws -> Frame {
        try XCTUnwrap(frames().first { $0.dir == dir && $0.service == service && $0.command == command })
    }

    private func packet(_ f: Frame) throws -> HuaweiPacket {
        var assembler = PacketAssembler()
        return try XCTUnwrap(try assembler.feed(f.bytes, params: ParamsProvider()).packet)
    }

    func testLinkParamsRequestForBleAndTheResponseValues() throws {
        XCTAssertEqual(try DeviceConfig.LinkParams.request(deviceType: .ble).serialize(params: ParamsProvider()), [try frame("tx", 1, 1).bytes])
        let r = try DeviceConfig.LinkParams.Response(packet: try packet(try frame("rx", 1, 1)))
        XCTAssertEqual(r.protocolVersion, 2)
        XCTAssertEqual(r.sliceSize, 1022)
        XCTAssertEqual(r.mtu, 514)
        XCTAssertEqual(r.interval, 0)
        XCTAssertEqual(r.authVersion, 1)
        XCTAssertEqual(r.deviceSupportType, 4)
        XCTAssertEqual(r.authAlgo, 0, "no tag 0x08: the default stays")
        XCTAssertEqual(r.bondState, 0)
        XCTAssertEqual(r.encryptMethod, 0, "no tag 0x0C: the default stays")
        XCTAssertEqual(r.serverNonce.hexUpper, "A307C9871921BEF4D039A123FC542D33")
    }

    func testSecurityNegotiationRequestForAuthMode4IsByteIdenticalToTheWire() throws {
        let sent = try frame("tx", 1, 0x33)
        let tlv = try XCTUnwrap(try packet(sent).tlv)
        let androidId = try tlv.bytes(0x05)
        XCTAssertEqual(androidId.count, 32)
        let model = try tlv.string(0x07)
        XCTAssertEqual(model, "2506BPN68G")
        let params = ParamsProvider()
        params.authMode = 4
        let built = DeviceConfig.SecurityNegotiation.request(params: params, authMode: 4, deviceUUID: androidId, phoneModel: model)
        XCTAssertEqual(try built.serialize(params: params), [sent.bytes])
        // tag layout: 01=04, 02=01, 05=<32 ASCII chars>, 03=01, 04=00, 06=(empty), 07=<phone model>
        XCTAssertEqual(built.tlv!.entries.map { Int($0.tag) }, [1, 2, 5, 3, 4, 6, 7])
        XCTAssertFalse(built.isEncrypted)
    }

    func testSecurityNegotiationResponseForANewIdentityIsAuthType5() throws {
        let tlv = try XCTUnwrap(try packet(try frame("rx", 1, 0x33)).tlv)
        // 01=04 02=01 03=01 04=00 05=watch authId (64 ASCII hex) 06=18 zeros 07= 08=00 09="MAC\0" 0a=00000000
        XCTAssertEqual(try tlv.byte(0x01), 4)
        XCTAssertEqual(try tlv.bytes(0x06), Bytes(repeating: 0, count: 18))
        XCTAssertEqual(try tlv.bytes(0x07), [])
        XCTAssertEqual(try tlv.bytes(0x09), Array("30:A9:98:FC:64:0A".utf8) + [0])
        XCTAssertEqual(try tlv.bytes(0x0A), [0, 0, 0, 0])

        let r = try DeviceConfig.SecurityNegotiation.Response(packet: HuaweiPacket(serviceId: 1, commandId: 0x33, tlv: tlv))
        XCTAssertEqual(r.honorPairType, 1)
        XCTAssertEqual(r.authType, 5)
        XCTAssertEqual(r.responseNonce, [1])
    }

    func testTheSameResponseWithPairType2IsAuthType6ForAKnownIdentity() throws {
        // The Android reconnect (real identity) got tag 0x02 = 02 in the same frame layout.
        let source = try XCTUnwrap(try packet(try frame("rx", 1, 0x33)).tlv)
        var known = HuaweiTLV()
        for entry in source.entries { known.put(Int(entry.tag), bytes: entry.tag == 0x02 ? [2] : entry.value) }
        let r = try DeviceConfig.SecurityNegotiation.Response(packet: HuaweiPacket(serviceId: 1, commandId: 0x33, tlv: known))
        XCTAssertEqual(r.honorPairType, 2)
        XCTAssertEqual(r.authType, 6)
    }

    func testPinCodeRequestAndResponseOnTheWire() throws {
        XCTAssertEqual(try DeviceConfig.PinCode.request().serialize(params: ParamsProvider()), [try frame("tx", 1, 0x2C).bytes])
        let params = ParamsProvider()
        params.authVersion = 1
        params.encryptMethod = 0
        let response = try DeviceConfig.PinCode.Response(packet: try packet(try frame("rx", 1, 0x2C)), params: params)
        XCTAssertEqual(response.pinCode.count, 64)
        for b in response.pinCode {
            XCTAssertLessThanOrEqual(b >> 4, 9)
            XCTAssertLessThanOrEqual(b & 0x0F, 9)
        }
        // A wrong authVersion picks another digest secret and the padding check rejects the plaintext.
        params.authVersion = 2
        XCTAssertThrowsError(try DeviceConfig.PinCode.Response(packet: try packet(try frame("rx", 1, 0x2C)), params: params)) { e in
            guard case .crypto = e as? PacketError else { return XCTFail("\(e)") }
        }
    }

    func testTheTagLengthIsABigEndianBase128VarInt() throws {
        // 523 bytes of JSON in the real HiChain step 1 request: the length is 84 0B.
        var tlv = HuaweiTLV()
        tlv.put(0x01, bytes: Bytes(repeating: 0x41, count: 523))
        XCTAssertEqual(Array(tlv.serialize().prefix(4)), [0x01, 0x84, 0x0B, 0x41])
    }
}

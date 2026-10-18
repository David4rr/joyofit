import XCTest
@testable import HuaweiProtocol

final class FramingTests: XCTestCase {
    let g = try! Golden.load("framing")

    override func tearDown() {
        Entropy.provider = Entropy.systemProvider
    }

    private func params(_ c: [String: Any], counter: Int = 0, key: Bytes? = nil, useKey: Bool = true) -> ParamsProvider {
        let p = ParamsProvider()
        p.sliceSize = c.int("sliceSize")
        p.encryptMethod = UInt8(c.int("encryptMethod"))
        p.deviceSupportType = UInt8(c.int("deviceSupportType"))
        p.secretKey = useKey ? c.optBytes("key") : nil
        p.encryptionCounter = UInt32(counter)
        p.transactionsCrypted = (c["transactionsCrypted"] as? Bool) ?? true
        return p
    }

    func testSerializeMatchesJava() throws {
        XCTAssertFalse(g.list("serialize").isEmpty)
        for c in g.list("serialize") {
            let name = c.str("name")
            let p = params(c, counter: c.int("counterBefore"))
            if let iv = c.optBytes("iv") { Entropy.provider = { _ in iv } }
            let tlv = try HuaweiTLV(parsing: c.bytes("tlv"))
            let packet = HuaweiPacket(
                serviceId: UInt8(c.int("service")), commandId: UInt8(c.int("command")), tlv: tlv,
                isEncrypted: c.bool("encrypted"), isSliced: c.bool("sliced")
            )
            let frames = try packet.serialize(params: p)
            let expected = (c["frames"] as? [String] ?? []).map { Bytes(hex: $0)! }
            XCTAssertEqual(frames.count, expected.count, name)
            for (a, e) in zip(frames, expected) { XCTAssertEqual(a.hexLower, e.hexLower, name) }
            XCTAssertEqual(Int(p.encryptionCounter), c.int("counterAfter"), name)
        }
    }

    /// Mirrors the Kotlin session loop over an assembler.
    private func feed(_ p: ParamsProvider, chunks: [Bytes]) -> [[String: Any]] {
        var assembler = PacketAssembler()
        var out = [[String: Any]]()
        for chunk in chunks {
            var data = chunk
            var left = 0
            repeat {
                if left > 0 { data = Array(data[(data.count - left)...]) }
                let result: PacketAssembler.Result
                do {
                    result = try assembler.feed(data, params: p)
                } catch let e as PacketError {
                    let name: String
                    switch e {
                    case .checksumIncorrect: name = "ChecksumIncorrectException"
                    case .magicMismatch: name = "MagicMismatchException"
                    case .lengthMismatch: name = "LengthMismatchException"
                    case .crypto: name = "CryptoException"
                    default: name = "\(e)"
                    }
                    out.append(["error": name])
                    assembler.reset()
                    break
                } catch {
                    out.append(["error": "\(error)"])
                    assembler.reset()
                    break
                }
                left = result.left
                if let packet = result.packet {
                    var o: [String: Any] = ["service": Int(packet.serviceId), "command": Int(packet.commandId)]
                    if let tlv = packet.tlv {
                        o["tlv"] = tlv.entries.map { ["tag": Int($0.tag), "value": $0.value.hexLower] }
                    } else {
                        o["tlv"] = NSNull()
                    }
                    out.append(o)
                }
            } while left > 0
        }
        return out
    }

    private func normalized(_ value: Any) -> String {
        let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }

    func testReassemblyMatchesJava() throws {
        XCTAssertFalse(g.list("parse").isEmpty)
        for c in g.list("parse") {
            let name = c.str("name")
            let stream = c.bytes("stream")
            let results = c["results"] as! [String: Any]
            for (variant, expected) in results {
                let chunks: [Bytes]
                switch variant {
                case "stream": chunks = [stream]
                case "frames":
                    // Frames are split back out of the stream by their own length fields.
                    var frames = [Bytes](); var offset = 0
                    while offset < stream.count {
                        let size = Int(stream.u16be(offset + 1)) + 5
                        frames.append(Array(stream[offset..<offset + size])); offset += size
                    }
                    chunks = frames
                case "splitInsideSecond":
                    chunks = [Array(stream[0..<(Int(stream.u16be(1)) + 5 + 3)]), Array(stream[(Int(stream.u16be(1)) + 5 + 3)...])]
                case "splitAtHeader": chunks = [Array(stream[0..<2]), Array(stream[2...])]
                default:
                    let size = Int(variant.dropFirst("chunks".count))!
                    chunks = stride(from: 0, to: stream.count, by: size).map { Array(stream[$0..<min(stream.count, $0 + size)]) }
                }
                let got = feed(params(c), chunks: chunks)
                XCTAssertEqual(normalized(got), normalized(expected), "\(name) / \(variant)")
            }
        }
    }

    func testMalformedInput() throws {
        XCTAssertFalse(g.list("malformed").isEmpty)
        for c in g.list("malformed") {
            let got = feed(params(c), chunks: [c.bytes("input")])
            XCTAssertEqual(normalized(got), normalized(c["result"]!), c.str("name"))
            if let payload = c.optBytes("payload") {
                var assembler = PacketAssembler()
                let result = try assembler.feed(c.bytes("input"), params: ParamsProvider())
                XCTAssertEqual(result.packet?.payload, payload)
            }
        }
    }

    func testUnslicedHeader() {
        let packet = HuaweiPacket(serviceId: 1, commandId: 1, tlv: nil, isEncrypted: false, isSliced: false)
        let frame = (try! packet.serialize(params: ParamsProvider()))[0]
        XCTAssertEqual(Array(frame.prefix(6)), [0x5a, 0x00, 0x03, 0x00, 0x01, 0x01])
        XCTAssertEqual(frame.count, 8)
        XCTAssertEqual(frame.u16be(6), CRC16.checksum(Array(frame.prefix(6))))
    }
}

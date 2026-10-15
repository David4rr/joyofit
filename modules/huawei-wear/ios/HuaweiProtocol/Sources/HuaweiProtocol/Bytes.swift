// Byte helpers shared by the protocol layers. All protocol code works on `[UInt8]`; the CoreBluetooth layer converts at the edge.
import Foundation

public typealias Bytes = [UInt8]

extension Array where Element == UInt8 {
    /// Upper-case hex, as Gadgetbridge's `GB.hexdump` / `StringUtils.bytesToHex` (the HiChain JSON and the PIN digest depend on the case).
    public var hexUpper: String {
        let digits = Array("0123456789ABCDEF".utf8)
        var out = [UInt8]()
        out.reserveCapacity(count * 2)
        for b in self {
            out.append(digits[Int(b >> 4)])
            out.append(digits[Int(b & 0x0F)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// Lower-case hex, for logs.
    public var hexLower: String { hexUpper.lowercased() }

    /// Parses hex (either case); odd length or a non-hex digit returns nil.
    public init?(hex: String) {
        let chars = Array(hex.utf8)
        guard chars.count % 2 == 0 else { return nil }
        var out = [UInt8]()
        out.reserveCapacity(chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let hi = Self.nibble(chars[i]), let lo = Self.nibble(chars[i + 1]) else { return nil }
            out.append(UInt8(hi << 4 | lo))
            i += 2
        }
        self = out
    }

    private static func nibble(_ c: UInt8) -> Int? {
        switch c {
        case 0x30...0x39: return Int(c) - 0x30
        case 0x41...0x46: return Int(c) - 0x41 + 10
        case 0x61...0x66: return Int(c) - 0x61 + 10
        default: return nil
        }
    }

    /// Big-endian reads at an offset; they trap on short input like Java's ByteBuffer would throw, so callers check lengths first.
    func u16be(_ offset: Int = 0) -> UInt16 { UInt16(self[offset]) << 8 | UInt16(self[offset + 1]) }
    func u32be(_ offset: Int = 0) -> UInt32 {
        UInt32(self[offset]) << 24 | UInt32(self[offset + 1]) << 16 | UInt32(self[offset + 2]) << 8 | UInt32(self[offset + 3])
    }
    func u64be(_ offset: Int = 0) -> UInt64 { UInt64(u32be(offset)) << 32 | UInt64(u32be(offset + 4)) }
}

/// Big-endian appends (Java `ByteBuffer` default order).
extension Array where Element == UInt8 {
    mutating func appendBE(_ v: UInt16) { append(UInt8(v >> 8)); append(UInt8(v & 0xFF)) }
    mutating func appendBE(_ v: UInt32) { appendBE(UInt16(v >> 16)); appendBE(UInt16(v & 0xFFFF)) }
    mutating func appendBE(_ v: UInt64) { appendBE(UInt32(v >> 32)); appendBE(UInt32(v & 0xFFFF_FFFF)) }
}

extension Data {
    public var bytes: Bytes { Bytes(self) }
}

/// Source of random bytes. The default is the system generator; tests replace it to get reproducible nonces.
public enum Entropy {
    public static let systemProvider: (Int) -> Bytes = { count in
        var g = SystemRandomNumberGenerator()
        return (0..<count).map { _ in UInt8.random(in: 0...255, using: &g) }
    }

    public static var provider: (Int) -> Bytes = systemProvider

    public static func bytes(_ count: Int) -> Bytes { provider(count) }
}

// Port of HuaweiTLV.java (tag byte, VarInt length, value) and its private VarInt.
import Foundation

/// Gadgetbridge's `VarInt`: 7 bits per byte, high bit = continuation, big-endian groups.
enum VarInt {
    static func size(of value: Int) -> Int {
        var v = UInt32(truncatingIfNeeded: value)
        var result = 0
        repeat {
            result += 1
            v >>= 7
        } while v != 0
        return result
    }

    /// Decodes at `offset`; returns the value and how many bytes the *re-encoded* value takes (`VarInt.size`, as GB: a
    /// non-minimal encoding is consumed as its minimal length). Returns nil when the buffer ends mid-VarInt.
    static func decode(_ src: Bytes, at offset: Int) -> (value: Int, size: Int)? {
        var result = 0
        var offset = offset
        while true {
            guard offset < src.count else { return nil }
            let b = Int(Int8(bitPattern: src[offset]))
            result += b & 0x7F
            if b & 0x80 == 0 { break }
            result <<= 7
            offset += 1
        }
        // GB does `getVarIntSize` on the decoded value; Java ints are 32-bit.
        let value = Int(Int32(truncatingIfNeeded: result))
        return (value, size(of: value))
    }

    static func encode(_ value: Int) -> Bytes {
        let size = size(of: value)
        var v = UInt32(truncatingIfNeeded: value)
        var result = Bytes(repeating: 0, count: size)
        result[size - 1] = UInt8(v & 0x7F)
        var i = size - 2
        while i >= 0 {
            v >>= 7
            result[i] = UInt8(v & 0x7F) | 0x80
            i -= 1
        }
        return result
    }
}

public enum TLVError: Error, Equatable {
    case missingTag(UInt8)
    case malformed(String)
}

/// Ordered list of tag/value pairs. Tags may repeat (containers, lists); lookups return the first match like Java.
public struct HuaweiTLV: Equatable, CustomStringConvertible {
    public struct Entry: Equatable {
        public let tag: UInt8
        public let value: Bytes
        public init(tag: UInt8, value: Bytes) { self.tag = tag; self.value = value }
        var length: Int { 1 + VarInt.size(of: value.count) + value.count }
        func serialize() -> Bytes { [tag] + VarInt.encode(value.count) + value }
    }

    public private(set) var entries: [Entry] = []

    public init() {}

    public var length: Int { entries.reduce(0) { $0 + $1.length } }

    /// `HuaweiTLV.parse(buffer, offset, length)`; throws instead of Java's ArrayIndexOutOfBounds.
    public init(parsing buffer: Bytes, offset: Int = 0, length: Int? = nil) throws {
        let length = length ?? buffer.count - offset
        guard offset >= 0, length >= 0, offset + length <= buffer.count else {
            throw TLVError.malformed("TLV range \(offset)+\(length) outside buffer of \(buffer.count)")
        }
        var parsed = 0
        while parsed < length {
            let tag = buffer[offset + parsed]
            parsed += 1
            // "It seems that there can be an extra null byte at the end of something encrypted": ignored.
            if parsed == length && tag == 0 { break }
            guard let varInt = VarInt.decode(buffer, at: offset + parsed) else {
                throw TLVError.malformed("TLV length of tag \(String(tag, radix: 16)) runs past the buffer")
            }
            parsed += varInt.size
            let size = varInt.value
            if size < 0 || size > length - parsed {
                throw TLVError.malformed("TLV element size \(size) exceeds remaining buffer length \(length - parsed)")
            }
            entries.append(Entry(tag: tag, value: Array(buffer[offset + parsed..<offset + parsed + size])))
            parsed += size
        }
    }

    public func serialize() -> Bytes {
        var out = Bytes()
        out.reserveCapacity(length)
        for e in entries { out += e.serialize() }
        return out
    }

    // MARK: building (HuaweiTLV.put overloads)

    @discardableResult public mutating func put(_ tag: Int) -> HuaweiTLV { entries.append(Entry(tag: UInt8(truncatingIfNeeded: tag), value: [])); return self }
    @discardableResult public mutating func put(_ tag: Int, bytes value: Bytes?) -> HuaweiTLV {
        if let value { entries.append(Entry(tag: UInt8(truncatingIfNeeded: tag), value: value)) }
        return self
    }
    @discardableResult public mutating func put(_ tag: Int, byte value: UInt8) -> HuaweiTLV { put(tag, bytes: [value]) }
    @discardableResult public mutating func put(_ tag: Int, bool value: Bool) -> HuaweiTLV { put(tag, bytes: [value ? 1 : 0]) }
    @discardableResult public mutating func put(_ tag: Int, int value: Int32) -> HuaweiTLV {
        var b = Bytes(); b.appendBE(UInt32(bitPattern: value)); return put(tag, bytes: b)
    }
    @discardableResult public mutating func put(_ tag: Int, short value: Int16) -> HuaweiTLV {
        var b = Bytes(); b.appendBE(UInt16(bitPattern: value)); return put(tag, bytes: b)
    }
    @discardableResult public mutating func put(_ tag: Int, long value: Int64) -> HuaweiTLV {
        var b = Bytes(); b.appendBE(UInt64(bitPattern: value)); return put(tag, bytes: b)
    }
    /// Little-endian double, as `put(int, Double)`.
    @discardableResult public mutating func put(_ tag: Int, double value: Double) -> HuaweiTLV {
        let bits = value.bitPattern
        return put(tag, bytes: (0..<8).map { UInt8((bits >> UInt64(8 * $0)) & 0xFF) })
    }
    @discardableResult public mutating func put(_ tag: Int, string value: String?) -> HuaweiTLV {
        guard let value else { return self }
        return put(tag, bytes: Array(value.utf8))
    }
    @discardableResult public mutating func put(_ tag: Int, tlv value: HuaweiTLV?) -> HuaweiTLV {
        guard let value else { return self }
        return put(tag, bytes: value.serialize())
    }

    // MARK: reading

    public func contains(_ tag: Int) -> Bool { entries.contains { $0.tag == UInt8(truncatingIfNeeded: tag) } }

    public func bytes(_ tag: Int) throws -> Bytes {
        guard let e = entries.first(where: { $0.tag == UInt8(truncatingIfNeeded: tag) }) else { throw TLVError.missingTag(UInt8(truncatingIfNeeded: tag)) }
        return e.value
    }

    public func bytes(_ tag: Int, default fallback: Bytes?) -> Bytes? { (try? bytes(tag)) ?? fallback }

    /// `getByte`: the first byte, as a *signed* Java byte.
    public func byte(_ tag: Int) throws -> Int8 {
        let v = try bytes(tag)
        guard !v.isEmpty else { throw TLVError.malformed("tag \(tag) is empty, wanted a byte") }
        return Int8(bitPattern: v[0])
    }

    public func byte(_ tag: Int, default fallback: Int8) -> Int8 { (try? byte(tag)) ?? fallback }

    public func bool(_ tag: Int) throws -> Bool {
        let v = try bytes(tag)
        guard !v.isEmpty else { throw TLVError.malformed("tag \(tag) is empty, wanted a boolean") }
        return v[0] == 1
    }

    public func bool(_ tag: Int, default fallback: Bool) -> Bool { (try? bool(tag)) ?? fallback }

    public func int(_ tag: Int) throws -> Int32 {
        let v = try bytes(tag)
        guard v.count >= 4 else { throw TLVError.malformed("tag \(tag) has \(v.count) bytes, wanted an int") }
        return Int32(bitPattern: v.u32be(0))
    }

    public func int(_ tag: Int, default fallback: Int32) -> Int32 { (try? int(tag)) ?? fallback }

    public func short(_ tag: Int) throws -> Int16 {
        let v = try bytes(tag)
        guard v.count >= 2 else { throw TLVError.malformed("tag \(tag) has \(v.count) bytes, wanted a short") }
        return Int16(bitPattern: v.u16be(0))
    }

    public func short(_ tag: Int, default fallback: Int16) -> Int16 { (try? short(tag)) ?? fallback }

    public func long(_ tag: Int) throws -> Int64 {
        let v = try bytes(tag)
        guard v.count >= 8 else { throw TLVError.malformed("tag \(tag) has \(v.count) bytes, wanted a long") }
        return Int64(bitPattern: v.u64be(0))
    }

    /// `getAsInteger(tag)`: 1 byte unsigned, 2 bytes unsigned, else a 4-byte int.
    public func asInteger(_ tag: Int) throws -> Int32 {
        let v = try bytes(tag)
        if v.count == 1 { return Int32(v[0]) }
        if v.count == 2 { return Int32(v.u16be(0)) }
        guard v.count >= 4 else { throw TLVError.malformed("tag \(tag) has \(v.count) bytes, wanted an integer") }
        return Int32(bitPattern: v.u32be(0))
    }

    /// `getAsInteger(tag, def)`: 1 to 4 bytes big-endian, `def` when absent, empty or longer.
    public func asInteger(_ tag: Int, default fallback: Int32) -> Int32 {
        guard let v = bytes(tag, default: nil), !v.isEmpty, v.count <= 4 else { return fallback }
        var res: UInt32 = 0
        for (i, b) in v.enumerated() { res |= UInt32(b) << UInt32((v.count - i - 1) * 8) }
        return Int32(bitPattern: res)
    }

    public func asLong(_ tag: Int) throws -> Int64 {
        let v = try bytes(tag)
        if v.count == 1 { return Int64(v[0]) }
        if v.count == 2 { return Int64(v.u16be(0)) }
        if v.count == 4 { return Int64(Int32(bitPattern: v.u32be(0))) }
        guard v.count >= 8 else { throw TLVError.malformed("tag \(tag) has \(v.count) bytes, wanted a long") }
        return Int64(bitPattern: v.u64be(0))
    }

    public func string(_ tag: Int) throws -> String { String(decoding: try bytes(tag), as: UTF8.self) }

    public func object(_ tag: Int) throws -> HuaweiTLV { try HuaweiTLV(parsing: try bytes(tag)) }

    /// `getObjects(tag)`: every element with the tag, each parsed as a nested TLV.
    public func objects(_ tag: Int) throws -> [HuaweiTLV] {
        try entries.filter { $0.tag == UInt8(truncatingIfNeeded: tag) }.map { try HuaweiTLV(parsing: $0.value) }
    }

    /// `getAllContainerObjects()`: every element whose tag has bit 7 set, parsed as a nested TLV.
    public func allContainerObjects() throws -> [HuaweiTLV] {
        try entries.filter { $0.tag >> 7 == 1 }.map { try HuaweiTLV(parsing: $0.value) }
    }

    /// Removes the last element with `tag` and returns its value.
    @discardableResult public mutating func remove(_ tag: Int) -> Bytes? {
        guard let index = entries.lastIndex(where: { $0.tag == UInt8(truncatingIfNeeded: tag) }) else { return nil }
        return entries.remove(at: index).value
    }

    public var description: String {
        if entries.isEmpty { return "Empty" }
        return entries.map { "{tag: \(String($0.tag, radix: 16)) - Value: \($0.value.hexUpper)}" }.joined(separator: " - ")
    }

    // MARK: encryption wrapper (tags 124 / 125 / 126)

    public static let tagEncryption = 124
    public static let tagInitVector = 125
    public static let tagCipherText = 126
}

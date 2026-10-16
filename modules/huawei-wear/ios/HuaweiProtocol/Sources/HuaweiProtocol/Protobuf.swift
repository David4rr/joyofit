// Port of Protobuf.kt: the small slice of the protobuf wire format the Huawei P2P messages need (varints, 32-bit floats, length-delimited
// fields); the schemas are a few fixed messages (HealthModel.swift, CourseProtobuf.swift), so there is no library. Negative `int32` values are
// written as 10-byte varints like protobuf-java's `writeInt32`.
import Foundation

public final class PbWriter {
    public static let wireVarint = 0
    public static let wire64Bit = 1
    public static let wireLen = 2
    public static let wire32Bit = 5

    private var out = Bytes()

    public init() {}

    @discardableResult
    public func varintField(_ field: Int, _ value: Int64) -> PbWriter {
        tag(field, PbWriter.wireVarint)
        varint(UInt64(bitPattern: value))
        return self
    }

    /// `int32` / `uint32` / `int64` / `bool` fields.
    @discardableResult
    public func intField(_ field: Int, _ value: Int) -> PbWriter { varintField(field, Int64(value)) }

    /// proto3 skips a field that has its default value; proto2 `required` fields must be written even when 0.
    @discardableResult
    public func intFieldUnlessZero(_ field: Int, _ value: Int) -> PbWriter { value != 0 ? intField(field, value) : self }

    @discardableResult
    public func longFieldUnlessZero(_ field: Int, _ value: Int64) -> PbWriter { value != 0 ? varintField(field, value) : self }

    @discardableResult
    public func floatField(_ field: Int, _ value: Float) -> PbWriter {
        tag(field, PbWriter.wire32Bit)
        let bits = value.bitPattern
        for i in 0..<4 { out.append(UInt8((bits >> UInt32(8 * i)) & 0xFF)) }
        return self
    }

    @discardableResult
    public func floatFieldUnlessZero(_ field: Int, _ value: Float) -> PbWriter { value != 0 ? floatField(field, value) : self }

    @discardableResult
    public func bytesField(_ field: Int, _ value: Bytes) -> PbWriter {
        tag(field, PbWriter.wireLen)
        varint(UInt64(value.count))
        out.append(contentsOf: value)
        return self
    }

    @discardableResult
    public func stringField(_ field: Int, _ value: String) -> PbWriter { bytesField(field, Array(value.utf8)) }

    @discardableResult
    public func stringFieldUnlessEmpty(_ field: Int, _ value: String) -> PbWriter { value.isEmpty ? self : stringField(field, value) }

    @discardableResult
    public func bytesFieldUnlessEmpty(_ field: Int, _ value: Bytes) -> PbWriter { value.isEmpty ? self : bytesField(field, value) }

    public func toBytes() -> Bytes { out }

    private func tag(_ field: Int, _ wire: Int) { varint(UInt64((field << 3) | wire)) }

    private func varint(_ value: UInt64) {
        var v = value
        while v & ~UInt64(0x7F) != 0 {
            out.append(UInt8((v & 0x7F) | 0x80))
            v >>= 7
        }
        out.append(UInt8(v))
    }
}

/// One decoded field; `value` is the varint, the raw 32/64 bits (little endian) or 0 for length-delimited ones, which are in `bytes`.
public struct PbField: Equatable, Sendable {
    public let number: Int
    public let wire: Int
    public let value: Int64
    public let bytes: Bytes?

    public func asInt() -> Int { Int(Int32(truncatingIfNeeded: value)) }

    public func asFloat() -> Float { Float(bitPattern: UInt32(truncatingIfNeeded: value)) }

    public func asString() -> String { String(decoding: bytes ?? [], as: UTF8.self) }
}

/// Thrown for a message that is not valid protobuf (truncated field, bad wire type).
public struct PbError: Error, Equatable, CustomStringConvertible, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var description: String { message }
}

public enum PbReader {
    /// All fields in wire order; repeated fields appear once per occurrence.
    public static func fields(_ data: Bytes) throws -> [PbField] {
        var result = [PbField]()
        var pos = 0
        func readVarint() throws -> Int64 {
            var shift: UInt64 = 0
            var value: UInt64 = 0
            while true {
                if pos >= data.count { throw PbError("truncated varint") }
                let b = data[pos]
                pos += 1
                value |= UInt64(b & 0x7F) << shift
                if b & 0x80 == 0 { return Int64(bitPattern: value) }
                shift += 7
                if shift > 63 { throw PbError("varint too long") }
            }
        }
        while pos < data.count {
            let key = try readVarint()
            let number = Int(truncatingIfNeeded: UInt64(bitPattern: key) >> 3)
            if number <= 0 { throw PbError("field number \(number)") }
            let wire = Int(key & 7)
            switch wire {
            case PbWriter.wireVarint:
                result.append(PbField(number: number, wire: wire, value: try readVarint(), bytes: nil))
            case PbWriter.wire32Bit:
                if pos + 4 > data.count { throw PbError("truncated 32-bit field \(number)") }
                var v: UInt32 = 0
                for i in 0..<4 { v |= UInt32(data[pos + i]) << UInt32(8 * i) }
                pos += 4
                result.append(PbField(number: number, wire: wire, value: Int64(v), bytes: nil))
            case PbWriter.wire64Bit:
                if pos + 8 > data.count { throw PbError("truncated 64-bit field \(number)") }
                var v: UInt64 = 0
                for i in 0..<8 { v |= UInt64(data[pos + i]) << UInt64(8 * i) }
                pos += 8
                result.append(PbField(number: number, wire: wire, value: Int64(bitPattern: v), bytes: nil))
            case PbWriter.wireLen:
                let len = try readVarint()
                if len < 0 || Int64(pos) + len > Int64(data.count) { throw PbError("truncated field \(number) (length \(len))") }
                result.append(PbField(number: number, wire: wire, value: 0, bytes: Array(data[pos..<(pos + Int(len))])))
                pos += Int(len)
            default:
                throw PbError("unsupported wire type \(wire) for field \(number)")
            }
        }
        return result
    }
}

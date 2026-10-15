// Java `ByteBuffer` and the runtime exceptions the sleep file code leans on, for the ports of HuaweiSequenceDataFileParser,
// HuaweiTrueSleepSequenceDataParser, HuaweiTruSleepParser and the two file download BlockResponse classes. GB lets those exceptions
// escape (or catches them as a group); here they are thrown values with the same trigger conditions.
import Foundation

/// A Java runtime exception thrown by one of the sleep file parsers or packet readers.
public enum SleepFilesParseError: Error, Equatable, CustomStringConvertible {
    /// `BufferUnderflowException`: a read past the limit.
    case bufferUnderflow(String)
    /// `NegativeArraySizeException`: `new byte[n]` with `n < 0`.
    case negativeArraySize(Int)
    /// `NullPointerException`: a value Java would dereference is absent.
    case missingInput(String)
    /// `IllegalArgumentException` / `IllegalStateException` of the TruSleep ACC/PPG decoders.
    case illegalArgument(String)
    /// `ArrayIndexOutOfBoundsException` from `HuaweiTLV.parse` on malformed bytes.
    case malformedTLV(String)
    /// `ArrayIndexOutOfBoundsException` on a short payload.
    case payloadTooShort(have: Int, need: Int)

    public var description: String {
        switch self {
        case .bufferUnderflow(let m): return "BufferUnderflowException: \(m)"
        case .negativeArraySize(let n): return "NegativeArraySizeException: \(n)"
        case .missingInput(let m): return "NullPointerException: \(m)"
        case .illegalArgument(let m): return m
        case .malformedTLV(let m): return "ArrayIndexOutOfBoundsException: \(m)"
        case .payloadTooShort(let have, let need): return "ArrayIndexOutOfBoundsException: payload of \(have) bytes, need \(need)"
        }
    }
}

/// `ByteBuffer` over a `[UInt8]`: position and limit, big-endian unless told otherwise, absolute reads past the limit throw.
struct SleepFilesByteBuffer {
    let array: Bytes
    private(set) var position: Int
    let limit: Int
    let littleEndian: Bool

    /// `ByteBuffer.wrap(array)` (`position` 0, `limit` the end) or `wrap(array, offset, length)` (`position` offset, `limit` offset + length).
    init(_ array: Bytes, position: Int = 0, limit: Int? = nil, littleEndian: Bool = false) {
        self.array = array
        self.position = position
        self.limit = limit ?? array.count
        self.littleEndian = littleEndian
    }

    var remaining: Int { limit - position }

    private func need(_ n: Int) throws {
        if remaining < n { throw SleepFilesParseError.bufferUnderflow("need \(n) bytes at position \(position), limit \(limit)") }
    }

    mutating func get() throws -> Int8 {
        try need(1)
        defer { position += 1 }
        return Int8(bitPattern: array[position])
    }

    mutating func getShort() throws -> Int16 {
        try need(2)
        let hi = UInt16(array[position]), lo = UInt16(array[position + 1])
        position += 2
        return Int16(bitPattern: littleEndian ? lo << 8 | hi : hi << 8 | lo)
    }

    mutating func getInt() throws -> Int32 {
        try need(4)
        var v: UInt32 = 0
        for i in 0..<4 {
            let b = UInt32(array[position + (littleEndian ? 3 - i : i)])
            v = v << 8 | b
        }
        position += 4
        return Int32(bitPattern: v)
    }

    /// `byte[] a = new byte[count]; buffer.get(a)`: a negative count is a NegativeArraySizeException, too few remaining bytes an underflow.
    mutating func get(count: Int) throws -> Bytes {
        if count < 0 { throw SleepFilesParseError.negativeArraySize(count) }
        try need(count)
        defer { position += count }
        return Array(array[position..<position + count])
    }
}

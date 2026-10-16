// A ZIP reader with the behaviour of the `ZipInputStream` loop GB's `GBZipFile.getFileFromZip` (and the Kotlin `WatchfacePackages.entry`) use:
// local headers read one after the other from the start, entries stored or deflated, a data descriptor for deflated entries that have one,
// the CRC of the entry that is read verified. Pure Swift (RFC 1951 inflate included) so it builds on Linux and does not need zlib or the
// Compression framework on iOS.
import Foundation

public enum CRC32 {
    private static let table: [UInt32] = (0..<256).map { n -> UInt32 in
        var c = UInt32(n)
        for _ in 0..<8 { c = c & 1 == 1 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    public static func checksum(_ data: ArraySlice<UInt8>) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        for b in data { c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFF_FFFF
    }

    public static func checksum(_ data: Bytes) -> UInt32 { checksum(data[...]) }
}

public enum InflateError: Error, Equatable, CustomStringConvertible {
    case truncated
    case invalid(String)
    case tooLarge

    public var description: String {
        switch self {
        case .truncated: return "the compressed data ends early"
        case .invalid(let m): return "invalid compressed data: \(m)"
        case .tooLarge: return "the data is larger than the limit"
        }
    }
}

/// RFC 1951 DEFLATE.
public enum Inflate {
    private static let lengthBase: [Int] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
    private static let lengthExtra: [Int] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
    private static let distBase: [Int] = [
        1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
    ]
    private static let distExtra: [Int] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
    private static let codeLengthOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

    /// A canonical Huffman code as a lookup table indexed by the next `maxBits` input bits (LSB first): `symbol << 4 | length`, 0 = unused.
    private struct Table {
        var entries: [UInt16]
        var maxBits: Int

        init(lengths: [UInt8]) throws {
            var counts = [Int](repeating: 0, count: 16)
            for l in lengths { counts[Int(l)] += 1 }
            counts[0] = 0
            var maxBits = 0
            for l in 1...15 where counts[l] > 0 { maxBits = l }
            // Over-subscribed sets are invalid; incomplete ones are allowed (a lone distance code), unused codes decode as errors.
            var left = 1
            for l in 1...15 {
                left <<= 1
                left -= counts[l]
                if left < 0 { throw InflateError.invalid("over-subscribed Huffman code") }
            }
            var next = [Int](repeating: 0, count: 17)
            var code = 0
            for bits in 1...15 {
                code = (code + counts[bits - 1]) << 1
                next[bits] = code
            }
            self.maxBits = max(maxBits, 1)
            entries = [UInt16](repeating: 0, count: 1 << self.maxBits)
            for (symbol, l) in lengths.enumerated() where l > 0 {
                let len = Int(l)
                let c = next[len]
                next[len] += 1
                var reversed = 0
                for i in 0..<len where c & (1 << i) != 0 { reversed |= 1 << (len - 1 - i) }
                var index = reversed
                let entry = UInt16(symbol << 4 | len)
                while index < entries.count {
                    entries[index] = entry
                    index += 1 << len
                }
            }
        }
    }

    private struct BitReader {
        let data: Bytes
        var position: Int
        var buffer: UInt64 = 0
        var count = 0

        init(_ data: Bytes, at position: Int) {
            self.data = data
            self.position = position
        }

        mutating func fill() {
            while count <= 56 && position < data.count {
                buffer |= UInt64(data[position]) << UInt64(count)
                position += 1
                count += 8
            }
        }

        mutating func bits(_ n: Int) throws -> Int {
            if n == 0 { return 0 }
            if count < n { fill() }
            guard count >= n else { throw InflateError.truncated }
            let v = Int(buffer & ((1 << UInt64(n)) - 1))
            buffer >>= UInt64(n)
            count -= n
            return v
        }

        mutating func symbol(_ table: Table) throws -> Int {
            if count < table.maxBits { fill() }
            let entry = table.entries[Int(buffer & ((1 << UInt64(table.maxBits)) - 1))]
            let len = Int(entry & 15)
            guard len > 0 else {
                if count < table.maxBits { throw InflateError.truncated }
                throw InflateError.invalid("unused Huffman code")
            }
            guard count >= len else { throw InflateError.truncated }
            buffer >>= UInt64(len)
            count -= len
            return Int(entry >> 4)
        }

        /// Drops the bits of the current byte; stored blocks start on a byte.
        mutating func alignToByte() {
            let drop = count % 8
            buffer >>= UInt64(drop)
            count -= drop
        }

        /// The input position after the last byte this reader has consumed (whole bytes it holds unread are given back).
        var consumedUpTo: Int { position - count / 8 }
    }

    private static let fixedLiteral: Table = {
        var lengths = [UInt8](repeating: 8, count: 288)
        for i in 144..<256 { lengths[i] = 9 }
        for i in 256..<280 { lengths[i] = 7 }
        return try! Table(lengths: lengths)
    }()

    private static let fixedDistance: Table = try! Table(lengths: [UInt8](repeating: 5, count: 30))

    /// Inflates the deflate stream that starts at `start`. Returns the data and the offset just after the stream's last byte.
    public static func inflate(_ input: Bytes, at start: Int, limit: Int) throws -> (data: Bytes, end: Int) {
        var reader = BitReader(input, at: start)
        var out = Bytes()
        var final = false
        while !final {
            final = try reader.bits(1) == 1
            switch try reader.bits(2) {
            case 0:
                reader.alignToByte()
                let len = try reader.bits(16)
                let nlen = try reader.bits(16)
                guard len == (~nlen & 0xFFFF) else { throw InflateError.invalid("stored block length check failed") }
                if out.count + len > limit { throw InflateError.tooLarge }
                // The bit buffer may hold whole bytes of the block already.
                var remaining = len
                while remaining > 0 && reader.count >= 8 {
                    out.append(UInt8(truncatingIfNeeded: try reader.bits(8)))
                    remaining -= 1
                }
                guard reader.position + remaining <= input.count else { throw InflateError.truncated }
                out += input[reader.position..<reader.position + remaining]
                reader.position += remaining
            case 1:
                try block(&reader, &out, fixedLiteral, fixedDistance, limit)
            case 2:
                let nlen = try reader.bits(5) + 257
                let ndist = try reader.bits(5) + 1
                let ncode = try reader.bits(4) + 4
                guard nlen <= 286, ndist <= 30 else { throw InflateError.invalid("too many length or distance codes") }
                var lengths = [UInt8](repeating: 0, count: 19)
                for i in 0..<ncode { lengths[codeLengthOrder[i]] = UInt8(try reader.bits(3)) }
                let codeTable = try Table(lengths: lengths)
                var all = [UInt8]()
                all.reserveCapacity(nlen + ndist)
                while all.count < nlen + ndist {
                    let sym = try reader.symbol(codeTable)
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
                        times = 3 + (try reader.bits(2))
                    case 17: times = 3 + (try reader.bits(3))
                    default: times = 11 + (try reader.bits(7))
                    }
                    guard all.count + times <= nlen + ndist else { throw InflateError.invalid("too many code lengths") }
                    all += [UInt8](repeating: repeatValue, count: times)
                }
                guard all[256] != 0 else { throw InflateError.invalid("no end-of-block code") }
                try block(&reader, &out, try Table(lengths: Array(all[0..<nlen])), try Table(lengths: Array(all[nlen...])), limit)
            default:
                throw InflateError.invalid("reserved block type")
            }
        }
        return (out, reader.consumedUpTo)
    }

    private static func block(_ reader: inout BitReader, _ out: inout Bytes, _ literal: Table, _ distance: Table, _ limit: Int) throws {
        while true {
            let sym = try reader.symbol(literal)
            if sym < 256 {
                if out.count >= limit { throw InflateError.tooLarge }
                out.append(UInt8(sym))
            } else if sym == 256 {
                return
            } else {
                let index = sym - 257
                guard index < lengthBase.count else { throw InflateError.invalid("bad length symbol") }
                let length = lengthBase[index] + (try reader.bits(lengthExtra[index]))
                let dsym = try reader.symbol(distance)
                guard dsym < distBase.count else { throw InflateError.invalid("bad distance symbol") }
                let dist = distBase[dsym] + (try reader.bits(distExtra[dsym]))
                guard dist <= out.count else { throw InflateError.invalid("distance too far back") }
                if out.count + length > limit { throw InflateError.tooLarge }
                var from = out.count - dist
                for _ in 0..<length {
                    out.append(out[from])
                    from += 1
                }
            }
        }
    }
}

public enum ZipReader {
    /// What a read entry may inflate to (a bound against zip bombs; real watch faces are a few MiB).
    public static let maxEntryBytes = 256 * 1024 * 1024

    /// The data of the entry called `name`, or nil when there is none, it is a directory, or `zip` is no (readable) zip at all: Java's
    /// `ZipException` and `IOException` end the search the same way. Entries before the wanted one are skipped without being inflated when
    /// their size is known.
    public static func entry(_ zip: Bytes, named name: String) -> Bytes? {
        var pos = 0
        while true {
            guard pos + 30 <= zip.count, zip.u32le(pos) == 0x0403_4B50 else { return nil }
            let flags = Int(zip.u16le(pos + 6))
            let method = Int(zip.u16le(pos + 8))
            let crc = zip.u32le(pos + 14)
            let compressedSize = Int(zip.u32le(pos + 18))
            let size = Int(zip.u32le(pos + 22))
            let nameLength = Int(zip.u16le(pos + 26))
            let extraLength = Int(zip.u16le(pos + 28))
            let dataStart = pos + 30 + nameLength + extraLength
            guard dataStart <= zip.count else { return nil }
            let entryName = String(decoding: zip[(pos + 30)..<(pos + 30 + nameLength)], as: UTF8.self)
            let hasDescriptor = flags & 8 != 0
            let wanted = entryName == name

            switch method {
            case 0:
                // Java: stored entries cannot have a data descriptor, and their size is in the header.
                guard !hasDescriptor, compressedSize == size, dataStart + size <= zip.count else { return nil }
                if wanted {
                    let data = Array(zip[dataStart..<dataStart + size])
                    return CRC32.checksum(data) == crc ? data : nil
                }
                pos = dataStart + size
            case 8:
                if !hasDescriptor {
                    guard dataStart + compressedSize <= zip.count else { return nil }
                    if !wanted {
                        pos = dataStart + compressedSize
                        continue
                    }
                }
                guard let inflated = try? Inflate.inflate(zip, at: dataStart, limit: maxEntryBytes) else { return nil }
                var end = inflated.end
                if hasDescriptor {
                    // A data descriptor: optional signature, then CRC and the two sizes.
                    if end + 4 <= zip.count && zip.u32le(end) == 0x0807_4B50 { end += 4 }
                    guard end + 12 <= zip.count else { return nil }
                    guard zip.u32le(end) == CRC32.checksum(inflated.data), Int(zip.u32le(end + 8)) == inflated.data.count else { return nil }
                    end += 12
                } else {
                    guard inflated.data.count == size, CRC32.checksum(inflated.data) == crc else { return nil }
                    end = dataStart + compressedSize
                }
                if wanted { return inflated.data }
                pos = end
            default:
                return nil
            }
        }
    }
}

extension Array where Element == UInt8 {
    func u16le(_ o: Int) -> UInt16 { UInt16(self[o]) | UInt16(self[o + 1]) << 8 }
    func u32le(_ o: Int) -> UInt32 { UInt32(u16le(o)) | UInt32(u16le(o + 2)) << 16 }
}

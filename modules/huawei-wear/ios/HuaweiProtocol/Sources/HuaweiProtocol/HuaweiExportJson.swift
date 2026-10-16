// The Huawei Privacy Centre export format is undocumented. The layout and quirks handled here come from reading what community converters report
// about real exports: m1ty/huawei2gpx, JordyThien/Huawei-Health-Importer and driemekasten/hhealth2zepp (all MIT; see NOTICE). No code was copied
// from them or from Hitrava (NPOSL).
//
// Port of HuaweiExportJson.kt. Streaming access to the JSON files of a Huawei export: they are one big array (or one object) of records, some
// tens of MB, and a record can be invalid JSON. So the file is cut into top-level `{...}` records by a string-aware brace counter, and every
// record is parsed (and, if need be, repaired) on its own: one bad record costs only itself. Works on UTF-8 bytes, chunk by chunk, so a file is
// never held whole.
import Foundation

/// A parsed JSON value with the kinds `org.json` hands the Kotlin code: numbers are doubles, an explicit `null` is `.null` (distinct from a key
/// that is absent, as `JSONObject.opt` distinguishes `JSONObject.NULL` from null).
public enum ExportJSON: Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([ExportJSON])
    case object([String: ExportJSON])

    public var asObject: [String: ExportJSON]? {
        if case .object(let o) = self { return o }
        return nil
    }

    public var asArray: [ExportJSON]? {
        if case .array(let a) = self { return a }
        return nil
    }
}

public typealias ExportRecord = [String: ExportJSON]

extension Dictionary where Key == String, Value == ExportJSON {
    /// `JSONObject.optString(name, default)`: a string as is, a number or boolean as its text, anything else the default.
    func optString(_ key: String, _ fallback: String) -> String {
        switch self[key] {
        case .string(let s): return s
        case .number(let d): return HuaweiExportJson.numberText(d)
        case .bool(let b): return b ? "true" : "false"
        default: return fallback
        }
    }

    func optArray(_ key: String) -> [ExportJSON]? { self[key]?.asArray }
    func optObject(_ key: String) -> ExportRecord? { self[key]?.asObject }
}

/// Kotlin's number conversions, which saturate instead of trapping.
enum KotlinNumbers {
    /// `Double.toLong()`: truncates toward zero, NaN is 0, out of range clamps.
    static func toLong(_ d: Double) -> Int64 {
        if d.isNaN { return 0 }
        if d >= 9_223_372_036_854_775_807.0 { return Int64.max }
        if d <= -9_223_372_036_854_775_808.0 { return Int64.min }
        return Int64(d)
    }

    /// `Double.roundToLong()`: halves round toward positive infinity (`Math.round`).
    static func roundToLong(_ d: Double) -> Int64 {
        if d.isNaN { return 0 }
        let floor = d.rounded(.down)
        return toLong(d - floor >= 0.5 ? floor + 1 : floor)
    }

    /// `Double.roundToInt()`: the 32-bit `Int` Kotlin has, clamped at its ends. Returned as a Swift `Int`.
    static func roundToInt(_ d: Double) -> Int {
        Int(min(max(roundToLong(d), Int64(Int32.min)), Int64(Int32.max)))
    }
}

public enum HuaweiExportJson {
    /// A record longer than this many bytes is skipped instead of held in memory.
    public static let maxRecordBytes = 48_000_000

    // MARK: records

    /// Cuts a stream of bytes into the text of its top-level objects, in order. Anything outside objects (the array brackets, commas, a BOM) is
    /// ignored. An object still open at `finish()` (a stray quote made the counter lose track) goes to `onUnterminated`; one over the size limit
    /// is counted by `onOversized`. Feed it the chunks of a file, then call `finish()`.
    public final class RecordScanner {
        private let onRecord: (Bytes) throws -> Void
        private let onUnterminated: (Bytes) throws -> Void
        private let onOversized: () throws -> Void
        private let maxRecordBytes: Int

        private var record = Bytes()
        private var depth = 0
        private var inString = false
        private var escaped = false
        /// False while skipping a record that grew past the limit.
        private var keeping = true

        public init(
            maxRecordBytes: Int = HuaweiExportJson.maxRecordBytes, onRecord: @escaping (Bytes) throws -> Void,
            onUnterminated: @escaping (Bytes) throws -> Void, onOversized: @escaping () throws -> Void
        ) {
            self.maxRecordBytes = maxRecordBytes
            self.onRecord = onRecord
            self.onUnterminated = onUnterminated
            self.onOversized = onOversized
        }

        public func feed(_ chunk: Bytes) throws {
            try chunk.withUnsafeBufferPointer { p in
                var i = 0
                let n = p.count
                // Start of the part of this chunk that belongs to the current record and has not been appended yet.
                var segment = 0
                while i < n {
                    let c = p[i]
                    if depth == 0 {
                        if c == 0x7B {
                            depth = 1
                            inString = false
                            escaped = false
                            keeping = true
                            record.removeAll(keepingCapacity: true)
                            segment = i
                        }
                        i += 1
                        continue
                    }
                    if inString {
                        if escaped {
                            escaped = false
                        } else if c == 0x5C {
                            escaped = true
                        } else if c == 0x22 {
                            inString = false
                        }
                        i += 1
                        continue
                    }
                    switch c {
                    case 0x22: inString = true
                    case 0x7B, 0x5B: depth += 1
                    case 0x7D, 0x5D:
                        depth -= 1
                        if depth == 0 {
                            if keeping {
                                record.append(contentsOf: UnsafeBufferPointer(rebasing: p[segment...i]))
                                if record.count > maxRecordBytes { keeping = false }
                            }
                            if keeping {
                                let done = record
                                record = Bytes()
                                try onRecord(done)
                            } else {
                                record = Bytes()
                                try onOversized()
                            }
                            segment = n
                        }
                    default: break
                    }
                    i += 1
                }
                if depth > 0 && keeping {
                    record.append(contentsOf: UnsafeBufferPointer(rebasing: p[segment..<n]))
                    if record.count > maxRecordBytes {
                        keeping = false
                        record = Bytes()
                    }
                }
            }
        }

        public func finish() throws {
            guard depth > 0 else { return }
            depth = 0
            if keeping {
                let text = record
                record = Bytes()
                try onUnterminated(text)
            } else {
                try onOversized()
            }
        }
    }

    /// Cuts `data`, fed in pieces of `pieceSize` bytes, into records; for tests and small inputs.
    public static func forEachRecord(
        _ data: Bytes, pieceSize: Int = 16 * 1024, maxRecordBytes: Int = HuaweiExportJson.maxRecordBytes,
        onRecord: @escaping (Bytes) throws -> Void, onUnterminated: @escaping (Bytes) throws -> Void, onOversized: @escaping () throws -> Void
    ) throws {
        let scanner = RecordScanner(maxRecordBytes: maxRecordBytes, onRecord: onRecord, onUnterminated: onUnterminated, onOversized: onOversized)
        var at = 0
        while at < data.count {
            let to = min(data.count, at + max(1, pieceSize))
            try scanner.feed(Array(data[at..<to]))
            at = to
        }
        try scanner.finish()
    }

    // MARK: parsing

    /// Parses one record; retries once with bare numeric keys quoted (Huawei writes some maps as `{1.0:439.0,2.0:451.0}`). Nil when the record is
    /// not usable JSON.
    public static func parseObject(_ text: Bytes) -> ExportRecord? {
        if let record = ExportJSONReader.parseObject(text) { return record }
        return ExportJSONReader.parseObject(quoteNumericKeys(text))
    }

    public static func parseObject(_ text: String) -> ExportRecord? { parseObject(Bytes(text.utf8)) }

    /// The same replacement the Kotlin regex `([{,])\s*(-?\d+(?:\.\d+)?)\s*:` makes, everywhere in the text (inside strings too).
    static func quoteNumericKeys(_ text: Bytes) -> Bytes {
        var out = Bytes()
        out.reserveCapacity(text.count + 64)
        func isSpace(_ c: UInt8) -> Bool { c == 0x20 || (c >= 0x09 && c <= 0x0D) }  // Java's \s
        func isDigit(_ c: UInt8) -> Bool { c >= 0x30 && c <= 0x39 }
        var i = 0
        let n = text.count
        while i < n {
            let c = text[i]
            guard c == 0x7B || c == 0x2C else {
                out.append(c)
                i += 1
                continue
            }
            var j = i + 1
            while j < n, isSpace(text[j]) { j += 1 }
            let numberStart = j
            if j < n, text[j] == 0x2D { j += 1 }
            let digitsStart = j
            while j < n, isDigit(text[j]) { j += 1 }
            var matched = j > digitsStart
            if matched, j + 1 < n, text[j] == 0x2E, isDigit(text[j + 1]) {
                j += 1
                while j < n, isDigit(text[j]) { j += 1 }
            }
            let numberEnd = j
            if matched {
                while j < n, isSpace(text[j]) { j += 1 }
                matched = j < n && text[j] == 0x3A
            }
            if matched {
                out.append(c)
                out.append(0x22)
                out.append(contentsOf: text[numberStart..<numberEnd])
                out.append(0x22)
                out.append(0x3A)
                i = j + 1
            } else {
                out.append(c)
                i += 1
            }
        }
        return out
    }

    // MARK: values

    /// A JSON number, or a number written as a string (`"82.0"`); nil for anything else and for NaN and infinities.
    public static func number(_ value: ExportJSON?) -> Double? {
        switch value {
        case .number(let d): return d.isFinite ? d : nil
        case .string(let s): return javaDouble(s.trimmingCharacters(in: .whitespacesAndNewlines))
        default: return nil
        }
    }

    /// An object, or an object written as a JSON string (Huawei embeds `{"avgSaturation":97}` in `value`).
    public static func embeddedObject(_ value: ExportJSON?) -> ExportRecord? {
        switch value {
        case .object(let o): return o
        case .string(let s):
            let text = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return text.hasPrefix("{") ? parseObject(text) : nil
        default: return nil
        }
    }

    private static let minEpochMs: Int64 = 946_684_800_000  // 2000-01-01
    private static let maxEpochMs: Int64 = 4_102_444_800_000  // 2100-01-01

    /// A unix time in milliseconds (or, for values below 1e11, in seconds) as milliseconds; nil outside 2000..2100.
    public static func epochMs(_ value: ExportJSON?) -> Int64? {
        guard let v = number(value) else { return nil }
        let ms = abs(v) < 1e11 ? v * 1000.0 : v
        let rounded = KotlinNumbers.toLong(ms)
        return (minEpochMs...maxEpochMs).contains(rounded) ? rounded : nil
    }

    /// Kotlin's `String.toDoubleOrNull` on a decimal: optional sign, digits with an optional fraction or a bare fraction, an optional exponent
    /// and the `f`/`d` suffix Java allows. Words (`NaN`, `Infinity`), hex and anything else are nil here (the callers drop non-finite values anyway).
    public static func javaDouble(_ s: String) -> Double? {
        var b = Array(s.utf8)
        guard !b.isEmpty else { return nil }
        if let last = b.last, last == 0x66 || last == 0x46 || last == 0x64 || last == 0x44 { b.removeLast() }
        var i = 0
        if i < b.count, b[i] == 0x2B || b[i] == 0x2D { i += 1 }
        func digits() -> Int {
            let from = i
            while i < b.count, b[i] >= 0x30, b[i] <= 0x39 { i += 1 }
            return i - from
        }
        let whole = digits()
        var fraction = 0
        if i < b.count, b[i] == 0x2E {
            i += 1
            fraction = digits()
        }
        guard whole + fraction > 0 else { return nil }
        if i < b.count, b[i] == 0x65 || b[i] == 0x45 {
            i += 1
            if i < b.count, b[i] == 0x2B || b[i] == 0x2D { i += 1 }
            guard digits() > 0 else { return nil }
        }
        guard i == b.count else { return nil }
        guard let d = Double(String(decoding: b, as: UTF8.self)), d.isFinite else { return nil }
        return d
    }

    /// `JSON.toString` of a number: whole values without a fraction.
    static func numberText(_ d: Double) -> String {
        if d.isFinite, d == d.rounded(), abs(d) < 1e15 { return String(Int64(d)) }
        return "\(d)"
    }
}

/// A JSON reader over UTF-8 bytes that accepts what `org.json` accepts from a Huawei export: ordinary JSON, raw control characters inside
/// strings, trailing commas, and anything after the closing brace is ignored.
enum ExportJSONReader {
    private static let maxDepth = 256

    struct Failure: Error {}

    static func parseObject(_ bytes: Bytes) -> ExportRecord? {
        bytes.withUnsafeBufferPointer { p -> ExportRecord? in
            var reader = Reader(p: p, i: 0)
            reader.skipSpace()
            guard reader.i < p.count, p[reader.i] == 0x7B else { return nil }
            guard let value = try? reader.value(depth: 0), case .object(let o) = value else { return nil }
            return o
        }
    }

    private struct Reader {
        let p: UnsafeBufferPointer<UInt8>
        var i: Int

        mutating func skipSpace() {
            while i < p.count, p[i] == 0x20 || p[i] == 0x0A || p[i] == 0x0D || p[i] == 0x09 { i += 1 }
        }

        mutating func value(depth: Int) throws -> ExportJSON {
            guard depth < ExportJSONReader.maxDepth else { throw Failure() }
            skipSpace()
            guard i < p.count else { throw Failure() }
            switch p[i] {
            case 0x7B: return try object(depth: depth)
            case 0x5B: return try array(depth: depth)
            case 0x22: return .string(try string())
            case 0x74: try literal("true"); return .bool(true)
            case 0x66: try literal("false"); return .bool(false)
            case 0x6E: try literal("null"); return .null
            default: return .number(try number())
            }
        }

        mutating func literal(_ word: StaticString) throws {
            let n = word.utf8CodeUnitCount
            guard i + n <= p.count else { throw Failure() }
            for k in 0..<n where p[i + k] != word.utf8Start[k] { throw Failure() }
            i += n
        }

        mutating func number() throws -> Double {
            let start = i
            if i < p.count, p[i] == 0x2D { i += 1 }
            let digitsStart = i
            while i < p.count, p[i] >= 0x30, p[i] <= 0x39 { i += 1 }
            guard i > digitsStart else { throw Failure() }
            if i < p.count, p[i] == 0x2E {
                i += 1
                let f = i
                while i < p.count, p[i] >= 0x30, p[i] <= 0x39 { i += 1 }
                guard i > f else { throw Failure() }
            }
            if i < p.count, p[i] == 0x65 || p[i] == 0x45 {
                i += 1
                if i < p.count, p[i] == 0x2B || p[i] == 0x2D { i += 1 }
                let e = i
                while i < p.count, p[i] >= 0x30, p[i] <= 0x39 { i += 1 }
                guard i > e else { throw Failure() }
            }
            guard let d = Double(String(decoding: UnsafeBufferPointer(rebasing: p[start..<i]), as: UTF8.self)) else { throw Failure() }
            return d
        }

        mutating func string() throws -> String {
            i += 1  // the opening quote
            let start = i
            // Fast path: no escapes.
            while i < p.count, p[i] != 0x22, p[i] != 0x5C { i += 1 }
            guard i < p.count else { throw Failure() }
            if p[i] == 0x22 {
                let s = String(decoding: UnsafeBufferPointer(rebasing: p[start..<i]), as: UTF8.self)
                i += 1
                return s
            }
            var out = Bytes(UnsafeBufferPointer(rebasing: p[start..<i]))
            while true {
                guard i < p.count else { throw Failure() }
                let c = p[i]
                if c == 0x22 {
                    i += 1
                    return String(decoding: out, as: UTF8.self)
                }
                guard c == 0x5C else {
                    out.append(c)
                    i += 1
                    continue
                }
                i += 1
                guard i < p.count else { throw Failure() }
                let e = p[i]
                i += 1
                switch e {
                case 0x22, 0x5C, 0x2F: out.append(e)
                case 0x62: out.append(0x08)
                case 0x66: out.append(0x0C)
                case 0x6E: out.append(0x0A)
                case 0x72: out.append(0x0D)
                case 0x74: out.append(0x09)
                case 0x75:
                    var scalar = try hex4()
                    if scalar >= 0xD800 && scalar < 0xDC00, i + 1 < p.count, p[i] == 0x5C, p[i + 1] == 0x75 {
                        let save = i
                        i += 2
                        let low = try hex4()
                        if low >= 0xDC00 && low < 0xE000 {
                            scalar = 0x10000 + ((scalar - 0xD800) << 10) + (low - 0xDC00)
                        } else {
                            i = save
                        }
                    }
                    out.append(contentsOf: Array(String(Unicode.Scalar(scalar) ?? "\u{FFFD}").utf8))
                default: throw Failure()
                }
            }
        }

        mutating func hex4() throws -> UInt32 {
            guard i + 4 <= p.count else { throw Failure() }
            var v: UInt32 = 0
            for _ in 0..<4 {
                let c = p[i]
                let d: UInt32
                switch c {
                case 0x30...0x39: d = UInt32(c) - 0x30
                case 0x41...0x46: d = UInt32(c) - 0x41 + 10
                case 0x61...0x66: d = UInt32(c) - 0x61 + 10
                default: throw Failure()
                }
                v = v << 4 | d
                i += 1
            }
            return v
        }

        mutating func array(depth: Int) throws -> ExportJSON {
            i += 1
            var items = [ExportJSON]()
            while true {
                skipSpace()
                guard i < p.count else { throw Failure() }
                if p[i] == 0x5D {
                    i += 1
                    return .array(items)
                }
                items.append(try value(depth: depth + 1))
                skipSpace()
                guard i < p.count else { throw Failure() }
                if p[i] == 0x2C {
                    i += 1
                } else if p[i] == 0x5D {
                    i += 1
                    return .array(items)
                } else {
                    throw Failure()
                }
            }
        }

        mutating func object(depth: Int) throws -> ExportJSON {
            i += 1
            var members = ExportRecord()
            while true {
                skipSpace()
                guard i < p.count else { throw Failure() }
                if p[i] == 0x7D {
                    i += 1
                    return .object(members)
                }
                guard p[i] == 0x22 else { throw Failure() }
                let key = try string()
                skipSpace()
                guard i < p.count, p[i] == 0x3A else { throw Failure() }
                i += 1
                members[key] = try value(depth: depth + 1)
                skipSpace()
                guard i < p.count else { throw Failure() }
                if p[i] == 0x2C {
                    i += 1
                } else if p[i] == 0x7D {
                    i += 1
                    return .object(members)
                } else {
                    throw Failure()
                }
            }
        }
    }
}

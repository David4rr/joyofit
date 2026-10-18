// Port of SafetyPayloads.kt: the JSON of DataSync config 900500038 (fall detection, package `hw.unitedevice.sos` <-> `hw.watch.sos.help`)
// and of event 800100040 (the watch's SOS SMS request, `hw.unitedevice.safetyguard` <-> `hw.watch.safetyguard`) as Huawei Health 17.0.8.300
// behaves on the wire. iOS apps cannot send SMS, so the SOS request is only parsed and always answered `status: "1"` (nothing sent).
import Foundation

public enum SafetyPayloads {
    public static let fallConfigId = 900_500_038
    public static let fallPhonePackage = "hw.unitedevice.sos"
    public static let fallWatchPackage = "hw.watch.sos.help"

    /// Config actions: 1 sets, 2 queries (no data).
    public static let actionSet = 1
    public static let actionQuery = 2

    public static let sosEventId = 800_100_040
    public static let sosPhonePackage = "hw.unitedevice.safetyguard"
    public static let sosWatchPackage = "hw.watch.safetyguard"
    public static let statusSent = "0"
    public static let statusFailed = "1"

    /// `{"fallDetectionSwitch": 0|1, "timeStamp": ms}`, key order as Huawei writes it.
    public static func fallConfig(enabled: Bool, timeStampMs: Int64) -> Bytes {
        Bytes("{\"fallDetectionSwitch\":\(enabled ? 1 : 0),\"timeStamp\":\(timeStampMs)}".utf8)
    }

    /// The fall detection state the watch reported: `switchState` 0 / 1 and its timestamp.
    public struct FallState: Equatable, Sendable {
        public let switchState: Int
        public let timeStampMs: Int64
    }

    /// nil when the JSON is unusable: not an object, no `fallDetectionSwitch`, or a value other than 0 and 1.
    public static func parseFallConfig(_ data: Bytes?) -> FallState? {
        guard let data, !data.isEmpty,
              let object = (try? JSONSerialization.jsonObject(with: Data(data))) as? [String: Any],
              let raw = object["fallDetectionSwitch"] else { return nil }
        guard let value = optInt(raw), value == 0 || value == 1 else { return nil }
        return FallState(switchState: Int(value), timeStampMs: object["timeStamp"].flatMap(optInt) ?? 0)
    }

    /// `JSONObject.optInt` coercion: numbers truncate, numeric strings parse, anything else (booleans included) is absent.
    private static func optInt(_ value: Any) -> Int64? {
        if let number = value as? NSNumber {
            // JSON true / false are bool NSNumbers (objCType "c"); Android's optInt treats them as absent.
            if String(cString: number.objCType) == "c" { return nil }
            return Int64(exactly: number.doubleValue.rounded(.towardZero)) ?? number.int64Value
        }
        if let text = value as? String, let parsed = Double(text.trimmingCharacters(in: .whitespaces)) {
            return Int64(exactly: parsed.rounded(.towardZero))
        }
        return nil
    }

    // MARK: SOS relay

    /// What the watch asked the phone to send. `raw` is the exact JSON text, echoed back in the answer.
    public struct SosRequest: Equatable, Sendable {
        public let raw: String
        public let phoneNumber: String
        public let content: String
    }

    public enum SosParse: Equatable, Sendable {
        case ok(SosRequest)
        /// `raw` is the text when it was readable JSON, for the answer.
        case bad(reason: String, raw: String?)
    }

    /// The watch's request: UTF-8 JSON object with `phoneNumber` (trimmed) and `content`, both non-empty.
    public static func parseSos(_ data: Bytes?) -> SosParse {
        guard let data, !data.isEmpty else { return .bad(reason: "the event has no data", raw: nil) }
        let text = String(decoding: data, as: UTF8.self)
        guard case .object(let members)? = OrderedJSON.parse(text) else { return .bad(reason: "the data is not JSON", raw: nil) }
        func optString(_ key: String) -> String { members.first { $0.0 == key }.map { $0.1.coercedString } ?? "" }
        let number = optString("phoneNumber").trimmingCharacters(in: .whitespacesAndNewlines)
        let content = optString("content")
        if number.isEmpty || content.isEmpty { return .bad(reason: "phoneNumber or content is missing or empty", raw: text) }
        return .ok(SosRequest(raw: text, phoneNumber: number, content: content))
    }

    /// The reply: the watch's JSON with `status` added (replaced in place when present); `{"status":"1"}` alone when it was unreadable.
    public static func sosAnswer(raw: String?, sent: Bool) -> Bytes {
        var members: [(String, OrderedJSON)] = []
        if let raw, case .object(let parsed)? = OrderedJSON.parse(raw) { members = parsed }
        let status = OrderedJSON.string(sent ? statusSent : statusFailed)
        if let i = members.firstIndex(where: { $0.0 == "status" }) { members[i].1 = status } else { members.append(("status", status)) }
        return Bytes(OrderedJSON.object(members).serialized.utf8)
    }

    /// A phone number for the log: only the last two digits survive.
    public static func maskNumber(_ number: String) -> String {
        let digits = number.filter { $0.unicodeScalars.allSatisfy { $0.properties.numericType == .decimal } }
        return digits.count <= 2 ? "**" : String(repeating: "*", count: digits.count - 2) + String(digits.suffix(2))
    }
}

/// A JSON value that keeps object key order and number text, serialized the way Android's `org.json` does (`/` escaped, insertion order),
/// so the SOS answer echoes what the watch wrote. Strict JSON (Android's reader also accepts single quotes and unquoted keys; the watch sends neither).
enum OrderedJSON: Equatable {
    case string(String)
    case number(String)
    case bool(Bool)
    case null
    indirect case array([OrderedJSON])
    case object([(String, OrderedJSON)])

    static func == (a: OrderedJSON, b: OrderedJSON) -> Bool { a.serialized == b.serialized }

    /// `JSON.toString(Object)`: what `JSONObject.optString` returns for a non-string value.
    var coercedString: String {
        if case .string(let s) = self { return s }
        return serialized
    }

    var serialized: String {
        switch self {
        case .string(let s): return Self.quote(s)
        case .number(let n): return n
        case .bool(let b): return b ? "true" : "false"
        case .null: return "null"
        case .array(let items): return "[" + items.map(\.serialized).joined(separator: ",") + "]"
        case .object(let members): return "{" + members.map { Self.quote($0.0) + ":" + $0.1.serialized }.joined(separator: ",") + "}"
        }
    }

    /// `JSONStringer.string`: `"` `\\` `/` `\b \f \n \r \t`, other controls and U+2028 / U+2029 as `\uXXXX`.
    private static func quote(_ s: String) -> String {
        var out = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"", "\\", "/": out += "\\" + String(u)
            case "\u{8}": out += "\\b"
            case "\u{C}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if u.value <= 0x1F || u.value == 0x2028 || u.value == 0x2029 {
                    out += String(format: "\\u%04x", u.value)
                } else {
                    out.unicodeScalars.append(u)
                }
            }
        }
        return out + "\""
    }

    /// The first value of `text` (trailing text is ignored, like `new JSONObject(text)`); nil when it is not valid JSON.
    static func parse(_ text: String) -> OrderedJSON? {
        var parser = Parser(units: Array(text.utf16))
        return parser.value(depth: 0)
    }

    private struct Parser {
        let units: [UInt16]
        var i = 0

        init(units: [UInt16]) { self.units = units }

        mutating func skip() { while i < units.count, [0x20, 0x09, 0x0A, 0x0D].contains(units[i]) { i += 1 } }

        mutating func value(depth: Int) -> OrderedJSON? {
            if depth > 200 { return nil }
            skip()
            guard i < units.count else { return nil }
            switch units[i] {
            case unit("{"): return object(depth: depth)
            case unit("["): return array(depth: depth)
            case unit("\""): return string().map { .string($0) }
            default: return literal()
            }
        }

        mutating func object(depth: Int) -> OrderedJSON? {
            i += 1
            var members: [(String, OrderedJSON)] = []
            skip()
            if i < units.count, units[i] == unit("}") { i += 1; return .object(members) }
            while true {
                skip()
                guard i < units.count, units[i] == unit("\""), let key = string() else { return nil }
                skip()
                guard i < units.count, units[i] == unit(":") else { return nil }
                i += 1
                guard let v = value(depth: depth + 1) else { return nil }
                if let at = members.firstIndex(where: { $0.0 == key }) { members[at].1 = v } else { members.append((key, v)) }
                skip()
                guard i < units.count else { return nil }
                if units[i] == unit(",") { i += 1; continue }
                if units[i] == unit("}") { i += 1; return .object(members) }
                return nil
            }
        }

        mutating func array(depth: Int) -> OrderedJSON? {
            i += 1
            var items: [OrderedJSON] = []
            skip()
            if i < units.count, units[i] == unit("]") { i += 1; return .array(items) }
            while true {
                guard let v = value(depth: depth + 1) else { return nil }
                items.append(v)
                skip()
                guard i < units.count else { return nil }
                if units[i] == unit(",") { i += 1; continue }
                if units[i] == unit("]") { i += 1; return .array(items) }
                return nil
            }
        }

        mutating func string() -> String? {
            i += 1
            var out: [UInt16] = []
            while i < units.count {
                let u = units[i]
                i += 1
                if u == unit("\"") { return String(decoding: out, as: UTF16.self) }
                if u < 0x20 { return nil }
                if u != unit("\\") { out.append(u); continue }
                guard i < units.count else { return nil }
                let e = units[i]
                i += 1
                switch e {
                case unit("n"): out.append(0x0A)
                case unit("t"): out.append(0x09)
                case unit("r"): out.append(0x0D)
                case unit("b"): out.append(0x08)
                case unit("f"): out.append(0x0C)
                case unit("u"):
                    guard i + 4 <= units.count, let v = UInt16(String(decoding: units[i..<i + 4], as: UTF16.self), radix: 16) else { return nil }
                    out.append(v)
                    i += 4
                case unit("\""), unit("\\"), unit("/"): out.append(e)
                default: return nil
                }
            }
            return nil
        }

        mutating func literal() -> OrderedJSON? {
            let start = i
            while i < units.count, ![0x2C, 0x5D, 0x7D, 0x20, 0x09, 0x0A, 0x0D].contains(units[i]) { i += 1 }
            let word = String(decoding: units[start..<i], as: UTF16.self)
            switch word {
            case "true": return .bool(true)
            case "false": return .bool(false)
            case "null": return .null
            default:
                // JSON number grammar.
                var j = word.startIndex
                func digits() -> Bool {
                    let from = j
                    while j < word.endIndex, word[j].isASCII, word[j].isNumber { j = word.index(after: j) }
                    return j > from
                }
                if j < word.endIndex, word[j] == "-" { j = word.index(after: j) }
                guard digits() else { return nil }
                if j < word.endIndex, word[j] == "." { j = word.index(after: j); guard digits() else { return nil } }
                if j < word.endIndex, word[j] == "e" || word[j] == "E" {
                    j = word.index(after: j)
                    if j < word.endIndex, word[j] == "+" || word[j] == "-" { j = word.index(after: j) }
                    guard digits() else { return nil }
                }
                return j == word.endIndex ? .number(word) : nil
            }
        }
    }
}

private func unit(_ c: Unicode.Scalar) -> UInt16 { UInt16(c.value) }

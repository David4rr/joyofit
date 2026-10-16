// Port of FaceCustomCodec.kt: editable watch-face configuration over DataSync (service 0x37, package hw.app.watchface.custom <->
// hw.watch.watchface.custom). Wire layouts follow Huawei Health 17.0.8.300's observed behaviour (query / set custom config, style and
// widget lists); verified against the hand-computed layouts of the Kotlin FaceCustomCodecTest.
import Foundation

/// The `DIAL_EDIT_MODE_*` constants.
public enum FaceEditMode {
    public static let style = 0
    public static let background = 1
    public static let dual = 2
    public static let scale = 3
    public static let symbol = 4
    public static let typeface = 5
    public static let time = 6
    public static let hand = 7

    public static let all = Array(style...hand)

    public static func name(_ mode: Int) -> String {
        switch mode {
        case style: return "style"
        case background: return "background"
        case dual: return "dual"
        case scale: return "scale"
        case symbol: return "symbol"
        case typeface: return "typeface"
        case time: return "time"
        case hand: return "hand"
        default: return "mode \(mode)"
        }
    }
}

/// One selected option of an edit mode: `mode` is a `FaceEditMode`, `index` the option's position in the face.
public struct FaceStyleChoice: Equatable, Sendable {
    public var mode: Int
    public var index: Int

    public init(mode: Int, index: Int) {
        self.mode = mode
        self.index = index
    }
}

/// Huawei Health's `CustomConfig`. Every part is optional: a face exposes only the parts the watch reports for it. `styles` keeps the watch's
/// order and its raw modes (Huawei Health's own model folds modes 2 and 3 into one "scale" index when reading, and writes the scale index
/// under both when sending; `FaceCustomWire.encodeConfig` sends exactly what it is given). `widgets` holds the selected option of each widget
/// slot, slot = position.
public struct FaceCustomization: Equatable, Sendable {
    public var marketId: String
    public var styles: [FaceStyleChoice]
    public var colourIndex: Int?
    public var customColour: String?
    public var widgets: [Int]

    public init(marketId: String, styles: [FaceStyleChoice] = [], colourIndex: Int? = nil, customColour: String? = nil, widgets: [Int] = []) {
        self.marketId = marketId
        self.styles = styles
        self.colourIndex = colourIndex
        self.customColour = customColour
        self.widgets = widgets
    }

    public func style(_ mode: Int) -> Int? { styles.first { $0.mode == mode }?.index }

    /// `FaceCustomization` in `HuaweiWearFaceCustom.types.ts`.
    public func toJS() -> [String: Any] {
        [
            "marketId": marketId,
            "styles": styles.map { ["mode": $0.mode, "index": $0.index] as [String: Any] },
            "colourIndex": colourIndex.map { $0 as Any } ?? NSNull(),
            "customColour": customColour.map { $0 as Any } ?? NSNull(),
            "widgets": widgets,
        ]
    }

    /// Reads the JS object; a missing or mistyped field is `nil`.
    public init?(js: [String: Any]) {
        func int(_ value: Any?) -> Int? {
            switch value {
            case let i as Int: return i
            case let d as Double: return d == d.rounded() && abs(d) < 1e15 ? Int(d) : nil
            case let n as NSNumber: return n.intValue
            default: return nil
            }
        }
        guard let marketId = js["marketId"] as? String else { return nil }
        var styles = [FaceStyleChoice]()
        for raw in (js["styles"] as? [Any]) ?? [] {
            guard let entry = raw as? [String: Any], let mode = int(entry["mode"]), let index = int(entry["index"]) else { return nil }
            styles.append(FaceStyleChoice(mode: mode, index: index))
        }
        var widgets = [Int]()
        for raw in (js["widgets"] as? [Any]) ?? [] {
            guard let option = int(raw) else { return nil }
            widgets.append(option)
        }
        self.init(
            marketId: marketId, styles: styles, colourIndex: int(js["colourIndex"]), customColour: js["customColour"] as? String, widgets: widgets
        )
    }

    /// One line for the log.
    public func describe() -> String {
        var out = "face \(marketId)"
        if !styles.isEmpty { out += " styles=" + styles.map { "\(FaceEditMode.name($0.mode))=\($0.index)" }.joined(separator: ",") }
        if let colourIndex { out += " colour=\(colourIndex)" }
        if let customColour { out += " customColour=\(customColour)" }
        if !widgets.isEmpty { out += " widgets=[" + widgets.map(String.init).joined(separator: ", ") + "]" }
        return out
    }
}

/// A configuration that cannot be encoded (the Kotlin `IllegalArgumentException`).
public struct FaceCustomError: Error, CustomStringConvertible {
    public let message: String
    public var description: String { message }
}

public enum FaceCustomWire {
    public static let phonePkg = "hw.app.watchface.custom"
    public static let watchPkg = "hw.watch.watchface.custom"

    /// `EVENT_QUERY_CUSTOM_WATCHFACE`: phone to watch, data `{01 marketId}`.
    public static let eventQuery = 800_100_008

    /// `EVENT_REPORT_CUSTOM_WATCHFACE`: phone to watch applies a configuration, watch to phone reports one.
    public static let eventReport = 800_100_009

    /// Huawei Health gates every sample event on ExpandCapability 84 (same bit as the rest of DataSync).
    public static let capEvent = DataSyncWire.capEvent

    // Tags of the event data.
    static let tagMarketId = 0x01
    static let tagStyleList = 0x02
    static let tagStyle = 0x03
    static let tagMode = 0x04
    static let tagIndex = 0x05
    static let tagColour = 0x06
    static let tagCustomColour = 0x07
    static let tagWidgetList = 0x08
    static let tagWidget = 0x09
    static let tagSlot = 0x0A
    static let tagOption = 0x0B

    /// Huawei writes a struct item as one byte, so an index must fit one.
    public static let maxIndex = 255

    /// `{01 marketId}`.
    public static func encodeQuery(_ marketId: String) -> Bytes { Tlv.leaf(tagMarketId, Array(marketId.utf8)) }

    /// `buildCustomConfigEventDataBytes`: `01 marketId`, then `82{83{04 mode, 05 index}...}` (when there are styles), `06 colour` (minimal
    /// big-endian), `07 custom colour` (UTF-8, left out when empty), `88{89{0A slot, 0B option}...}`. Mode, index, slot and option are one
    /// byte each (written as `(byte) i`).
    public static func encodeConfig(_ config: FaceCustomization) throws -> Bytes {
        guard !config.marketId.isEmpty else { throw FaceCustomError(message: "A face id is required") }
        var out = encodeQuery(config.marketId)
        if !config.styles.isEmpty {
            var list = Bytes()
            for style in config.styles {
                try requireByte("mode", style.mode)
                try requireByte("\(FaceEditMode.name(style.mode)) index", style.index)
                list += Tlv.node(tagStyle, Tlv.leaf(tagMode, [UInt8(style.mode)]) + Tlv.leaf(tagIndex, [UInt8(style.index)]))
            }
            out += Tlv.node(tagStyleList, list)
        }
        if let colour = config.colourIndex { out += Tlv.leaf(tagColour, minimalBigEndian(colour)) }
        if let custom = config.customColour, !custom.isEmpty { out += Tlv.leaf(tagCustomColour, Array(custom.utf8)) }
        if !config.widgets.isEmpty {
            var list = Bytes()
            for (slot, option) in config.widgets.enumerated() {
                try requireByte("widget slot", slot)
                try requireByte("widget \(slot) option", option)
                list += Tlv.node(tagWidget, Tlv.leaf(tagSlot, [UInt8(slot)]) + Tlv.leaf(tagOption, [UInt8(option)]))
            }
            out += Tlv.node(tagWidgetList, list)
        }
        return out
    }

    /// `loadCustomConfigFromSampleEvent`: nil when the data is not a TLV or has no market id. Unknown tags are ignored; a style whose mode
    /// or index is missing is skipped (Huawei logs "style not found"); a widget whose slot is outside the list is skipped.
    public static func decode(_ data: Bytes) -> FaceCustomization? {
        guard let top = Tlv.parseFlat(data), let marketId = top.string(tagMarketId) else { return nil }
        var styles = [FaceStyleChoice]()
        if let list = top.bytes(tagStyleList) {
            for entry in Tlv.parseEntries(list) ?? [] {
                guard let fields = Tlv.parseFlat(entry), let mode = fields.int(tagMode), let index = fields.int(tagIndex) else { continue }
                styles.append(FaceStyleChoice(mode: mode, index: index))
            }
        }
        var widgets = [Int]()
        if let list = top.bytes(tagWidgetList) {
            let entries = Tlv.parseEntries(list) ?? []
            for entry in entries {
                guard let fields = Tlv.parseFlat(entry) else { continue }
                let slot = fields.int(tagSlot) ?? -1
                let option = fields.int(tagOption) ?? -1
                if slot >= 0 && slot < entries.count { widgets.append(option) }
            }
        }
        return FaceCustomization(
            marketId: marketId, styles: styles, colourIndex: top.int(tagColour),
            customColour: top.string(tagCustomColour).flatMap { $0.isEmpty ? nil : $0 }, widgets: widgets
        )
    }

    /// One to four big-endian bytes, leading zero bytes dropped (0 is `00`).
    public static func minimalBigEndian(_ value: Int) -> Bytes {
        let v = UInt32(truncatingIfNeeded: value)
        let full: Bytes = [UInt8(v >> 24), UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF)]
        let skip = full.firstIndex { $0 != 0 } ?? 3
        return Array(full[skip...])
    }

    private static func requireByte(_ what: String, _ value: Int) throws {
        guard (0...maxIndex).contains(value) else { throw FaceCustomError(message: "\(what) \(value) does not fit the one byte Huawei Health sends") }
    }

    /// What of `wanted` `actual` does not show. A mode, the colour or a custom colour that was not requested is not compared. Scale is
    /// written under modes 2 and 3 by Huawei Health; both are compared when requested.
    public static func differences(wanted: FaceCustomization, actual: FaceCustomization) -> [String] {
        var out = [String]()
        for style in wanted.styles {
            let got = actual.style(style.mode)
            if got != style.index { out.append("\(FaceEditMode.name(style.mode)) is \(got.map(String.init) ?? "not reported"), wanted \(style.index)") }
        }
        if let colour = wanted.colourIndex, colour != actual.colourIndex {
            out.append("colour is \(actual.colourIndex.map(String.init) ?? "not reported"), wanted \(colour)")
        }
        if let custom = wanted.customColour, custom != actual.customColour {
            out.append("custom colour is \(actual.customColour ?? "not reported"), wanted \(custom)")
        }
        for (slot, option) in wanted.widgets.enumerated() {
            let got = slot < actual.widgets.count ? actual.widgets[slot] : nil
            if got != option { out.append("widget \(slot) is \(got.map(String.init) ?? "not reported"), wanted \(option)") }
        }
        return out
    }
}

/// Huawei's own TLV: tag byte, 7-bit varint length (1 to 3 bytes), value. A tag with the top bit holds more TLVs.
enum Tlv {
    static func leaf(_ tag: Int, _ value: Bytes) -> Bytes { [UInt8(truncatingIfNeeded: tag)] + varint(value.count) + value }

    /// A struct or list: tag with the top bit set, then the concatenated children.
    static func node(_ tag: Int, _ children: Bytes) -> Bytes { leaf(tag | 0x80, children) }

    static func varint(_ length: Int) -> Bytes {
        precondition(length >= 0 && length < 0x20_0000, "TLV length out of range: \(length)")
        if length < 0x80 { return [UInt8(length)] }
        if length < 0x4000 { return [UInt8((length >> 7) | 0x80), UInt8(length & 0x7F)] }
        return [UInt8((length >> 14) | 0x80), UInt8(((length >> 7) & 0x7F) | 0x80), UInt8(length & 0x7F)]
    }

    /// Values by tag with the top bit masked; the last of a repeated tag wins. Nil when the bytes are not valid TLV.
    static func parseFlat(_ data: Bytes) -> Fields? {
        var map = [Int: Bytes]()
        var pos = 0
        while pos < data.count {
            let tag = Int(data[pos])
            if tag == 0 { return nil }
            guard let (length, next) = readLength(data, pos + 1), next + length <= data.count else { return nil }
            map[tag & 0x7F] = Array(data[next..<next + length])
            pos = next + length
        }
        return Fields(map)
    }

    /// The values of every TLV in `data`, in order: the items of a list.
    static func parseEntries(_ data: Bytes) -> [Bytes]? {
        var out = [Bytes]()
        var pos = 0
        while pos < data.count {
            guard let (length, next) = readLength(data, pos + 1), next + length <= data.count else { return nil }
            out.append(Array(data[next..<next + length]))
            pos = next + length
        }
        return out
    }

    private static func readLength(_ data: Bytes, _ start: Int) -> (Int, Int)? {
        var pos = start
        var value = 0
        for _ in 0..<3 {
            guard pos < data.count else { return nil }
            let b = Int(data[pos])
            pos += 1
            value = (value << 7) | (b & 0x7F)
            if b & 0x80 == 0 { return (value, pos) }
        }
        return nil
    }

    struct Fields {
        let map: [Int: Bytes]

        init(_ map: [Int: Bytes]) { self.map = map }

        func bytes(_ tag: Int) -> Bytes? { map[tag] }

        func string(_ tag: Int) -> String? {
            guard let v = map[tag], !v.isEmpty else { return nil }
            return String(decoding: v, as: UTF8.self)
        }

        /// One to four big-endian bytes; empty, absent or longer is nil.
        func int(_ tag: Int) -> Int? {
            guard let v = map[tag], !v.isEmpty, v.count <= 4 else { return nil }
            var out: UInt32 = 0
            for b in v { out = (out << 8) | UInt32(b) }
            return Int(Int32(bitPattern: out))
        }
    }
}

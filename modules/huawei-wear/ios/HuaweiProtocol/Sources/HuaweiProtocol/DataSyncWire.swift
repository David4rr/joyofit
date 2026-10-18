// Port of DataSyncCodec.kt's DataSyncWire (service 0x37): the builders of the four "sample" commands Huawei Health uses for everything under
// `hw.unitedevice.*` / `hw.sport.*` and the parsers of what the watch pushes. Kotlin-only logic (GB's DataSync.java is not used by the
// Android layer for these), so it is verified against the byte examples of the Kotlin DataSyncCodecTest, not against Java golden vectors.
// The wire layouts follow Huawei Health 17.0.8.300's observed behaviour; UNVERIFIED on a watch beyond those examples.
import Foundation

/// One item of a SampleConfig. `action` 1 sets, 2 queries (feature rows). `modifyMs` nil leaves tag `08` out.
public struct ConfigItem: Equatable, Sendable {
    public var configId: Int
    public var action: Int
    public var data: Bytes?
    public var modifyMs: Int64?

    public init(configId: Int, action: Int = 1, data: Bytes? = nil, modifyMs: Int64? = nil) {
        self.configId = configId
        self.action = action
        self.data = data
        self.modifyMs = modifyMs
    }
}

/// One `87{08 key, 09 value}` of a SamplePoint.
public struct PointValue: Equatable, Sendable {
    public var key: Int
    public var value: Bytes?

    public init(key: Int, value: Bytes?) {
        self.key = key
        self.value = value
    }
}

/// One `8A{0B key, 0C value}` of a dictionary row.
public struct DictValue: Equatable, Sendable {
    public var key: Int
    public var value: Bytes?

    public init(key: Int, value: Bytes?) {
        self.key = key
        self.value = value
    }
}

/// One `85{...}` row of a DictionaryPointInfo; times are Unix **milliseconds** (8 bytes on the wire).
public struct DictRow: Equatable, Sendable {
    public var startMs: Int64
    public var endMs: Int64
    public var modifyMs: Int64?
    public var values: [DictValue]

    public init(startMs: Int64, endMs: Int64, modifyMs: Int64? = nil, values: [DictValue] = []) {
        self.startMs = startMs
        self.endMs = endMs
        self.modifyMs = modifyMs
        self.values = values
    }
}

/// The side that sent a packet is `srcPkg`; the watch writes its own package there and the phone's in `wearPkg`.
public struct SampleEvent: Sendable {
    public let srcPkg: String
    public let wearPkg: String
    public let eventId: Int
    public let level: Int
    public let data: Bytes?
    public let errorCode: Int?
    /// The registered phone / watch package this packet was matched against; set by the dispatcher.
    public var phonePkg = ""
    public var watchPkg = ""

    public init(srcPkg: String, wearPkg: String, eventId: Int, level: Int, data: Bytes?, errorCode: Int?) {
        self.srcPkg = srcPkg
        self.wearPkg = wearPkg
        self.eventId = eventId
        self.level = level
        self.data = data
        self.errorCode = errorCode
    }
}

public struct SampleConfigIn: Sendable {
    public let srcPkg: String
    public let wearPkg: String
    public let items: [ConfigItem]
    public let errorCode: Int?
    public var phonePkg = ""
    public var watchPkg = ""

    public init(srcPkg: String, wearPkg: String, items: [ConfigItem], errorCode: Int?) {
        self.srcPkg = srcPkg
        self.wearPkg = wearPkg
        self.items = items
        self.errorCode = errorCode
    }
}

public struct DictQuery: Sendable {
    public let srcPkg: String
    public let wearPkg: String
    public let dictId: Int
    public let rows: [DictRow]
    public let startMs: Int64?
    public let endMs: Int64?
    public let modifyMs: Int64?
    public let errorCode: Int?
    public var phonePkg = ""
    public var watchPkg = ""

    public init(srcPkg: String, wearPkg: String, dictId: Int, rows: [DictRow], startMs: Int64?, endMs: Int64?, modifyMs: Int64?, errorCode: Int?) {
        self.srcPkg = srcPkg
        self.wearPkg = wearPkg
        self.dictId = dictId
        self.rows = rows
        self.startMs = startMs
        self.endMs = endMs
        self.modifyMs = modifyMs
        self.errorCode = errorCode
    }
}

public struct SamplePointIn: Sendable {
    public let srcPkg: String
    public let wearPkg: String
    public let dictId: Int
    public let values: [PointValue]
    public let metadata: Bytes?
    public let errorCode: Int?
    public var phonePkg = ""
    public var watchPkg = ""

    public init(srcPkg: String, wearPkg: String, dictId: Int, values: [PointValue], metadata: Bytes?, errorCode: Int?) {
        self.srcPkg = srcPkg
        self.wearPkg = wearPkg
        self.dictId = dictId
        self.values = values
        self.metadata = metadata
        self.errorCode = errorCode
    }
}

/// Service 0x37 commands, ExpandCapability gates and the tag numbers, in one place.
public enum DataSyncWire {
    public static let service: UInt8 = 0x37

    /// `0x37/01` SampleConfig.
    public static let cmdConfig = 0x01
    /// `0x37/02` SampleEvent.
    public static let cmdEvent = 0x02
    /// `0x37/03` SamplePoint.
    public static let cmdPoint = 0x03
    /// `0x37/04` DictionaryPointInfo.
    public static let cmdDict = 0x04
    /// `0x37/05` CompactDataDictionary; only logged.
    public static let cmdCompact = 0x05

    /// ExpandCapability bits Huawei Health checks: config, event, point, dictionary.
    public static let capConfig = 83
    public static let capEvent = 84
    public static let capPoint = 85
    public static let capDict = 173

    /// The error tag every service uses; `100000` means OK.
    public static let tagError = 0x7F

    /// Which side is which for a packet with `01 src` / `02 wear`, against a handler registered for `regPhone` and / or `regWatch` (nil =
    /// any). The watch writes its own package in `src` and the phone's in `wear`; Huawei's own senders write them the other way round, and
    /// both are accepted. Returns (phone package, watch package) or nil when the handler does not match.
    public static func matchPackages(_ regPhone: String?, _ regWatch: String?, src: String, wear: String) -> (phone: String, watch: String)? {
        let watchSends = (regPhone == nil || regPhone == wear) && (regWatch == nil || regWatch == src)
        if watchSends { return (wear, src) }
        let phoneSends = (regPhone == nil || regPhone == src) && (regWatch == nil || regWatch == wear)
        return phoneSends ? (src, wear) : nil
    }

    public static func capabilityFor(_ command: Int) -> Int? {
        switch command {
        case cmdConfig: return capConfig
        case cmdEvent: return capEvent
        case cmdPoint: return capPoint
        case cmdDict: return capDict
        default: return nil
        }
    }

    public static func commandName(_ command: Int) -> String {
        switch command {
        case cmdConfig: return "config"
        case cmdEvent: return "event"
        case cmdPoint: return "point"
        case cmdDict: return "dictionary"
        case cmdCompact: return "compact dictionary"
        default: return "command " + (command < 16 ? "0" : "") + String(command, radix: 16)
        }
    }

    private static func packet(_ command: Int, _ tlv: HuaweiTLV) -> HuaweiPacket {
        HuaweiPacket(serviceId: service, commandId: UInt8(truncatingIfNeeded: command), tlv: tlv)
    }

    private static func int32(_ v: Int) -> Int32 { Int32(truncatingIfNeeded: v) }

    // MARK: outbound

    /// `83{84{05 id int32, 06 action byte, 07 data, 08 modify time int64 ms}...}` after `01 src`, `02 wear`.
    public static func config(srcPkg: String, wearPkg: String, items: [ConfigItem]) -> HuaweiPacket {
        var list = HuaweiTLV()
        for item in items {
            var entry = HuaweiTLV()
            entry.put(0x05, int: int32(item.configId))
            entry.put(0x06, byte: UInt8(truncatingIfNeeded: item.action))
            if let data = item.data { entry.put(0x07, bytes: data) }
            if let modify = item.modifyMs { entry.put(0x08, long: modify) }
            list.put(0x84, tlv: entry)
        }
        var tlv = HuaweiTLV()
        tlv.put(0x01, string: srcPkg)
        tlv.put(0x02, string: wearPkg)
        tlv.put(0x83, tlv: list)
        return packet(cmdConfig, tlv)
    }

    /// `03 event id int32, 04 level byte, 05 data`.
    public static func event(srcPkg: String, wearPkg: String, eventId: Int, level: Int, data: Bytes?) -> HuaweiPacket {
        var tlv = HuaweiTLV()
        tlv.put(0x01, string: srcPkg)
        tlv.put(0x02, string: wearPkg)
        tlv.put(0x03, int: int32(eventId))
        tlv.put(0x04, byte: UInt8(truncatingIfNeeded: level))
        if let data { tlv.put(0x05, bytes: data) }
        return packet(cmdEvent, tlv)
    }

    /// `03 dict type int32, 04 start int32, 05 end int32, 86{87{08 key int32, 09 value}...}, 0A metadata`. Huawei sends the low 32 bits of
    /// a millisecond value for start and end; `startMs` / `endMs` nil leaves the tag out.
    public static func samplePoint(
        srcPkg: String, wearPkg: String, dictType: Int, values: [PointValue], startMs: Int64?, endMs: Int64?, metadata: Bytes?
    ) -> HuaweiPacket {
        var tlv = HuaweiTLV()
        tlv.put(0x01, string: srcPkg)
        tlv.put(0x02, string: wearPkg)
        tlv.put(0x03, int: int32(dictType))
        if let startMs { tlv.put(0x04, int: Int32(truncatingIfNeeded: startMs)) }
        if let endMs { tlv.put(0x05, int: Int32(truncatingIfNeeded: endMs)) }
        var list = HuaweiTLV()
        for value in values {
            var entry = HuaweiTLV()
            entry.put(0x08, int: int32(value.key))
            if let v = value.value { entry.put(0x09, bytes: v) }
            list.put(0x87, tlv: entry)
        }
        tlv.put(0x86, tlv: list)
        if let metadata { tlv.put(0x0A, bytes: metadata) }
        return packet(cmdPoint, tlv)
    }

    /// `03 dict type int32, 84{85{06 start int64 ms, 07 end int64 ms, 08 modify int64 ms, 89{8A{0B key int32, 0C value}...}, 0D empty}...}`.
    /// Huawei Health writes an empty tag `0D` for each row (its metadata is null).
    public static func dictionary(srcPkg: String, wearPkg: String, dictType: Int, rows: [DictRow]) -> HuaweiPacket {
        var tlv = HuaweiTLV()
        tlv.put(0x01, string: srcPkg)
        tlv.put(0x02, string: wearPkg)
        tlv.put(0x03, int: int32(dictType))
        var list = HuaweiTLV()
        for row in rows {
            var entry = HuaweiTLV()
            entry.put(0x06, long: row.startMs)
            entry.put(0x07, long: row.endMs)
            if let modify = row.modifyMs { entry.put(0x08, long: modify) }
            if !row.values.isEmpty {
                var values = HuaweiTLV()
                for value in row.values {
                    var item = HuaweiTLV()
                    item.put(0x0B, int: int32(value.key))
                    // A null or empty value is written as the tag with length 0.
                    item.put(0x0C, bytes: value.value ?? [])
                    values.put(0x8A, tlv: item)
                }
                entry.put(0x89, tlv: values)
            }
            entry.put(0x0D, bytes: [])
            list.put(0x85, tlv: entry)
        }
        tlv.put(0x84, tlv: list)
        return packet(cmdDict, tlv)
    }

    // MARK: inbound (watch to phone)

    // Every parser tolerates missing tags: a watch packet we do not know is logged, never thrown on. A TLV whose nested lists do not parse
    // throws, and the service logs that as a parse failure.

    private static func text(_ tlv: HuaweiTLV, _ tag: Int) -> String? {
        tlv.bytes(tag, default: nil).map { String(decoding: $0, as: UTF8.self) }
    }

    private static func errorCode(_ tlv: HuaweiTLV) -> Int? { tlv.contains(tagError) ? Int(tlv.asInteger(tagError, default: 0)) : nil }

    private static func long(_ tlv: HuaweiTLV, _ tag: Int) throws -> Int64? { tlv.contains(tag) ? try tlv.asLong(tag) : nil }

    public static func parseEvent(_ tlv: HuaweiTLV) -> SampleEvent {
        SampleEvent(
            srcPkg: text(tlv, 0x01) ?? "", wearPkg: text(tlv, 0x02) ?? "", eventId: Int(tlv.asInteger(0x03, default: 0)),
            level: Int(tlv.asInteger(0x04, default: 0)), data: tlv.bytes(0x05, default: nil), errorCode: errorCode(tlv)
        )
    }

    public static func parseConfig(_ tlv: HuaweiTLV) throws -> SampleConfigIn {
        var items = [ConfigItem]()
        if tlv.contains(0x83) {
            for entry in try tlv.object(0x83).objects(0x84) {
                items.append(ConfigItem(
                    configId: Int(entry.asInteger(0x05, default: 0)), action: Int(entry.asInteger(0x06, default: 0)), data: entry.bytes(0x07, default: nil),
                    modifyMs: try long(entry, 0x08)
                ))
            }
        }
        return SampleConfigIn(srcPkg: text(tlv, 0x01) ?? "", wearPkg: text(tlv, 0x02) ?? "", items: items, errorCode: errorCode(tlv))
    }

    /// Both layouts seen in the RE: rows `84{85{06,07,08,89{...}}}` (as the phone sends them) and flat `06 / 07 / 08` at the top.
    public static func parseDictionary(_ tlv: HuaweiTLV) throws -> DictQuery {
        var rows = [DictRow]()
        if tlv.contains(0x84) {
            for entry in try tlv.object(0x84).objects(0x85) {
                var values = [DictValue]()
                if entry.contains(0x89) {
                    for item in try entry.object(0x89).objects(0x8A) {
                        values.append(DictValue(key: Int(item.asInteger(0x0B, default: 0)), value: item.bytes(0x0C, default: nil)))
                    }
                }
                rows.append(DictRow(
                    startMs: try long(entry, 0x06) ?? 0, endMs: try long(entry, 0x07) ?? 0, modifyMs: try long(entry, 0x08), values: values
                ))
            }
        }
        let first = rows.first
        return DictQuery(
            srcPkg: text(tlv, 0x01) ?? "", wearPkg: text(tlv, 0x02) ?? "", dictId: Int(tlv.asInteger(0x03, default: 0)), rows: rows,
            startMs: try first?.startMs ?? long(tlv, 0x06), endMs: try first?.endMs ?? long(tlv, 0x07), modifyMs: try first?.modifyMs ?? long(tlv, 0x08),
            errorCode: errorCode(tlv)
        )
    }

    public static func parsePoint(_ tlv: HuaweiTLV) throws -> SamplePointIn {
        var values = [PointValue]()
        if tlv.contains(0x86) {
            for entry in try tlv.object(0x86).objects(0x87) {
                values.append(PointValue(key: Int(entry.asInteger(0x08, default: 0)), value: entry.bytes(0x09, default: nil)))
            }
        }
        return SamplePointIn(
            srcPkg: text(tlv, 0x01) ?? "", wearPkg: text(tlv, 0x02) ?? "", dictId: Int(tlv.asInteger(0x03, default: 0)), values: values,
            metadata: tlv.bytes(0x0A, default: nil), errorCode: errorCode(tlv)
        )
    }

    /// UTF-8 text when the bytes are printable (JSON payloads), else hex; for the log only.
    public static func describe(_ data: Bytes?) -> String {
        guard let data else { return "-" }
        if data.isEmpty { return "(empty)" }
        let text = String(decoding: data, as: UTF8.self)
        let printable = text.unicodeScalars.allSatisfy { ($0 == "\n" || $0.value >= 0x20) && $0.value != 0xFFFD }
        return printable && data.count > 1 ? text : data.hexUpper
    }
}

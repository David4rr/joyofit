// Port of HuaweiP2PDataDictionarySyncService.java and the HuaweiDictionarySync* classes (Gadgetbridge, AGPL-3.0-or-later), with the watch-fit
// changes of the Java: a page that does not advance the start time ends the class, the operation and class tags are read as 1 to 4 byte
// integers, `cancelSync` drops state when the caller gives up, and the callback hears about every class that ends with a parse error.
//
// The P2P module `hw.unitedevice.datadictionarysync` (watch package `hw.watch.health.filesync`) hands out the health "dictionary" classes
// (skin temperature, HRV, emotion, sleep apnea, ...). One request asks for one class from a start time; the answer is a page of entries and the
// next request starts after the last one, until a page comes back empty.
import Foundation

/// One entry of a dictionary answer.
public struct DictData: Equatable, Sendable {
    public struct Value: Equatable, Sendable {
        public let dataType: Int
        public let tag: UInt8
        public let value: Bytes?

        public init(dataType: Int, tag: UInt8, value: Bytes?) {
            self.dataType = dataType
            self.tag = tag
            self.value = value
        }
    }

    public let dictClass: Int
    public let startTimestamp: Int64
    public let endTimestamp: Int64
    public let modifyTimestamp: Int64
    public let data: [Value]

    public init(dictClass: Int, startTimestamp: Int64, endTimestamp: Int64, modifyTimestamp: Int64, data: [Value]) {
        self.dictClass = dictClass
        self.startTimestamp = startTimestamp
        self.endTimestamp = endTimestamp
        self.modifyTimestamp = modifyTimestamp
        self.data = data
    }
}

/// One stored sample: times in milliseconds, `value` is the number a chart plots (nil when the field layout is not known).
public struct DictionaryRow: Equatable, Sendable {
    public let type: String
    public let timestamp: Int64
    public let lastTimestamp: Int64
    public let value: Double?
    public let valuesJson: String

    public init(type: String, timestamp: Int64, lastTimestamp: Int64, value: Double?, valuesJson: String) {
        self.type = type
        self.timestamp = timestamp
        self.lastTimestamp = lastTimestamp
        self.value = value
        self.valuesJson = valuesJson
    }
}

/// Where the rows go; the app implements it on top of the shared database.
public protocol DictionarySyncStore: AnyObject, Sendable {
    /// GB `getLastFetchTimestamp`: newest `lastTimestamp` stored for the metric (ms), 0 when none.
    func lastFetchTimestamp(_ type: String) -> Int64
    func persist(_ rows: [DictionaryRow]) throws
}

/// One dictionary class: its gate, and what it makes of the entries.
public protocol DictionarySyncHandler: Sendable {
    var dataClass: Int { get }
    /// The name stored in `health_metrics.type`.
    var metricType: String { get }
    var title: String { get }
    /// The ExpandCapability bit(s) the gate checks, for the log.
    var gate: String { get }
    func supports(_ expandCapability: (Int) -> Bool) -> Bool
    func handleData(store: DictionarySyncStore, dictData: [DictData]) throws
}

extension DictionarySyncHandler {
    public func lastDataSyncTimestamp(store: DictionarySyncStore) -> Int64 { store.lastFetchTimestamp(metricType) }
}

public protocol DictionarySyncCallback: AnyObject, Sendable {
    func lastDataSyncTimestamp(dictClass: Int) -> Int64
    func onData(dictClass: Int, dictData: [DictData]) throws
    func onComplete(_ complete: Bool)
}

public final class P2PDictionarySyncService: P2PService, @unchecked Sendable {
    public static let moduleName = "hw.unitedevice.datadictionarysync"

    private let stateLock = NSRecursiveLock()
    private var serviceAvailable = false
    private var classesToSync: [Int]?
    private var lastRequestedStart: [Int: Int64] = [:]
    private var currentRequests: [Int: DictionarySyncCallback] = [:]
    private var availabilityListener: (@Sendable (Int) -> Void)?
    private let nowMs: @Sendable () -> Int64

    public init(manager: P2PManager, nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) {
        self.nowMs = nowMs
        super.init(manager: manager)
    }

    public override var module: String { P2PDictionarySyncService.moduleName }
    public override var package: String { "hw.watch.health.filesync" }
    public override var fingerprint: String { "SystemApp" }

    /// According to HCI logs this value is variable size.
    public static func dictToBytes(_ value: Int) -> Bytes {
        if value < 256 { return [UInt8(truncatingIfNeeded: value)] }
        var numBytes = 0
        var temp = value
        while temp > 0 {
            temp >>= 8
            numBytes += 1
        }
        var out = Bytes(repeating: 0, count: numBytes)
        var v = value
        for j in stride(from: numBytes - 1, through: 0, by: -1) {
            out[j] = UInt8(v & 0xFF)
            v >>= 8
        }
        return out
    }

    public static func syncHandlers() -> [DictionarySyncHandler] {
        [
            SkinTemperatureDictionary(), HrvDictionary(), EmotionDictionary(), SleepApneaDictionary(),
            RawDictionary(
                dataClass: 400017, metricType: "arterial_stiffness", title: "Arterial stiffness",
                gate: "ExpandCapability 75 (GB supportsArterialStiffnessDetection, commented out in GB)", supports: { $0(75) }
            ),
            RawDictionary(
                dataClass: 200003, metricType: "altitude", title: "Altitude", gate: "ExpandCapability 72 (GB supportsAltitude, commented out in GB)",
                supports: { $0(72) }
            ),
            RawDictionary(
                dataClass: 10002, metricType: "blood_pressure", title: "Blood pressure",
                gate: "ExpandCapability 59 (GB supportsBloodPressure, commented out in GB)", supports: { $0(59) }
            ),
            RawDictionary(
                dataClass: 500006, metricType: "ams", title: "Acute mountain sickness (Lake Louise)",
                gate: "ExpandCapability 72 (GB supportsAltitude, commented out in GB)", supports: { $0(72) }
            ),
            RawDictionary(
                dataClass: 700004, metricType: "arrhythmia", title: "Arrhythmia (PPG)", gate: "ExpandCapability 113, 255 or 168 (GB supportsArrhythmia)",
                supports: { $0(113) || $0(255) || $0(168) }
            ),
        ]
    }

    /// Called with the ping outcome (code 0xca means the watch app answered).
    public func setAvailabilityListener(_ listener: (@Sendable (Int) -> Void)?) { stateLock.p2pLocked { availabilityListener = listener } }

    public var isAvailable: Bool { stateLock.p2pLocked { serviceAvailable } }

    public override func registered() {
        sendPing { [weak self] code, _ in
            guard let self else { return }
            let listener = self.stateLock.p2pLocked { self.availabilityListener }
            listener?(code)
            if Int8(truncatingIfNeeded: code) != Int8(bitPattern: 0xCA) { return }
            self.stateLock.p2pLocked { self.serviceAvailable = true }
        }
    }

    public override func unregister() {
        stateLock.p2pLocked { serviceAvailable = false }
        cancelSync()
        clearPending()
    }

    /// Forget the running sync (the caller timed out or the link went away).
    public func cancelSync() {
        stateLock.p2pLocked {
            currentRequests.removeAll()
            classesToSync = nil
            lastRequestedStart.removeAll()
        }
    }

    public func startSync(_ dictClasses: [Int], callback: DictionarySyncCallback) {
        stateLock.p2pLocked {
            classesToSync = dictClasses
            lastRequestedStart.removeAll()
            if dictClasses.isEmpty {
                callback.onComplete(false)
                return
            }
            sendSyncRequest(classesToSync!.removeFirst(), startTime: 0, callback: callback)
        }
    }

    private func sendSyncRequest(_ dictClass: Int, startTime requested: Int64, callback: DictionarySyncCallback) {
        var startTime = requested
        if !serviceAvailable {
            callback.onComplete(false)
            return
        }
        if currentRequests[dictClass] != nil {
            callback.onComplete(false)
            return
        }
        if startTime == 0 { startTime = callback.lastDataSyncTimestamp(dictClass: dictClass) }
        if startTime < 0 {
            callback.onComplete(false)
            return
        }
        if startTime > 0 { startTime += 1000 }

        if let previous = lastRequestedStart[dictClass], previous == startTime {
            // The page did not advance the start time: GB would ask for the same page forever.
            if classesToSync == nil || classesToSync!.isEmpty {
                classesToSync = nil
                callback.onComplete(true)
            } else {
                sendSyncRequest(classesToSync!.removeFirst(), startTime: 0, callback: callback)
            }
            return
        }
        lastRequestedStart[dictClass] = startTime

        var tlv = HuaweiTLV()
        tlv.put(0x1, byte: 1)
        tlv.put(0x2, bytes: P2PDictionarySyncService.dictToBytes(dictClass))
        tlv.put(0x5, long: startTime)
        tlv.put(0x6, long: nowMs())
        tlv.put(0x0d, byte: 1)
        currentRequests[dictClass] = callback
        sendCommand([0x01] + tlv.serialize(), nil)
    }

    /// A TLV integer of 1 to 4 bytes, big endian (the request writes the class variable-sized, see `dictToBytes`).
    private static func readInt(_ tlv: HuaweiTLV, _ tag: Int) throws -> Int {
        let bytes = try tlv.bytes(tag)
        if bytes.isEmpty || bytes.count > 4 { throw TLVError.missingTag(UInt8(tag)) }
        var value: UInt32 = 0
        for b in bytes { value = (value << 8) | UInt32(b) }
        return Int(Int32(bitPattern: value))
    }

    public override func handleData(_ data: Bytes) throws {
        try stateLock.p2pLocked {
            if data.isEmpty { return }
            guard data[0] == 1 else { return }
            var callback: DictionarySyncCallback?
            do {
                let tlv = try HuaweiTLV(parsing: data, offset: 1, length: data.count - 1)
                let operation = try P2PDictionarySyncService.readInt(tlv, 0x01)
                let dictClass = try P2PDictionarySyncService.readInt(tlv, 0x02)
                guard let current = currentRequests.removeValue(forKey: dictClass) else { return }
                callback = current
                if operation != 1 {
                    current.onComplete(false)
                    return
                }

                // All tags with the high bit set are containers.
                var result = [DictData]()
                var lastTimestamp: Int64 = 0
                for block in try tlv.objects(0x83) {
                    for l in try block.objects(0x84) {
                        // 5 start time, 6 end time, 0xc modify time
                        let startTimestamp = try l.long(0x5)
                        let endTimestamp = l.contains(0x6) ? try l.long(0x6) : 0
                        let modifyTimestamp = l.contains(0xc) ? try l.long(0xc) : 0
                        var values = [DictData.Value]()
                        for l1 in try l.objects(0x87) {
                            for ll in try l1.objects(0x88) {
                                let type = Int(try ll.int(0x9))
                                if ll.contains(0xa) { values.append(DictData.Value(dataType: type, tag: 0xa, value: try ll.bytes(0xa))) }
                                if ll.contains(0xb) { values.append(DictData.Value(dataType: type, tag: 0xb, value: try ll.bytes(0xb))) }
                            }
                        }
                        result.append(DictData(dictClass: dictClass, startTimestamp: startTimestamp, endTimestamp: endTimestamp, modifyTimestamp: modifyTimestamp, data: values))
                        lastTimestamp = max(lastTimestamp, max(endTimestamp, modifyTimestamp))
                    }
                }

                try current.onData(dictClass: dictClass, dictData: result)

                if !result.isEmpty {
                    sendSyncRequest(dictClass, startTime: lastTimestamp, callback: current)
                } else if classesToSync == nil || classesToSync!.isEmpty {
                    classesToSync = nil
                    current.onComplete(true)
                } else {
                    sendSyncRequest(classesToSync!.removeFirst(), startTime: 0, callback: current)
                }
            } catch TLVError.missingTag(let tag) {
                manager.transport.log("P2PDataDictionarySyncService parse error: missing tag \(tag)")
                callback?.onComplete(false)
            }
        }
    }
}

// MARK: handlers

enum DictionarySupport {
    /// GB HuaweiUtil.convBytes2Double, but a short value gives nil instead of an exception.
    static func toDouble(_ b: Bytes?) -> Double? {
        guard let b, b.count >= 8 else { return nil }
        return Double(bitPattern: b.u64be(0))
    }

    static func lastTime(_ dt: DictData) -> Int64 { max(dt.endTimestamp, dt.modifyTimestamp) }

    /// Java `(int) double`: truncation, NaN is 0, out of range saturates.
    static func javaInt(_ d: Double) -> Int {
        if d.isNaN { return 0 }
        if d >= Double(Int32.max) { return Int(Int32.max) }
        if d <= Double(Int32.min) { return Int(Int32.min) }
        return Int(d)
    }

    private static func hex(_ bytes: Bytes) -> String { bytes.hexLower }

    /// Every value of one dictionary entry as {"<dataType>": number | "text"}, for classes whose field layout is not known.
    static func rawValues(_ values: [DictData.Value]) -> MetricJSON {
        var object = MetricJSON()
        for val in values {
            let key = String(val.dataType)
            if val.tag == 10 {
                if let d = toDouble(val.value), !d.isNaN, !d.isInfinite {
                    object.put(key, .number(d))
                } else if let v = val.value {
                    object.put(key, .string("hex:" + hex(v)))
                }
            } else if val.tag == 11 {
                object.put(key, .string(String(decoding: val.value ?? [], as: UTF8.self)))
            } else if let v = val.value {
                object.put(key + ".t\(val.tag)", .string("hex:" + hex(v)))
            }
        }
        return object
    }
}

/// The small JSON object the `values_json` column holds: keys in insertion order, a repeated key replaces its value.
public struct MetricJSON: Equatable, Sendable {
    public enum Value: Equatable, Sendable {
        case number(Double)
        case int(Int)
        case string(String)
    }

    private(set) var entries: [(key: String, value: Value)] = []

    public init() {}

    public var isEmpty: Bool { entries.isEmpty }

    public mutating func put(_ key: String, _ value: Value) {
        if case .number(let d) = value, d.isNaN || d.isInfinite { return }
        if let i = entries.firstIndex(where: { $0.key == key }) { entries[i].value = value } else { entries.append((key, value)) }
    }

    public static func == (a: MetricJSON, b: MetricJSON) -> Bool {
        a.entries.count == b.entries.count && zip(a.entries, b.entries).allSatisfy { $0.key == $1.key && $0.value == $1.value }
    }

    public func serialized() -> String {
        "{" + entries.map { quote($0.key) + ":" + render($0.value) }.joined(separator: ",") + "}"
    }

    private func render(_ value: Value) -> String {
        switch value {
        case .int(let i): return String(i)
        case .string(let s): return quote(s)
        case .number(let d):
            if d == d.rounded(), abs(d) < 1e15 { return String(Int64(d)) }
            return "\(d)"
        }
    }

    private func quote(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) } else { out.unicodeScalars.append(scalar) }
            }
        }
        return out + "\""
    }
}

struct SkinTemperatureDictionary: DictionarySyncHandler {
    let dataClass = 400012
    let metricType = "skin_temperature"
    let title = "Skin temperature"
    let gate = "ExpandCapability 29 (GB supportsTemperature)"
    static let valueType = 400012430

    func supports(_ expandCapability: (Int) -> Bool) -> Bool { expandCapability(0x1d) }

    func handleData(store: DictionarySyncStore, dictData: [DictData]) throws {
        var rows = [DictionaryRow]()
        for dt in dictData {
            var temperature: Double?
            for val in dt.data {
                if val.tag != 10 { continue }
                if val.dataType == SkinTemperatureDictionary.valueType {
                    if let value = DictionarySupport.toDouble(val.value), value >= 20, value <= 42 { temperature = Double(Float(value)) }
                }
            }
            if let temperature {
                var json = MetricJSON()
                json.put("temperature", .number(temperature))
                rows.append(DictionaryRow(type: metricType, timestamp: dt.startTimestamp, lastTimestamp: DictionarySupport.lastTime(dt), value: temperature, valuesJson: json.serialized()))
            }
        }
        try store.persist(rows)
    }
}

struct HrvDictionary: DictionarySyncHandler {
    let dataClass = 500044
    let metricType = "hrv"
    let title = "Heart rate variability"
    let gate = "ExpandCapability 235 (GB supportsHRV)"
    static let rmssdValue = 500044831

    func supports(_ expandCapability: (Int) -> Bool) -> Bool { expandCapability(235) }

    func handleData(store: DictionarySyncStore, dictData: [DictData]) throws {
        var rows = [DictionaryRow]()
        for dt in dictData {
            var rmssd: Double?
            for val in dt.data {
                if val.tag != 10 { continue }
                if val.dataType == HrvDictionary.rmssdValue {
                    if let value = DictionarySupport.toDouble(val.value), value >= 0, value <= 200 { rmssd = Double(DictionarySupport.javaInt(value)) }
                }
            }
            if let rmssd {
                var json = MetricJSON()
                json.put("rmssd", .number(rmssd))
                rows.append(DictionaryRow(type: metricType, timestamp: dt.startTimestamp, lastTimestamp: DictionarySupport.lastTime(dt), value: rmssd, valuesJson: json.serialized()))
            }
        }
        try store.persist(rows)
    }
}

struct EmotionDictionary: DictionarySyncHandler {
    let dataClass = 500031
    let metricType = "emotion"
    let title = "Emotion / stress"
    let gate = "ExpandCapability 206 (GB supportsEmotion)"
    static let statusValue = 500031195
    static let valenceCharacterValue = 500031347
    static let originStatusValue = 500031160
    static let arousalCharacterValue = 500031842

    func supports(_ expandCapability: (Int) -> Bool) -> Bool { expandCapability(206) }

    func handleData(store: DictionarySyncStore, dictData: [DictData]) throws {
        var rows = [DictionaryRow]()
        for dt in dictData {
            var status: Int?
            var valence: Double?
            var originStatus: Int?
            var arousal: Double?
            for val in dt.data {
                if val.tag != 10 { continue }
                let value = DictionarySupport.toDouble(val.value)
                switch val.dataType {
                case EmotionDictionary.statusValue:
                    if let value, value >= 0, value < 100 { status = DictionarySupport.javaInt(value) }
                case EmotionDictionary.valenceCharacterValue:
                    if let value, value >= 0, value <= 100 { valence = value }
                case EmotionDictionary.originStatusValue:
                    if let value, value >= 0, value < 100 { originStatus = DictionarySupport.javaInt(value) }
                case EmotionDictionary.arousalCharacterValue:
                    if let value, value >= 0, value <= 100 { arousal = value }
                default: break
                }
            }
            if status != nil || valence != nil || originStatus != nil || arousal != nil {
                var json = MetricJSON()
                json.put("status", .int(status ?? 0))
                if let valence { json.put("valence", .number(valence)) }
                if let originStatus { json.put("originStatus", .int(originStatus)) }
                if let arousal { json.put("arousal", .number(arousal)) }
                rows.append(
                    DictionaryRow(type: metricType, timestamp: dt.startTimestamp, lastTimestamp: DictionarySupport.lastTime(dt), value: Double(status ?? 0), valuesJson: json.serialized())
                )
            }
        }
        try store.persist(rows)
    }
}

struct SleepApneaDictionary: DictionarySyncHandler {
    let dataClass = 500002
    let metricType = "sleep_apnea"
    let title = "Sleep apnea"
    let gate = "ExpandCapability 107 (GB supportsSleepApnea)"
    static let levelValue = 500002847

    func supports(_ expandCapability: (Int) -> Bool) -> Bool { expandCapability(107) }

    func handleData(store: DictionarySyncStore, dictData: [DictData]) throws {
        var rows = [DictionaryRow]()
        for dt in dictData {
            var level: Int?
            for val in dt.data where val.tag == 10 && val.dataType == SleepApneaDictionary.levelValue {
                let value = DictionarySupport.toDouble(val.value).map(DictionarySupport.javaInt) ?? -1
                if value == 1 || value == 2 || value == 3 || value == 4 { level = value }
            }
            if let level {
                var json = MetricJSON()
                json.put("level", .int(level))
                rows.append(DictionaryRow(type: metricType, timestamp: dt.startTimestamp, lastTimestamp: DictionarySupport.lastTime(dt), value: Double(level), valuesJson: json.serialized()))
            }
        }
        try store.persist(rows)
    }
}

/// The classes whose field layout is not known: every value of an entry is stored as it came, no chart number.
struct RawDictionary: DictionarySyncHandler {
    let dataClass: Int
    let metricType: String
    let title: String
    let gate: String
    let supportsBits: @Sendable ((Int) -> Bool) -> Bool

    init(dataClass: Int, metricType: String, title: String, gate: String, supports: @escaping @Sendable ((Int) -> Bool) -> Bool) {
        self.dataClass = dataClass
        self.metricType = metricType
        self.title = title
        self.gate = gate
        self.supportsBits = supports
    }

    func supports(_ expandCapability: (Int) -> Bool) -> Bool { supportsBits(expandCapability) }

    func handleData(store: DictionarySyncStore, dictData: [DictData]) throws {
        var rows = [DictionaryRow]()
        for dt in dictData {
            let json = DictionarySupport.rawValues(dt.data)
            if json.isEmpty { continue }
            rows.append(DictionaryRow(type: metricType, timestamp: dt.startTimestamp, lastTimestamp: DictionarySupport.lastTime(dt), value: nil, valuesJson: json.serialized()))
        }
        try store.persist(rows)
    }
}

// Port of MenstrualCodec.kt: byte level of service 0x32 (menstrual calendar), modelled on the behaviour of Huawei Health 17.0.8.300, plus the
// DataSync dictionary 400018 rows for logged flow and cramps. None of it has been on a real wire yet, so every send and receive is logged.
//
// Commands (phone -> watch unless noted):
//  - `01` switches: tag `01` one byte, a bitfield (bit 0 master, 1 period start, 2 period end, 3 fertile start, 4 fertile end, 5 easy-pregnancy
//    overall switch, only with ExpandCapability 265).
//  - `02` modify time: the watch asks (empty), the phone answers tag `01` = 4-byte unix seconds, or `7F` = 150001.
//  - `03` cycle list: see `cycleList`. `04` update notice: empty, the watch then asks again. `05` capability: tag `01` one byte, 3 with
//    ExpandCapability 174, else 2. `06` frame count and `07` body status frames: see `frameCountAnswer` and `bodyStatusFrame`.
import Foundation

public enum MenstrualCodec {
    public static let service = 0x32
    public static let cmdSwitches = 0x01
    public static let cmdModifyTime = 0x02
    public static let cmdCycles = 0x03
    public static let cmdUpdateNotice = 0x04
    public static let cmdCapability = 0x05
    public static let cmdFrameCount = 0x06
    public static let cmdBodyStatus = 0x07

    /// Error value Huawei Health puts in tag `7F` when it has no data (`150001`).
    public static let errorNoData: Int32 = 150_001
    /// ExpandCapability: menstrual flow as dictionary points.
    public static let capDictionary = 174
    /// ExpandCapability gating the easy-pregnancy switch bit.
    public static let capEasyPregnancySwitch = 265

    /// Switches of `0x32/01`, bit `n` is `1 << n`.
    public struct Switches: Equatable, Sendable {
        public var master = false
        public var periodStart = true
        public var periodEnd = true
        public var fertileStart = true
        public var fertileEnd = false
        public var easyPregnancy = false

        public init(master: Bool = false, periodStart: Bool = true, periodEnd: Bool = true, fertileStart: Bool = true, fertileEnd: Bool = false, easyPregnancy: Bool = false) {
            self.master = master
            self.periodStart = periodStart
            self.periodEnd = periodEnd
            self.fertileStart = fertileStart
            self.fertileEnd = fertileEnd
            self.easyPregnancy = easyPregnancy
        }

        public init(bitfield bits: Int) {
            self.init(
                master: bits & 1 != 0, periodStart: bits & 2 != 0, periodEnd: bits & 4 != 0, fertileStart: bits & 8 != 0,
                fertileEnd: bits & 16 != 0, easyPregnancy: bits & 32 != 0
            )
        }

        /// `CycleSwitches` of the JS side: a missing field keeps its default (the Android `CycleSwitchesRecord`), a field that is not a boolean is refused.
        public init(js: [String: Any]) throws {
            self.init()
            func flag(_ key: String, _ current: Bool) throws -> Bool {
                guard let value = js[key] else { return current }
                if let b = value as? Bool { return b }
                throw WearError(.invalidArgument, "Cycle switch '\(key)' must be a boolean")
            }
            master = try flag("master", master)
            periodStart = try flag("periodStart", periodStart)
            periodEnd = try flag("periodEnd", periodEnd)
            fertileStart = try flag("fertileStart", fertileStart)
            fertileEnd = try flag("fertileEnd", fertileEnd)
            easyPregnancy = try flag("easyPregnancy", easyPregnancy)
        }

        public func bitfield(includeEasyPregnancy: Bool) -> Int {
            (master ? 1 : 0) | (periodStart ? 2 : 0) | (periodEnd ? 4 : 0) | (fertileStart ? 8 : 0) | (fertileEnd ? 16 : 0)
                | (includeEasyPregnancy && easyPregnancy ? 32 : 0)
        }
    }

    public static func switches(_ bitfield: Int) -> HuaweiTLV {
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: UInt8(truncatingIfNeeded: bitfield))
        return tlv
    }

    public static func capability(dictionarySupported: Bool) -> HuaweiTLV {
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: dictionarySupported ? 3 : 2)
        return tlv
    }

    public static func updateNotice() -> HuaweiTLV { HuaweiTLV() }

    /// The error answer: tag `7F` = 150001.
    public static func noData() -> HuaweiTLV {
        var tlv = HuaweiTLV()
        tlv.put(0x7F, int: errorNoData)
        return tlv
    }

    /// `0x32/02` answer: tag `01` = 4-byte `modifiedSec`, or the error tag when nothing is stored.
    public static func modifyTime(_ modifiedSec: Int64?) -> HuaweiTLV {
        guard let modifiedSec else { return noData() }
        var tlv = HuaweiTLV()
        tlv.put(0x01, int: Int32(truncatingIfNeeded: modifiedSec))
        return tlv
    }

    /// What the watch asks for in `0x32/03`.
    public struct CycleRequest: Equatable, Sendable {
        public var historyCycles: Int
        public var futureCycles: Int
        public var tag0a: Bool
        public var tag0b: Bool
        public var tag0c: Bool

        public init(historyCycles: Int, futureCycles: Int, tag0a: Bool, tag0b: Bool, tag0c: Bool) {
            self.historyCycles = historyCycles
            self.futureCycles = futureCycles
            self.tag0a = tag0a
            self.tag0b = tag0b
            self.tag0c = tag0c
        }
    }

    /// Reads the watch's `0x32/03` request; nil when it is an error packet (`7F`) or has no tag `01`.
    public static func parseCycleRequest(_ tlv: HuaweiTLV) -> CycleRequest? {
        if tlv.contains(0x7F) || !tlv.contains(0x01) { return nil }
        guard let bytes = try? tlv.bytes(0x01), bytes.count >= 2 else { return nil }
        return CycleRequest(historyCycles: Int(bytes[0]), futureCycles: Int(bytes[1]), tag0a: tlv.contains(0x0A), tag0b: tlv.contains(0x0B), tag0c: tlv.contains(0x0C))
    }

    private static func seconds(_ day: CivilDate?, _ zone: TimeZone) -> Int32 {
        day.map { Int32(truncatingIfNeeded: CycleModel.daySeconds($0, zone)) } ?? 0
    }

    /// `0x32/03` answer: tag `01` = [finished cycles, future cycles], container `82` of `83{04 period start, 05 period end, 06 fertile start,
    /// 07 fertile end (4-byte unix seconds, 0 = none), 08 cycle length (1 byte), 12 logged (only when `0c` was asked)}`, tag `09` = modify time,
    /// then `0a` = average cycle length when the watch asked `0b`, and `0b` = average period length when it asked `0a` (Huawei Health crosses the
    /// two). `entries` is `CycleModel.entries`, empty means "no data".
    public static func cycleList(
        entries: [CycleEntry], request: CycleRequest, nowSec: Int64, modifiedSec: Int64, averageCycleDays: Int, averagePeriodDays: Int, zone: TimeZone
    ) -> HuaweiTLV {
        if entries.isEmpty { return noData() }
        var finished = 0
        var future = 0
        var list = HuaweiTLV()
        for e in entries {
            let start = CycleModel.daySeconds(e.start, zone)
            // A cycle is finished when start + length < now, upcoming when start > now.
            if start + Int64(e.lengthDays) * 86_400 < nowSec { finished += 1 }
            if start > nowSec { future += 1 }
            var item = HuaweiTLV()
            item.put(0x04, int: Int32(truncatingIfNeeded: start))
            item.put(0x05, int: seconds(e.end, zone))
            item.put(0x06, int: seconds(e.fertileStart, zone))
            item.put(0x07, int: seconds(e.fertileEnd, zone))
            item.put(0x08, byte: UInt8(truncatingIfNeeded: e.lengthDays))
            if request.tag0c { item.put(0x12, byte: e.logged ? 1 : 0) }
            list.put(0x83, tlv: item)
        }
        var out = HuaweiTLV()
        out.put(0x01, bytes: [UInt8(min(finished, 255)), UInt8(min(future, 255))])
        out.put(0x82, tlv: list)
        out.put(0x09, int: Int32(truncatingIfNeeded: modifiedSec))
        if request.tag0b { out.put(0x0A, byte: UInt8(truncatingIfNeeded: averageCycleDays)) }
        if request.tag0a { out.put(0x0B, byte: UInt8(truncatingIfNeeded: averagePeriodDays)) }
        return out
    }

    /// What the watch asks for in `0x32/06`.
    public struct FrameRequest: Equatable, Sendable {
        public var historyDays: Int
        public var futureDays: Int
        public var frameSize: Int

        public init(historyDays: Int, futureDays: Int, frameSize: Int) {
            self.historyDays = historyDays
            self.futureDays = futureDays
            self.frameSize = frameSize
        }
    }

    public static func parseFrameRequest(_ tlv: HuaweiTLV) -> FrameRequest? {
        if tlv.contains(0x7F) { return nil }
        return FrameRequest(
            historyDays: Int(tlv.asInteger(0x01, default: 0)), futureDays: Int(tlv.asInteger(0x02, default: 0)), frameSize: Int(tlv.asInteger(0x03, default: 0))
        )
    }

    /// The frame index in the watch's `0x32/07` request.
    public static func parseBodyStatusRequest(_ tlv: HuaweiTLV) -> Int? {
        if tlv.contains(0x7F) || !tlv.contains(0x01) { return nil }
        return Int(tlv.asInteger(0x01, default: 0))
    }

    /// Frames needed for `count` days at `frameSize` per frame (`ceil(size / frameSize)`).
    public static func frameCount(_ count: Int, frameSize: Int) -> Int { frameSize <= 0 ? 0 : (count + frameSize - 1) / frameSize }

    /// `0x32/06` answer: tag `04` = frame count, or the error tag when there is nothing to send.
    public static func frameCountAnswer(_ frames: Int) -> HuaweiTLV {
        if frames <= 0 { return noData() }
        var tlv = HuaweiTLV()
        tlv.put(0x04, byte: UInt8(min(frames, 255)))
        return tlv
    }

    /// `0x32/07` answer for frame `index` of `days` split into frames of `frameSize`: `01` index, `02` item count (1 byte each) and
    /// `83{84{05 day start (4 bytes), 06 status (2 bytes), 08 physical (2 bytes, 0), 09 sub status (2 bytes, 0)}...}`; nil when the index is out of range.
    public static func bodyStatusFrame(index: Int, days: [(day: CivilDate, status: Int)], frameSize: Int, zone: TimeZone) -> HuaweiTLV? {
        if index < 0 || frameSize <= 0 { return nil }
        let from = index * frameSize
        if from >= days.count { return nil }
        let slice = days[from..<min(days.count, from + frameSize)]
        var items = HuaweiTLV()
        for (day, status) in slice {
            var item = HuaweiTLV()
            item.put(0x05, int: Int32(truncatingIfNeeded: CycleModel.daySeconds(day, zone)))
            item.put(0x06, short: Int16(truncatingIfNeeded: status))
            item.put(0x08, short: 0)
            item.put(0x09, short: 0)
            items.put(0x84, tlv: item)
        }
        var out = HuaweiTLV()
        out.put(0x01, byte: UInt8(truncatingIfNeeded: index))
        out.put(0x02, byte: UInt8(truncatingIfNeeded: slice.count))
        out.put(0x83, tlv: items)
        return out
    }

    /// Dictionary 400018 (`PHYSIOLOGICAL_CYCLE`) field ids, from the APK's `assets/dict_config.txt`.
    public static let dictId = 400_018
    public static let fieldFlow = 400_018_149
    public static let fieldCramps = 400_018_771

    /// Value of a dictionary field: a 4-byte big-endian int.
    public static func dictValue(_ value: Int) -> Bytes {
        let v = UInt32(truncatingIfNeeded: value)
        return [UInt8(v >> 24), UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF)]
    }

    /// Most rows Huawei Health answers a dictionary query with.
    public static let dictMaxRows = 10

    private static let dayMs: Int64 = 86_400_000

    /// Rows for logged days overlapping `startMs`...`endMs` (`endMs` 0 = open) and changed after `modifyMs` (unix ms), oldest first, at most
    /// `dictMaxRows`. Like Huawei Health each (day, field) is its own row, the row spanning the local day; the day's end is
    /// `start + 24 h - 1 ms` [INFERENCE].
    public static func dictionaryRows(days: [LoggedDay], startMs: Int64, endMs: Int64, modifyMs: Int64, zone: TimeZone) -> [DictRow] {
        var rows = [DictRow]()
        for day in days.enumerated().sorted(by: { ($0.element.day, $0.offset) < ($1.element.day, $1.offset) }).map(\.element) {
            let start = CycleModel.daySeconds(day.day, zone) * 1000
            let end = start + dayMs - 1
            if endMs > 0 && start > endMs { continue }
            if end < startMs { continue }
            let modified = day.modifiedSec * 1000
            if modified <= modifyMs { continue }
            rows.append(DictRow(startMs: start, endMs: end, modifyMs: modified, values: [DictValue(key: fieldFlow, value: dictValue(day.flow))]))
            rows.append(DictRow(startMs: start, endMs: end, modifyMs: modified, values: [DictValue(key: fieldCramps, value: dictValue(day.cramps))]))
        }
        return Array(rows.prefix(dictMaxRows))
    }
}

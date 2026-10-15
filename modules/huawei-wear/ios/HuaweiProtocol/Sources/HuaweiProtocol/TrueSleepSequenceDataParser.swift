// Port of HuaweiTrueSleepSequenceDataParser.java and the parts of HuaweiSequenceDataParserBase.java it needs: the summary a
// `sequence_data` record of dictionary class 700013 carries (TLV of dictionary id / data type / value triples), GB's correction of
// summaries the watch marks invalid, the choice of the start time, and the per-minute stage details.
//
// The field list and the `fillData` switch are transcribed one to one from the Java; GoldenSleepParsers.java sweeps every dictionary id.
import Foundation

/// `HuaweiSequenceDataParserBase`: value decoding shared by every dictionary parser.
public enum SequenceDataParserBase {
    /// `readAsInteger`: up to 4 big-endian bytes as a (32-bit) Java int; the float -1 pattern `BF 80 00 00` is `def`, too.
    public static func readAsInteger(_ data: Bytes?, _ def: Int32) -> Int32 {
        guard let data, !data.isEmpty, data.count <= 4 else { return def }
        // NOTE (GB): looks like validData should be float but the watch returns it as integer; BF800000 is float -1.
        if data == [0xBF, 0x80, 0x00, 0x00] { return def }
        var res: UInt32 = 0
        for (i, b) in data.enumerated() { res |= UInt32(b) << UInt32((data.count - i - 1) * 8) }
        return Int32(bitPattern: res)
    }

    /// `readAsLong`: up to 8 big-endian bytes.
    public static func readAsLong(_ data: Bytes?, _ def: Int64) -> Int64 {
        guard let data, !data.isEmpty, data.count <= 8 else { return def }
        var res: UInt64 = 0
        for (i, b) in data.enumerated() { res |= UInt64(b) << UInt64((data.count - i - 1) * 8) }
        return Int64(bitPattern: res)
    }

    /// Java `(long) double`: NaN is 0, out-of-range values saturate, the rest truncates.
    static func javaLong(_ d: Double) -> Int64 {
        if d.isNaN { return 0 }
        if d >= 9_223_372_036_854_775_807.0 { return Int64.max }
        if d <= -9_223_372_036_854_775_808.0 { return Int64.min }
        return Int64(d)
    }

    /// Java `(int) double` for the default values GB passes (-1.0): NaN is 0, saturating.
    static func javaInt(_ d: Double) -> Int32 {
        if d.isNaN { return 0 }
        if d >= Double(Int32.max) { return Int32.max }
        if d <= Double(Int32.min) { return Int32.min }
        return Int32(d)
    }

    /// `getValueAsLong`: data types 1, 2 and 4 are int, byte and short, 3 long, 5 string (not read), 6 double.
    public static func getValueAsLong(_ type: Int32, _ value: Bytes?, _ def: Int64) -> Int64 {
        switch type {
        case 1, 2, 4: return Int64(readAsInteger(value, Int32(truncatingIfNeeded: def)))
        case 3: return readAsLong(value, def)
        case 5: return def
        case 6: return javaLong(Double(bitPattern: UInt64(bitPattern: readAsLong(value, def))))
        default: return def
        }
    }

    /// `getValueAsDouble`.
    public static func getValueAsDouble(_ type: Int32, _ value: Bytes?, _ def: Double) -> Double {
        switch type {
        case 1, 2, 4: return Double(readAsInteger(value, javaInt(def)))
        case 3: return Double(readAsLong(value, Int64(javaInt(def))))
        case 5: return def
        case 6: return Double(bitPattern: UInt64(bitPattern: readAsLong(value, Int64(javaInt(def)))))
        default: return def
        }
    }
}

/// `HuaweiSequenceDataParserBase<T>`: the TLV summary reader; a parser supplies the empty result and what a dictionary id means.
public protocol SequenceDataParsing {
    associatedtype Details
    func newData() -> Details
    func fillData(_ details: inout Details, dictId: Int32, dataType: Int32, value: Bytes)
}

extension SequenceDataParsing {
    /// `parseTLVData`: containers of containers, each with dictionary id (0x03), data type (0x04) and value (0x05). A triple with a
    /// missing tag is skipped (GB logs it); a malformed TLV or a missing summary throws as Java would.
    func parseTLVData(_ summary: Bytes?) throws -> Details {
        var details = newData()
        guard let summary else { throw SleepFilesParseError.missingInput("sequence data has no summary") }
        let tlv: HuaweiTLV
        do { tlv = try HuaweiTLV(parsing: summary) } catch let TLVError.malformed(m) { throw SleepFilesParseError.malformedTLV(m) }
        do {
            for tv in try tlv.allContainerObjects() {
                for tv2 in try tv.allContainerObjects() {
                    do {
                        let dictId = try tv2.asInteger(0x03)
                        let dataType = try tv2.asInteger(0x04)
                        let value = try tv2.bytes(0x5)
                        fillData(&details, dictId: dictId, dataType: dataType, value: value)
                    } catch {
                        // "SequenceDataParserBase dict sync: tag is missing"
                    }
                }
            }
        } catch let TLVError.malformed(m) {
            throw SleepFilesParseError.malformedTLV(m)
        }
        return details
    }

    /// `parseData`: only data version 1 with summary type 2 (TLV) of a file whose type is not 2; nil otherwise.
    public func parseData(file: SequenceDataFileParser.SequenceFileData, data: SequenceDataFileParser.SequenceData) throws -> Details? {
        if data.dataVersion == 1 && data.summaryType == 2 && file.fileType != 2 {
            return try parseTLVData(data.summary)
        }
        return nil
    }
}

/// `HuaweiTrueSleepSequenceDataParser`.
public struct TrueSleepSequenceDataParser: SequenceDataParsing {
    public struct SleepStage: Equatable {
        public let time: Int64
        /// The watch's sleep stage number (a signed Java byte widened to int): 1 light, 2 REM, 3 deep, 4 awake, 5 nap.
        public let stage: Int

        public init(time: Int64, stage: Int) {
            self.time = time
            self.stage = stage
        }
    }

    public struct SleepSummary: Equatable, CustomStringConvertible {
        public var fallAsleepTime: Int64 = -1
        public var bedTime: Int64 = -1
        public var risingTime: Int64 = -1
        public var wakeupTime: Int64 = -1
        public var validData: Int32 = -1
        public var sleepDataQuality: Int32 = -1
        public var deepPart: Int32 = -1
        public var snoreFreq: Int32 = -1
        public var sleepScore: Int32 = -1
        public var sleepLatency: Int32 = -1
        public var sleepEfficiency: Int32 = -1
        public var minHeartRate: Int32 = -1
        public var maxHeartRate: Int32 = -1
        public var minOxygenSaturation: Double = -1
        public var maxOxygenSaturation: Double = -1
        public var minBreathRate: Double = -1
        public var maxBreathRate: Double = -1
        public var hrvDayToBaseline: Int32 = -1
        public var maxHrvBaseline: Int32 = -1
        public var minHrvBaseline: Int32 = -1
        public var avgHrv: Int32 = -1
        public var breathRateDayToBaseline: Int32 = -1
        public var maxBreathRateBaseline: Int32 = -1
        public var minBreathRateBaseline: Int32 = -1
        public var avgBreathRate: Int32 = -1
        public var oxygenSaturationDayToBaseline: Int32 = -1
        public var maxOxygenSaturationBaseline: Int32 = -1
        public var minOxygenSaturationBaseline: Int32 = -1
        public var avgOxygenSaturation: Int32 = -1
        public var heartRateDayToBaseline: Int32 = -1
        public var maxHeartRateBaseline: Int32 = -1
        public var minHeartRateBaseline: Int32 = -1
        public var avgHeartRate: Int32 = -1
        public var rdi: Int32 = -1
        public var wakeCount: Int32 = -1
        public var turnOverCount: Int32 = -1
        public var prepareSleepTime: Int64 = -1
        public var wakeUpFeeling: Int32 = -1
        public var sleepVersion: Int32 = -1

        public init() {}

        public var description: String {
            "SleepSummary{fallAsleepTime=\(fallAsleepTime)"
                + ", bedTime=\(bedTime)"
                + ", risingTime=\(risingTime)"
                + ", wakeupTime=\(wakeupTime)"
                + ", validData=\(validData)"
                + ", sleepDataQuality=\(sleepDataQuality)"
                + ", deepPart=\(deepPart)"
                + ", snoreFreq=\(snoreFreq)"
                + ", sleepScore=\(sleepScore)"
                + ", sleepLatency=\(sleepLatency)"
                + ", sleepEfficiency=\(sleepEfficiency)"
                + ", minHeartRate=\(minHeartRate)"
                + ", maxHeartRate=\(maxHeartRate)"
                + ", minOxygenSaturation=\(minOxygenSaturation)"
                + ", maxOxygenSaturation=\(maxOxygenSaturation)"
                + ", minBreathRate=\(minBreathRate)"
                + ", maxBreathRate=\(maxBreathRate)"
                + ", hrvDayToBaseline=\(hrvDayToBaseline)"
                + ", maxHrvBaseline=\(maxHrvBaseline)"
                + ", minHrvBaseline=\(minHrvBaseline)"
                + ", avgHrv=\(avgHrv)"
                + ", breathRateDayToBaseline=\(breathRateDayToBaseline)"
                + ", maxBreathRateBaseline=\(maxBreathRateBaseline)"
                + ", minBreathRateBaseline=\(minBreathRateBaseline)"
                + ", avgBreathRate=\(avgBreathRate)"
                + ", oxygenSaturationDayToBaseline=\(oxygenSaturationDayToBaseline)"
                + ", maxOxygenSaturationBaseline=\(maxOxygenSaturationBaseline)"
                + ", minOxygenSaturationBaseline=\(minOxygenSaturationBaseline)"
                + ", avgOxygenSaturation=\(avgOxygenSaturation)"
                + ", heartRateDayToBaseline=\(heartRateDayToBaseline)"
                + ", maxHeartRateBaseline=\(maxHeartRateBaseline)"
                + ", minHeartRateBaseline=\(minHeartRateBaseline)"
                + ", avgHeartRate=\(avgHeartRate)"
                + ", rdi=\(rdi)"
                + ", wakeCount=\(wakeCount)"
                + ", turnOverCount=\(turnOverCount)"
                + ", prepareSleepTime=\(prepareSleepTime)"
                + ", wakeUpFeeling=\(wakeUpFeeling)"
                + ", sleepVersion=\(sleepVersion)"
                + "}"
        }
    }

    public init() {}

    public func newData() -> SleepSummary { SleepSummary() }

    public func fillData(_ details: inout SleepSummary, dictId: Int32, dataType: Int32, value: Bytes) {
        typealias B = SequenceDataParserBase
        switch dictId {
        case 700013686:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 { details.fallAsleepTime = v }
        case 700013298:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 { details.bedTime = v }
        case 700013973:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 { details.risingTime = v }
        case 700013156:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 { details.wakeupTime = v }
        case 700013786:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= Int64(Int32.max) { details.validData = Int32(truncatingIfNeeded: v) }
        case 700013254:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= Int64(Int32.max) { details.sleepDataQuality = Int32(truncatingIfNeeded: v) }
        case 700013679:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= Int64(Int32.max) { details.deepPart = Int32(truncatingIfNeeded: v) }
        case 700013721:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= Int64(Int32.max) { details.snoreFreq = Int32(truncatingIfNeeded: v) }
        case 700013245:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= Int64(Int32.max) { details.sleepScore = Int32(truncatingIfNeeded: v) }
        case 700013713:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= Int64(Int32.max) { details.sleepLatency = Int32(truncatingIfNeeded: v) }
        case 700013232:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= Int64(Int32.max) { details.sleepEfficiency = Int32(truncatingIfNeeded: v) }
        case 700013436:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= -1 && v <= 255 { details.minHeartRate = Int32(truncatingIfNeeded: v) }
        case 700013502:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 255 { details.maxHeartRate = Int32(truncatingIfNeeded: v) }
        case 700013340:
            let v = B.getValueAsDouble(dataType, value, -1)
            if v >= 0 { details.minOxygenSaturation = v }
        case 700013026:
            let v = B.getValueAsDouble(dataType, value, -1)
            if v >= 0 { details.maxOxygenSaturation = v }
        case 700013646:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= Int64(Int32.max) { details.minBreathRate = Double(Int32(truncatingIfNeeded: v)) }
        case 700013492:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= Int64(Int32.max) { details.maxBreathRate = Double(Int32(truncatingIfNeeded: v)) }
        case 700013824:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 30 { details.hrvDayToBaseline = Int32(truncatingIfNeeded: v) }
        case 700013355:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 200 { details.maxHrvBaseline = Int32(truncatingIfNeeded: v) }
        case 700013305:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 200 { details.minHrvBaseline = Int32(truncatingIfNeeded: v) }
        case 700013878:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 200 { details.avgHrv = Int32(truncatingIfNeeded: v) }
        case 700013236:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 30 { details.breathRateDayToBaseline = Int32(truncatingIfNeeded: v) }
        case 700013225:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 80 { details.maxBreathRateBaseline = Int32(truncatingIfNeeded: v) }
        case 700013839:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 80 { details.minBreathRateBaseline = Int32(truncatingIfNeeded: v) }
        case 700013886:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 80 { details.avgBreathRate = Int32(truncatingIfNeeded: v) }
        case 700013718:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 30 { details.oxygenSaturationDayToBaseline = Int32(truncatingIfNeeded: v) }
        case 700013227:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 100 { details.maxOxygenSaturationBaseline = Int32(truncatingIfNeeded: v) }
        case 700013633:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 100 { details.minOxygenSaturationBaseline = Int32(truncatingIfNeeded: v) }
        case 700013468:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 100 { details.avgOxygenSaturation = Int32(truncatingIfNeeded: v) }
        case 700013810:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 30 { details.heartRateDayToBaseline = Int32(truncatingIfNeeded: v) }
        case 700013841:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 255 { details.maxHeartRateBaseline = Int32(truncatingIfNeeded: v) }
        case 700013722:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 255 { details.minHeartRateBaseline = Int32(truncatingIfNeeded: v) }
        case 700013580:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 255 { details.avgHeartRate = Int32(truncatingIfNeeded: v) }
        case 700013759:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 100 { details.rdi = Int32(truncatingIfNeeded: v) }
        case 700013635:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 { details.wakeCount = Int32(truncatingIfNeeded: v) }
        case 700013670:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 { details.turnOverCount = Int32(truncatingIfNeeded: v) }
        case 700013821:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 { details.prepareSleepTime = v }
        case 700013925:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 { details.wakeUpFeeling = Int32(truncatingIfNeeded: v) }
        case 700013697:
            let v = B.getValueAsLong(dataType, value, -1)
            if v >= 0 && v <= 100 { details.sleepVersion = Int32(truncatingIfNeeded: v) }

        default:
            break // GB: LOG.info("Unknown dictId")
        }
    }

    /// `correctSummary`: "some watches return incorrect (random) data for some fields"; a summary without valid data loses its
    /// bed time, rising time and every derived value.
    public static func correctSummary(_ summary: inout SleepSummary) {
        if summary.validData == -1 {
            summary.bedTime = 0
            summary.risingTime = 0
            summary.sleepScore = -1
            summary.sleepDataQuality = -1
            summary.deepPart = -1
            summary.snoreFreq = -1
            summary.sleepEfficiency = -1
            summary.sleepLatency = -1
            summary.prepareSleepTime = -1
        }
    }

    private static func adjustTimeToMinute(_ time: Int64) -> Int64 {
        time % 60 != 0 ? (time / 60) * 60 : time
    }

    /// `getTime`: the fall asleep time, or the bed time when the watch supports it and the summary has valid data; whole minutes.
    public static func getTime(fallAsleepTime: Int64, bedTime: Int64, validData: Int32, supportsBedTime: Bool) -> Int64 {
        if !supportsBedTime || validData == -1 {
            return adjustTimeToMinute(fallAsleepTime)
        }
        return adjustTimeToMinute(bedTime)
    }

    /// `parseSleepDetails`: records of duration (little-endian int, seconds), status byte and 3 extra bytes, one stage per minute.
    /// Nil when the length is not a multiple of 4. A multiple of 4 that is not one of 8 ends in a truncated record, which throws
    /// (GB's loop condition is `remaining >= 4` but a record takes 8 bytes). Invalid records are skipped.
    public static func parseSleepDetails(_ data: Bytes, time start: Int64) throws -> [SleepStage]? {
        if data.count % 4 != 0 { return nil }
        var time = start
        var result = [SleepStage]()
        var buffer = SleepFilesByteBuffer(data, littleEndian: true)
        while buffer.remaining >= 4 {
            let duration = try buffer.getInt()
            let status = Int(try buffer.get())
            _ = try buffer.get(count: 3)

            if duration == 0 || status == 0 || duration % 60 != 0 { continue } // GB: "invalid record"
            let minutes = Int(duration / 60)
            if minutes > 1440 { continue } // GB: "more than in one day"
            var i = 0
            while i < minutes {
                result.append(SleepStage(time: time, stage: status))
                time += 60
                i += 1
            }
        }
        return result
    }
}

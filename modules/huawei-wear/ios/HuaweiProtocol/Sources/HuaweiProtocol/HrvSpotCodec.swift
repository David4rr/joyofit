// Port of HrvSpotCodec.kt and the stress record of GB's HuaweiStressParser: the pure parts of the 1-minute HRV measurement (19/01 + 19/05)
// and of the stress calibration built on it.
import Foundation

/// One beat-to-beat interval the watch pushed: `rri` in ms and its signal quality `sqi` (0 = unusable, 100 = good).
public struct RriBeat: Equatable, Sendable {
    public let rri: Int
    public let sqi: Int

    public init(rri: Int, sqi: Int) {
        self.rri = rri
        self.sqi = sqi
    }
}

/// `HuaweiStressParser.StressData`: what the watch takes with its automatic stress switch, and what is stored to send again on reconnect.
public struct StressData: Equatable, Sendable {
    /// Unix milliseconds of the measurement window.
    public var startTime: Int64 = 0
    public var endTime: Int64 = 0
    public var algorithm = 0
    /// A Java byte, 15 to 90 for a calibration.
    public var score: Int8 = 0
    public var scoreFactor: Float = 0
    public var level: Int8 = 0
    public var cFlag: Int8 = 0
    public var type: Int8 = 0
    public var accFlag: Int8 = 0
    public var ppgFlag: Int8 = 0
    public var features: [Float] = []

    public init() {}

    /// `stressDataToJsonStr`; nil when a number cannot be written (Java's JSONException on NaN or infinity).
    public func toJsonString() -> String? {
        let allFinite = scoreFactor.isFinite && features.allSatisfy { $0.isFinite }
        guard allFinite else { return nil }
        let object: [String: Any] = [
            "startTime": startTime, "endTime": endTime, "algorithm": algorithm, "score": Int(score), "scoreFactor": Double(scoreFactor),
            "level": Int(level), "cFlag": Int(cFlag), "type": Int(type), "accFlag": Int(accFlag), "ppgFlag": Int(ppgFlag),
            "features": features.map { Double($0) },
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return nil }
        return String(decoding: data, as: UTF8.self)
    }

    /// `stressDataFromJsonStr`: nil for anything unreadable and for a record GB treats as empty (no end time, a zero score, not 12 features).
    public static func fromJsonString(_ json: String) -> StressData? {
        guard let data = json.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        func number(_ key: String) -> NSNumber? { o[key] as? NSNumber }
        guard let start = number("startTime"), let end = number("endTime"), let algorithm = number("algorithm"), let score = number("score"),
            let factor = number("scoreFactor"), let level = number("level"), let cFlag = number("cFlag"), let type = number("type"),
            let accFlag = number("accFlag"), let ppgFlag = number("ppgFlag"), let list = o["features"] as? [NSNumber]
        else { return nil }
        var st = StressData()
        st.startTime = start.int64Value
        st.endTime = end.int64Value
        st.algorithm = algorithm.intValue
        st.score = Int8(truncatingIfNeeded: score.intValue)
        st.scoreFactor = Float(factor.doubleValue)
        st.level = Int8(truncatingIfNeeded: level.intValue)
        st.cFlag = Int8(truncatingIfNeeded: cFlag.intValue)
        st.type = Int8(truncatingIfNeeded: type.intValue)
        st.accFlag = Int8(truncatingIfNeeded: accFlag.intValue)
        st.ppgFlag = Int8(truncatingIfNeeded: ppgFlag.intValue)
        st.features = list.map { Float($0.doubleValue) }
        if st.endTime == 0 || st.score == 0 || st.features.count != 12 { return nil }
        return st
    }
}

public enum HrvSpotCodec {
    public static let service = 0x19
    public static let openClose = 0x01
    public static let rriData = 0x05

    /// `19/01` tag 01: open the RRI stream (GB HuaweiStressCalibration.startMeasurements).
    public static let open: UInt8 = 3

    /// `19/01` tag 01: close it again (GB HuaweiStressCalibration.stopMeasurements).
    public static let close: UInt8 = 4

    /// The measurement runs this long (GB: `CountDownTimer(60000, 1000)`).
    public static let measureMs: Int64 = 60_000

    /// `19/05`: `82{83{04 rri (2 bytes), 05 sqi (1 byte)}, 83{...}, ...}` (GB `HrRriTest.RriData.Response.parseTlv`). The values are read
    /// unsigned and by size, a beat without either tag is skipped, and several `82` blocks are all read.
    public static func decodeRri(_ tlv: HuaweiTLV?) -> [RriBeat] {
        guard let tlv, tlv.contains(0x82) else { return [] }
        var beats: [RriBeat] = []
        for outer in (try? tlv.objects(0x82)) ?? [] {
            for inner in (try? outer.objects(0x83)) ?? [] {
                guard let rri = HeartRateWire.unsigned(inner.bytes(0x04, default: nil)),
                    let sqi = HeartRateWire.unsigned(inner.bytes(0x05, default: nil))
                else { continue }
                beats.append(RriBeat(rri: rri, sqi: sqi))
            }
        }
        return beats
    }

    /// GB `HuaweiStressCalibration.stopMeasurements`: intervals with `sqi == 0` are dropped, the rest go through `StressHRVCalculation` (10
    /// features) and `StressScoreCalculation`; the watch wants 12 features, the last two always 0. Nil when the model refuses the measurement
    /// (not 50..70 s, not 30..210 intervals, too many outliers...).
    public static func calibrateStress(beats: [RriBeat], startMs: Int64, endMs: Int64) -> StressData? {
        let usable = beats.filter { $0.sqi != 0 }
        let signalSeconds = Int(Int32(truncatingIfNeeded: endMs - startMs) / 1000)
        guard let features = StressHRVCalculation().calculateStressHRVParameters(rri: usable.map(\.rri), sqi: usable.map(\.sqi), signalTime: signalSeconds),
            features.count == 10
        else { return nil }
        let factor = StressScoreCalculation.calculateScoreFactor(features)
        let score = StressScoreCalculation.calculateNormalizedFinalScore(factor)
        var data = StressData()
        data.features = features + [0, 0]
        data.startTime = startMs
        data.endTime = endMs
        data.score = score
        data.scoreFactor = factor
        data.level = StressScoreCalculation.calculateLevel(Int(score))
        return data
    }

    /// `rri_samples.ts_ms`: the phone's start of the window plus the intervals so far (each beat lands at the end of its interval).
    public static func rriTimeline(startMs: Int64, beats: [RriBeat]) -> [(tsMs: Int64, beat: RriBeat)] {
        var t = startMs
        return beats.map { beat in
            t += Int64(beat.rri)
            return (t, beat)
        }
    }
}

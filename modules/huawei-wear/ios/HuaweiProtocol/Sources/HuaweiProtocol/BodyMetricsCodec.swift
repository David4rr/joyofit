// Port of BodyMetrics.kt's data and BodyMetricsCodec: the weight dictionary, the resting-metabolism dictionary and the Health Glance JSON.
// Layouts as Huawei Health 17.0.8.300 behaves on the wire and the dictionary field ids of assets/dict_config.json (10006 bodyWeight 2004,
// bodyFatRate 2001, basalMetabolism 2024; 500018 basalMetabolism 500018055). Kotlin-only logic, verified against the byte vectors of the
// Kotlin BodyAndGoalsTest. UNVERIFIED on the Fit 4 Pro.
import Foundation

/// What JoyoFit knows about the body: the JoyoRogo weigh-in and anything else JS hands over. Every field is optional.
public struct BodyMetricsData: Equatable, Sendable {
    public var weightKg: Double?
    public var weightTsMs: Int64?
    public var bodyFatPct: Double?
    public var bodyFatTsMs: Int64?
    /// Resting metabolism (BMR), kcal per day.
    public var restingKcal: Int?
    public var systolic: Int?
    public var diastolic: Int?
    public var bpTsMs: Int64?

    public init(
        weightKg: Double? = nil, weightTsMs: Int64? = nil, bodyFatPct: Double? = nil, bodyFatTsMs: Int64? = nil, restingKcal: Int? = nil,
        systolic: Int? = nil, diastolic: Int? = nil, bpTsMs: Int64? = nil
    ) {
        self.weightKg = weightKg
        self.weightTsMs = weightTsMs
        self.bodyFatPct = bodyFatPct
        self.bodyFatTsMs = bodyFatTsMs
        self.restingKcal = restingKcal
        self.systolic = systolic
        self.diastolic = diastolic
        self.bpTsMs = bpTsMs
    }

    /// `BodyMetrics` in HuaweiWearDiet.types.ts: every key present, null when unknown.
    public func toJS() -> [String: Any] {
        func js<T>(_ value: T?) -> Any { value.map { $0 as Any } ?? NSNull() }
        return [
            "weightKg": js(weightKg), "weightTs": js(weightTsMs), "bodyFatPct": js(bodyFatPct), "bodyFatTs": js(bodyFatTsMs),
            "restingKcal": js(restingKcal), "systolic": js(systolic), "diastolic": js(diastolic), "bpTs": js(bpTsMs),
        ]
    }
}

/// One field of the Health Glance JSON, its value already written the way Gson writes it.
public struct GlanceField: Equatable, Sendable {
    public let key: String
    public let json: String
}

public enum BodyMetricsCodec {
    public static let phonePkg = "hw.unitedevice.weightMgr"
    public static let watchPkg = "hw.sport.dietcal"

    /// DicDataTypeUtil WEIGHT_BODYFAT_BROAD and its field ids (healthType in dict_config.json).
    public static let dictWeight = 10006
    public static let keyBodyWeight = 2004
    public static let keyBodyFatRate = 2001
    public static let keyBasalMetabolism = 2024

    /// RESTING_METABOLISM_SET and its one field.
    public static let dictResting = 500_018
    public static let keyResting = 500_018_055

    public static let glancePhonePkg = "hw.unitedevice.healthGlanceMgr"
    public static let glanceWatchPkg = "hw.watch.health.healthcheck"
    public static let eventGlance = 80_030_006

    /// The bytes of the IEEE-754 bits, least significant first (`DataSyncBytes.doubleLe`).
    public static func doubleLe(_ value: Double) -> Bytes {
        var bits = value.bitPattern
        return (0..<8).map { _ in
            defer { bits >>= 8 }
            return UInt8(truncatingIfNeeded: bits)
        }
    }

    /// Big-endian int32 (`DataSyncBytes.int32`).
    public static func int32Be(_ value: Int) -> Bytes {
        let v = UInt32(truncatingIfNeeded: value)
        return [UInt8(truncatingIfNeeded: v >> 24), UInt8(truncatingIfNeeded: v >> 16), UInt8(truncatingIfNeeded: v >> 8), UInt8(truncatingIfNeeded: v)]
    }

    /// One row; values are 8-byte little-endian doubles; unknown values are left out.
    public static func weightRow(weightKg: Double, tsMs: Int64, bodyFatPct: Double?, basalKcal: Double?, modifyMs: Int64) -> DictRow {
        var values = [DictValue(key: keyBodyWeight, value: doubleLe(weightKg))]
        if let bodyFatPct { values.append(DictValue(key: keyBodyFatRate, value: doubleLe(bodyFatPct))) }
        if let basalKcal { values.append(DictValue(key: keyBasalMetabolism, value: doubleLe(basalKcal))) }
        return DictRow(startMs: tsMs, endMs: tsMs, modifyMs: modifyMs, values: values)
    }

    /// Row with the 4-byte big-endian kcal.
    public static func restingRow(kcal: Int, startMs: Int64, endMs: Int64, modifyMs: Int64) -> DictRow {
        DictRow(startMs: startMs, endMs: endMs, modifyMs: modifyMs, values: [DictValue(key: keyResting, value: int32Be(kcal))])
    }

    /// Health glance fields (declaration order, null fields omitted): bloodPressureSource, bloodPressureTimestamp, bodyMassIndex,
    /// diastolicPressure, fatPercentageTimestamp, fatPercentage, systolicPressure, height, weight, weightTimestamp.
    /// BMI is weight / (height / 100)^2 rounded to one decimal, only when both are known.
    public static func glance(_ data: BodyMetricsData, weightKg: Double?, heightCm: Int?) -> [GlanceField] {
        var out = [GlanceField]()
        func add(_ key: String, _ json: String) { out.append(GlanceField(key: key, json: json)) }
        let hasBp = data.systolic != nil && data.diastolic != nil
        if hasBp {
            add("bloodPressureSource", "0")
            if let ts = data.bpTsMs { add("bloodPressureTimestamp", String(ts)) }
        }
        if let weightKg, let heightCm, heightCm > 0, weightKg > 0 {
            let meters = Double(heightCm) / 100.0
            let bmi = weightKg / (meters * meters)
            add("bodyMassIndex", String(Float((bmi * 10).rounded(.toNearestOrAwayFromZero) / 10.0)))
        }
        if hasBp, let diastolic = data.diastolic { add("diastolicPressure", String(diastolic)) }
        if let fat = data.bodyFatPct {
            if let ts = data.bodyFatTsMs { add("fatPercentageTimestamp", String(ts)) }
            add("fatPercentage", String(Float(fat)))
        }
        if hasBp, let systolic = data.systolic { add("systolicPressure", String(systolic)) }
        if let heightCm, heightCm > 0 { add("height", String(heightCm)) }
        if let weightKg, weightKg > 0 {
            add("weight", String(Float(weightKg)))
            if let ts = data.weightTsMs { add("weightTimestamp", String(ts)) }
        }
        return out
    }

    /// The glance fields as a JSON object, in order.
    public static func glanceJSON(_ fields: [GlanceField]) -> String {
        "{" + fields.map { "\"\($0.key)\":\($0.json)" }.joined(separator: ",") + "}"
    }
}

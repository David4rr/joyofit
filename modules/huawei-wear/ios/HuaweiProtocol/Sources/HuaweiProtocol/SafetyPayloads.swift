// Port of the fall detection part of SafetyPayloads.kt: the JSON of DataSync config 900500038 (package `hw.unitedevice.sos` <->
// `hw.watch.sos.help`) as Huawei Health 17.0.8.300 writes it. The SOS SMS relay half of the Kotlin file is not ported: iOS apps cannot send SMS.
import Foundation

public enum SafetyPayloads {
    public static let fallConfigId = 900_500_038
    public static let fallPhonePackage = "hw.unitedevice.sos"
    public static let fallWatchPackage = "hw.watch.sos.help"

    /// Config actions: 1 sets, 2 queries (no data).
    public static let actionSet = 1
    public static let actionQuery = 2

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
}

// Port of HealthSensors.kt (GB SetAutomaticHeartrateRequest, SetAutomaticSpoRequest, SetHeartRateHighAlert, SetHeartRateLowAlert,
// SetTruSleepRequest, SendNotifyHeartRateCapabilityRequest, SendNotifyRestHeartRateCapabilityRequest and the capability gates of
// HuaweiState): the watch's own heart rate, SpO2 and sleep sensors. GB sends these only when its settings change (all off by default, none in
// its init queue), so a watch that was wiped and bound to a new account keeps continuous heart rate off. JoyoFit sends them on every connect.
import Foundation

/// What the user chose for the watch's own health sensors; the defaults are Huawei Health's.
public struct HealthSensorConfig: Equatable, Sendable {
    /// Continuous heart rate (FitnessData 07/17), the source of `heartRate` in the step frames.
    public var automaticHeartRate: Bool
    /// Automatic SpO2 (07/24).
    public var automaticSpo2: Bool
    /// TruSleep (07/16), which the sleep files need.
    public var truSleep: Bool
    /// bpm above which the watch alerts, 0 = off (07/1D).
    public var highHeartRateAlert: Int
    /// bpm below which the watch alerts, 0 = off (07/22).
    public var lowHeartRateAlert: Int

    public init(automaticHeartRate: Bool = true, automaticSpo2: Bool = true, truSleep: Bool = true, highHeartRateAlert: Int = 0, lowHeartRateAlert: Int = 0) {
        self.automaticHeartRate = automaticHeartRate
        self.automaticSpo2 = automaticSpo2
        self.truSleep = truSleep
        self.highHeartRateAlert = highHeartRateAlert
        self.lowHeartRateAlert = lowHeartRateAlert
    }

    /// `HealthSensorsUpdate` of the JS contract (the Kotlin `HealthSensorsRecord`): a missing field takes the record's default, a mistyped one
    /// is an invalid argument.
    public static func fromJS(_ raw: [String: Any]) throws -> HealthSensorConfig {
        func bool(_ key: String) throws -> Bool {
            guard let value = raw[key] else { return true }
            if let b = value as? Bool { return b }
            throw WearError(.invalidArgument, "Health sensor field '\(key)' must be a boolean")
        }
        func int(_ key: String) throws -> Int {
            guard let value = raw[key] else { return 0 }
            if let n = value as? NSNumber, !(value is Bool), n.doubleValue == n.doubleValue.rounded() { return n.intValue }
            throw WearError(.invalidArgument, "Health sensor field '\(key)' must be an integer")
        }
        return HealthSensorConfig(
            automaticHeartRate: try bool("automaticHeartRate"), automaticSpo2: try bool("automaticSpo2"), truSleep: try bool("truSleep"),
            highHeartRateAlert: try int("highHeartRateAlert"), lowHeartRateAlert: try int("lowHeartRateAlert")
        )
    }

    public static let highAlertRange = 100...150
    public static let lowAlertRange = 40...50

    /// `WearRuntime.validate(HealthSensorConfig)`: an alert is 0 (off) or inside the range the watch offers.
    public func validationError() -> String? {
        if highHeartRateAlert != 0 && !Self.highAlertRange.contains(highHeartRateAlert) {
            return "High heart-rate alert must be 0 (off) or \(Self.highAlertRange.lowerBound) to \(Self.highAlertRange.upperBound) bpm"
        }
        if lowHeartRateAlert != 0 && !Self.lowAlertRange.contains(lowHeartRateAlert) {
            return "Low heart-rate alert must be 0 (off) or \(Self.lowAlertRange.lowerBound) to \(Self.lowAlertRange.upperBound) bpm"
        }
        return nil
    }
}

/// Which sensor commands the connected watch lists (GB HuaweiState.supports*).
public struct HealthSensorSupport: Equatable, Sendable {
    public var heartRate: Bool
    public var realtimeHeartRate: Bool
    public var spo2: Bool
    public var truSleep: Bool
    public var highHeartRateAlert: Bool
    public var lowHeartRateAlert: Bool

    public func toJS() -> [String: Any] {
        [
            "heartRate": heartRate, "realtimeHeartRate": realtimeHeartRate, "spo2": spo2, "truSleep": truSleep,
            "highHeartRateAlert": highHeartRateAlert, "lowHeartRateAlert": lowHeartRateAlert,
        ]
    }

    public static func of(_ supports: (_ service: Int, _ command: Int) -> Bool) -> HealthSensorSupport {
        let fitness = Int(FitnessData.id)
        return HealthSensorSupport(
            heartRate: supports(fitness, Int(FitnessData.EnableAutomaticHeartrate.id)),  // supportsHeartRate
            realtimeHeartRate: supports(fitness, Int(FitnessData.EnableRealtimeHeartRate.id)),
            spo2: supports(fitness, Int(FitnessData.EnableAutomaticSpo.id)),
            truSleep: supports(fitness, Int(FitnessData.TruSleep.id)),
            highHeartRateAlert: supports(fitness, Int(FitnessData.HighHeartRateAlert.id)),
            lowHeartRateAlert: supports(fitness, Int(FitnessData.LowHeartRateAlert.id))
        )
    }
}

public struct SensorRequest {
    public let label: String
    public let packet: HuaweiPacket

    public init(label: String, packet: HuaweiPacket) {
        self.label = label
        self.packet = packet
    }
}

public enum HealthSensors {
    private static var fitness: Int { Int(FitnessData.id) }

    private static func onOff(_ on: Bool) -> String { on ? "on" : "off" }

    private static func alertText(_ bpm: Int) -> String { bpm > 0 ? "\(bpm) bpm" : "off" }

    /// The requests to send for `config`, in GB's order (capability notifications first, then the switches), each only when the watch lists
    /// its command.
    ///
    /// On connect (`previous` nil) everything is sent, except an alert that is off, so the watch's own alert configuration is not overwritten
    /// with "off". After the user changed a setting, `previous` is the earlier configuration and only what differs is sent, an alert switched
    /// off included.
    public static func plan(
        supports: (_ service: Int, _ command: Int) -> Bool, config: HealthSensorConfig, previous: HealthSensorConfig?
    ) -> [SensorRequest] {
        var plan: [SensorRequest] = []
        if previous == nil {
            // SendNotifyHeartRateCapabilityRequest: supportsWorkoutsTrustHeartRate = 0x17/0x17.
            if supports(Int(WorkoutNotifyHeartRate.service), Int(WorkoutNotifyHeartRate.id)) {
                plan.append(SensorRequest(label: "NotifyHeartRate", packet: WorkoutNotifyHeartRate.request()))
            }
            // SendNotifyRestHeartRateCapabilityRequest: supportsFitnessRestHeartRate = 07/23.
            if supports(fitness, Int(FitnessData.NotifyRestHeartRate.id)) {
                plan.append(SensorRequest(label: "NotifyRestHeartRate", packet: FitnessData.NotifyRestHeartRate.request()))
            }
        }
        if supports(fitness, Int(FitnessData.TruSleep.id)) && (previous == nil || previous!.truSleep != config.truSleep) {
            plan.append(SensorRequest(label: "TruSleep \(onOff(config.truSleep))", packet: FitnessData.TruSleep.request(config.truSleep)))
        }
        if supports(fitness, Int(FitnessData.EnableAutomaticHeartrate.id)) && (previous == nil || previous!.automaticHeartRate != config.automaticHeartRate) {
            plan.append(automaticHeartRateRequest(config.automaticHeartRate))
        }
        if supports(fitness, Int(FitnessData.EnableAutomaticSpo.id)) && (previous == nil || previous!.automaticSpo2 != config.automaticSpo2) {
            plan.append(SensorRequest(label: "AutomaticSpo2 \(onOff(config.automaticSpo2))", packet: FitnessData.EnableAutomaticSpo.request(config.automaticSpo2)))
        }
        if supports(fitness, Int(FitnessData.HighHeartRateAlert.id))
            && (previous == nil ? config.highHeartRateAlert > 0 : previous!.highHeartRateAlert != config.highHeartRateAlert)
        {
            plan.append(
                SensorRequest(
                    label: "HighHeartRateAlert \(alertText(config.highHeartRateAlert))",
                    packet: FitnessData.HighHeartRateAlert.request(enabled: config.highHeartRateAlert > 0, threshold: UInt8(truncatingIfNeeded: config.highHeartRateAlert))
                )
            )
        }
        if supports(fitness, Int(FitnessData.LowHeartRateAlert.id))
            && (previous == nil ? config.lowHeartRateAlert > 0 : previous!.lowHeartRateAlert != config.lowHeartRateAlert)
        {
            plan.append(
                SensorRequest(
                    label: "LowHeartRateAlert \(alertText(config.lowHeartRateAlert))",
                    packet: FitnessData.LowHeartRateAlert.request(enabled: config.lowHeartRateAlert > 0, threshold: UInt8(truncatingIfNeeded: config.lowHeartRateAlert))
                )
            )
        }
        return plan
    }

    /// Sends `plan` one request after the other; returns how many the watch acknowledged. A request that fails or goes unanswered is logged
    /// and does not stop the rest. GB sends the switches without waiting (`addToResponse = false`), so a missing acknowledgement is
    /// reported as "sent, no reply".
    public static func send(session: HuaweiSession, log: LogSink, plan: [SensorRequest], timeoutMs: Int = Timeouts.initMs) async throws -> Int {
        var acknowledged = 0
        for request in plan {
            do {
                _ = try await session.request(request.packet, timeoutMs: timeoutMs, label: request.label)
                acknowledged += 1
                log(LogEntry(.info, "\(request.label): acknowledged"))
            } catch is CancellationError {
                throw CancellationError()
            } catch let e as WearError {
                if e.code == .disconnected { throw e }
                let what = e.code == .timeout ? "sent, no reply" : "failed: \(e.message)"
                log(LogEntry(.error, "\(request.label): \(what)"))
            } catch {
                log(LogEntry(.error, "\(request.label): failed: \(error)"))
            }
        }
        return acknowledged
    }

    /// SetAutomaticHeartrateRequest in GB's realtime mode: FitnessData 07/1C carries one boolean. `enabled` starts the watch pushing
    /// heart-rate readings; the watch's reply is the same command. Gated by HuaweiState.supportsRealtimeHeartRate (07/1C).
    public static func realtimeRequest(_ enabled: Bool) -> SensorRequest {
        SensorRequest(label: "RealtimeHeartRate \(onOff(enabled))", packet: FitnessData.EnableRealtimeHeartRate.request(enabled))
    }

    /// Automatic heart rate on its own, used to restore the baseline after the realtime mode ends.
    public static func automaticHeartRateRequest(_ enabled: Bool) -> SensorRequest {
        SensorRequest(label: "AutomaticHeartRate \(onOff(enabled))", packet: FitnessData.EnableAutomaticHeartrate.request(enabled))
    }

    /// Realtime readings the watch pushes outside any request, on the command it was asked on.
    public static let realtimeService = FitnessData.id
    public static let realtimeCommand = FitnessData.EnableRealtimeHeartRate.id

    public static let minBpm = 30
    public static let maxBpm = 250

    /// One heart-rate reading from a pushed realtime packet. GB never receives one (it has no parser), so the layout is not known from its
    /// sources: this takes the first single-byte value in the physiological range from the TLV, descending into containers (tags with bit 7
    /// set). The raw frame is logged by the session, so a different layout shows up in the log.
    public static func decodeRealtime(_ tlv: HuaweiTLV?) -> Int? {
        guard let tlv else { return nil }
        for entry in tlv.entries {
            if entry.tag >= 0x80 {
                guard let nested = try? HuaweiTLV(parsing: entry.value) else { continue }
                if let bpm = decodeRealtime(nested) { return bpm }
            } else if entry.value.count == 1 {
                let bpm = Int(entry.value[0])
                if (minBpm...maxBpm).contains(bpm) { return bpm }
            }
        }
        return nil
    }

    /// `19/03`: `81{82{03 bpm, 04 time s, 05 credibility}}`, possibly several; the last reading in range wins.
    public static func decodeNotice(_ tlv: HuaweiTLV) -> Int? {
        var last: Int?
        for outer in (try? tlv.objects(0x81)) ?? [] {
            for inner in (try? outer.objects(0x82)) ?? [] {
                guard let bytes = inner.bytes(0x03, default: nil), let bpm = HeartRateWire.unsigned(bytes) else { continue }
                if (25...250).contains(bpm) { last = bpm }
            }
        }
        return last
    }
}

/// Wire helpers of the heart-rate services.
public enum HeartRateWire {
    /// `CommonUtil.y(hex)`: unsigned big-endian, one to four bytes; anything else is nil.
    public static func unsigned(_ bytes: Bytes?) -> Int? {
        guard let bytes, !bytes.isEmpty, bytes.count <= 4 else { return nil }
        var n = 0
        for b in bytes { n = (n << 8) | Int(b) }
        return n
    }
}

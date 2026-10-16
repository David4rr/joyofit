// Port of the FitnessData.java requests (service 0x07) that switch the watch's own sensors, plus Workout.NotifyHeartRate (17/17) and the
// heart-rate zone configuration (07/13 and 07/21). Java `byte` parameters are `UInt8` bit patterns.
import Foundation

extension FitnessData {
    /// 07/16: TruSleep on or off.
    public enum TruSleep {
        public static let id: UInt8 = 0x16

        public static func request(_ enabled: Bool) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, bool: enabled)
            return HuaweiPacket(serviceId: FitnessData.id, commandId: id, tlv: tlv)
        }
    }

    /// 07/17: continuous heart rate, the source of `heartRate` in the step frames.
    public enum EnableAutomaticHeartrate {
        public static let id: UInt8 = 0x17

        public static func request(_ enabled: Bool) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, bool: enabled)
            return HuaweiPacket(serviceId: FitnessData.id, commandId: id, tlv: tlv, isEncrypted: true)
        }
    }

    /// 07/1C: realtime heart rate (the same boolean GB uses for its realtime mode).
    public enum EnableRealtimeHeartRate {
        public static let id: UInt8 = 0x1C

        public static func request(_ enabled: Bool) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, bool: enabled)
            return HuaweiPacket(serviceId: FitnessData.id, commandId: id, tlv: tlv, isEncrypted: true)
        }
    }

    /// 07/1D: alert above a heart rate; the threshold is only sent when enabled.
    public enum HighHeartRateAlert {
        public static let id: UInt8 = 0x1D

        public static func request(enabled: Bool, threshold: UInt8) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, bool: enabled)
            if enabled { tlv.put(0x02, byte: threshold) }
            return HuaweiPacket(serviceId: FitnessData.id, commandId: id, tlv: tlv, isEncrypted: true)
        }
    }

    /// 07/22: alert below a heart rate.
    public enum LowHeartRateAlert {
        public static let id: UInt8 = 0x22

        public static func request(enabled: Bool, threshold: UInt8) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, bool: enabled)
            if enabled { tlv.put(0x02, byte: threshold) }
            return HuaweiPacket(serviceId: FitnessData.id, commandId: id, tlv: tlv, isEncrypted: true)
        }
    }

    /// 07/23: tells the watch the phone takes resting heart rate (TLV 01: int 1).
    public enum NotifyRestHeartRate {
        public static let id: UInt8 = 0x23

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, int: 0x01)
            return HuaweiPacket(serviceId: FitnessData.id, commandId: id, tlv: tlv)
        }
    }

    /// 07/24: automatic SpO2.
    public enum EnableAutomaticSpo {
        public static let id: UInt8 = 0x24

        public static func request(_ enabled: Bool) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, bool: enabled)
            return HuaweiPacket(serviceId: FitnessData.id, commandId: id, tlv: tlv, isEncrypted: true)
        }
    }

    /// GB's HeartRateZoneConfigPacket with plain ints (see `HeartRateZonesCalc`): 07/13 (simple) or 07/21 (extended).
    public enum HeartRateZoneConfigPacket {
        public static let idSimple: UInt8 = 0x13
        public static let idExtended: UInt8 = 0x21

        /// `mhr` is `{zone1..zone5, threshold}` or nil, written only with a warning limit > 0 and threshold > 0; `hrr` is
        /// `{zone1..zone5, resting}` or nil, extended command only. Every number is cast to a byte like the Java.
        private static func build(id: UInt8, warningEnable: Bool, warningHRLimit: Int, mhr: [Int]?, calculationMethod: Int, hrr: [Int]?) -> HuaweiPacket {
            func b(_ v: Int) -> UInt8 { UInt8(truncatingIfNeeded: v) }
            var sub = HuaweiTLV()
            sub.put(0x08, bool: warningEnable)
            if let mhr, warningHRLimit > 0, mhr[5] > 0 {
                sub.put(0x09, byte: b(warningHRLimit))
                sub.put(0x02, byte: b(mhr[0]))
                sub.put(0x03, byte: b(mhr[1]))
                sub.put(0x04, byte: b(mhr[2]))
                sub.put(0x05, byte: b(mhr[3]))
                sub.put(0x06, byte: b(mhr[4]))
                sub.put(0x07, byte: b(mhr[5]))
                sub.put(0x0B, byte: b(mhr[5]))
            }
            if id == idExtended, let hrr {
                sub.put(0x0D, byte: b(hrr[0]))
                sub.put(0x0E, byte: b(hrr[1]))
                sub.put(0x0F, byte: b(hrr[2]))
                sub.put(0x10, byte: b(hrr[3]))
                sub.put(0x11, byte: b(hrr[4]))
                sub.put(0x0A, byte: b(calculationMethod))
                sub.put(0x0C, byte: b(hrr[5]))
            }
            var tlv = HuaweiTLV()
            tlv.put(0x81, tlv: sub)
            return HuaweiPacket(serviceId: FitnessData.id, commandId: id, tlv: tlv)
        }

        public static func requestSimple(warningEnable: Bool, warningHRLimit: Int, mhr: [Int]?) -> HuaweiPacket {
            build(id: idSimple, warningEnable: warningEnable, warningHRLimit: warningHRLimit, mhr: mhr, calculationMethod: 0, hrr: nil)
        }

        public static func requestExtended(warningEnable: Bool, warningHRLimit: Int, mhr: [Int]?, calculationMethod: Int, hrr: [Int]?) -> HuaweiPacket {
            build(id: idExtended, warningEnable: warningEnable, warningHRLimit: warningHRLimit, mhr: mhr, calculationMethod: calculationMethod, hrr: hrr)
        }
    }
}

/// Workout.java `NotifyHeartRate` (17/17): tells the watch the phone takes the workout heart rate (TLV 01: int 3).
public enum WorkoutNotifyHeartRate {
    public static let service: UInt8 = 0x17
    public static let id: UInt8 = 0x17

    public static func request() -> HuaweiPacket {
        var tlv = HuaweiTLV()
        tlv.put(0x01, int: 0x03)
        return HuaweiPacket(serviceId: service, commandId: id, tlv: tlv)
    }
}

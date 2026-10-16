// Port of Stress.java (service 0x20) and HrRriTest.java (service 0x19): the automatic stress switch and the beat-to-beat interval stream the
// calibration minute and the HRV measurement open.
import Foundation

public enum Stress {
    public static let id: UInt8 = 0x20

    public enum AutomaticStress {
        public static let id: UInt8 = 0x09

        /// `status` 1 turns it on with the calibration (`score`, 12 `feature` floats, `time` in seconds), 2 turns it off. Java only writes the
        /// calibration when the list holds exactly 12 floats; each float is written big-endian (`ByteBuffer.putFloat`).
        public static func request(status: UInt8, score: UInt8, features: [Float]?, time: Int32) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: status)
            if let features, features.count == 12 {
                tlv.put(0x02, byte: score)
                var bytes = Bytes()
                bytes.reserveCapacity(48)
                for f in features { bytes.appendBE(f.bitPattern) }
                tlv.put(0x03, bytes: bytes)
                tlv.put(0x04, int: time)
            }
            return HuaweiPacket(serviceId: Stress.id, commandId: id, tlv: tlv, isEncrypted: true)
        }
    }
}

public enum HrRriTest {
    public static let id: UInt8 = 0x19

    public enum OpenOrClose {
        public static let id: UInt8 = 0x01

        public static func request(type: UInt8) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: type)
            return HuaweiPacket(serviceId: HrRriTest.id, commandId: id, tlv: tlv, isEncrypted: true)
        }
    }

    public enum RriData {
        public static let id: UInt8 = 0x05
    }
}

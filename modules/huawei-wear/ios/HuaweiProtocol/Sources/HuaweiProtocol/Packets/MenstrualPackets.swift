// Port of Menstrual.java (service 0x32): the packets the phone sends. `Message` is the watch-fit addition, a phone -> watch packet for any
// command of the service with a prebuilt TLV (built by `MenstrualCodec`); GB's CapabilityRequest is unchanged. The watch's own requests
// (modify time, cycle list, frame count, body status) are read by `MenstrualCodec`, which the Kotlin does too (GB's response class reads nothing).
import Foundation

public enum Menstrual {
    public static let id: UInt8 = 0x32

    public enum CapabilityRequest {
        public static let id: UInt8 = 0x05

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: 0x02)
            return HuaweiPacket(serviceId: Menstrual.id, commandId: id, tlv: tlv)
        }
    }

    /// Phone -> watch: command `commandId` of service 0x32 carrying `body`.
    public static func message(commandId: UInt8, body: HuaweiTLV) -> HuaweiPacket {
        HuaweiPacket(serviceId: Menstrual.id, commandId: commandId, tlv: body)
    }
}

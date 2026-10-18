// Port of PhotoFace.java (written for watch-fit in the style of GB's Watchface.java / FileUpload.java; layouts from Huawei Health 17.0.8.300):
// only the phone-to-watch packets of the photo face. The watch's answers (27/08, 27/09) and its file requests (28/01) reach the code as plain
// decrypted packets and are read from their TLV by `PhotoFaceCodec`.
import Foundation

public enum PhotoFace {
    /// Service 0x27 (Watchface): the photo face's own settings.
    public static let watchfaceId: UInt8 = 0x27
    /// Service 0x28 (FileUpload): the watch asks the phone for a file.
    public static let fileUploadId: UInt8 = 0x28

    /// 27/08: read the photo face's settings and its photo list. `position`, `style` and `data` also ask for the position index (tag 0x08 of
    /// the answer), the style index (0x09) and the data index (0x0a).
    public enum InfoRequest {
        public static let id: UInt8 = 0x08

        public static func request(position: Bool, style: Bool, data: Bool) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            for tag in [0x01, 0x02, 0x03, 0x04, 0x0c, 0x0d] { tlv.put(tag) }
            if position { tlv.put(0x08) }
            if style { tlv.put(0x09) }
            if data { tlv.put(0x0a) }
            return HuaweiPacket(serviceId: watchfaceId, commandId: id, tlv: tlv)
        }
    }

    /// 27/09: the photo list the face should show and its settings (built by `PhotoFaceCodec.saveTlv`). The watch answers with how many
    /// photos it still wants.
    public enum SaveRequest {
        public static let id: UInt8 = 0x09

        public static func request(_ tlv: HuaweiTLV) -> HuaweiPacket {
            HuaweiPacket(serviceId: watchfaceId, commandId: id, tlv: tlv)
        }
    }

    /// 28/01 from the phone: the answer to the watch's request for a file ("reportDeviceRequest"). `resourceType` is the watch's tag 0x05, or
    /// -1 when its request had none; `status` is 100000 to say the file is available and will be sent, 140006 when it is not.
    public enum FileRequestAnswer {
        public static let id: UInt8 = 0x01

        public static func request(fileName: String, fileType: Int, resourceType: Int, status: Int) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, string: fileName)
            tlv.put(0x02, byte: UInt8(truncatingIfNeeded: fileType))
            if resourceType != -1 { tlv.put(0x05, byte: UInt8(truncatingIfNeeded: resourceType)) }
            tlv.put(0x7f, int: Int32(truncatingIfNeeded: status))
            return HuaweiPacket(serviceId: fileUploadId, commandId: id, tlv: tlv)
        }
    }

    /// 27/05 from the phone: the acknowledgement of a status report from the watch (Huawei Health `reportAck`).
    public enum ReportAck {
        public static let id: UInt8 = 0x05

        public static func request(watchfaceId face: String, version: String) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, string: face)
            tlv.put(0x02, string: version)
            tlv.put(0x7f, int: 0x0001_86A0)
            return HuaweiPacket(serviceId: watchfaceId, commandId: id, tlv: tlv)
        }
    }
}

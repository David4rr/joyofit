// Port of P2P.java (Gadgetbridge, AGPL-3.0-or-later): service 0x34, command 0x01, the one packet every P2P module (health dictionary sync,
// healthy living, fitness courses, heart-rate zones) rides on.
import Foundation

public enum P2P {
    public static let id: UInt8 = 0x34

    public enum P2PCommand {
        public static let id: UInt8 = 0x01

        /// `P2PCommand.Request`: cmd 1 ping, 2 data, 3 acknowledgement (tag 0x08 is the code), 4 get version. The fingerprints go in only
        /// for cmd 2, the data only when not empty.
        public static func request(
            cmdId: UInt8, sequenceId: Int16, srcPackage: String?, dstPackage: String?, srcFingerprint: String?, dstFingerprint: String?,
            sendData: Bytes?, sendCode: Int32
        ) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: cmdId)
            tlv.put(0x02, short: sequenceId)
            tlv.put(0x03, string: srcPackage)
            tlv.put(0x04, string: dstPackage)
            if cmdId == 0x2 {
                tlv.put(0x05, string: srcFingerprint)
                tlv.put(0x06, string: dstFingerprint)
            }
            if let sendData, !sendData.isEmpty { tlv.put(0x07, bytes: sendData) }
            if cmdId == 0x3 { tlv.put(0x08, int: sendCode) }
            return HuaweiPacket(serviceId: P2P.id, commandId: id, tlv: tlv)
        }

        /// `P2PCommand.Response.parseTlv`. The response code (tag 0x08) is a byte from the watch but an int to it, so it is read as any width.
        public struct Response: PacketResponse, Equatable, Sendable {
            public var cmdId: Int8
            public var sequenceId: Int16
            public var srcPackage: String
            public var dstPackage: String
            public var srcFingerprint: String?
            public var dstFingerprint: String?
            public var respData: Bytes?
            public var respCode: Int32

            public init(
                cmdId: Int8, sequenceId: Int16, srcPackage: String, dstPackage: String, srcFingerprint: String? = nil, dstFingerprint: String? = nil,
                respData: Bytes? = nil, respCode: Int32 = 0
            ) {
                self.cmdId = cmdId
                self.sequenceId = sequenceId
                self.srcPackage = srcPackage
                self.dstPackage = dstPackage
                self.srcFingerprint = srcFingerprint
                self.dstFingerprint = dstFingerprint
                self.respData = respData
                self.respCode = respCode
            }

            public init(packet: HuaweiPacket) throws {
                guard let tlv = packet.tlv else { throw TLVError.malformed("P2P packet without TLV") }
                cmdId = try tlv.byte(0x01)
                sequenceId = try tlv.short(0x02)
                srcPackage = try tlv.string(0x03)
                dstPackage = try tlv.string(0x04)
                srcFingerprint = tlv.contains(0x05) ? try tlv.string(0x05) : nil
                dstFingerprint = tlv.contains(0x06) ? try tlv.string(0x06) : nil
                respData = tlv.contains(0x07) ? try tlv.bytes(0x07) : nil
                respCode = tlv.contains(0x08) ? try tlv.asInteger(0x08) : 0
            }
        }
    }
}

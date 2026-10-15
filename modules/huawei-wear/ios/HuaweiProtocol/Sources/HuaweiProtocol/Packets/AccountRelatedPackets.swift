// Port of AccountRelated.java (service 0x1A): only the extended account request the initializer sends.
import Foundation

public enum AccountRelated {
    public static let id: UInt8 = 0x1A

    public enum SendExtendedAccountToDevice {
        public static let id: UInt8 = 0x05

        /// An empty account sends tag 0x01 = 0x00; `accountPairingOptimization` adds tag 0x03 = 1. Encrypted and sliced like every Java default.
        public static func request(accountPairingOptimization: Bool, account: String) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            if !account.isEmpty { tlv.put(0x01, string: account) } else { tlv.put(0x01, byte: 0x00) }
            if accountPairingOptimization { tlv.put(0x03, byte: 0x01) }
            return HuaweiPacket(serviceId: AccountRelated.id, commandId: id, tlv: tlv)
        }
    }
}

// Port of DataSync.java (service 0x37), config command only: what find my watch sends and what the watch answers. The event, data and
// dictionary commands have no iOS user yet.
import Foundation

public enum DataSync {
    public static let id: UInt8 = 0x37

    /// HuaweiDataSyncCommon.REPLY_OK.
    public static let replyOK: Int32 = 100_000

    /// HuaweiState.supportsFindDeviceAbility.
    public static let findDeviceCapability = 79
    /// HuaweiState.supportsDeviceCommandConfig: the watch accepts config commands.
    public static let configCommandCapability = 83
    public static let findDeviceConfigId: Int32 = 900_100_002
    public static let findDeviceSrcPackage = "hw.unitedevice.finddevice"
    public static let findDeviceDstPackage = "findDevice"

    /// `DataSync.getError`: tag 0x7F when present, else REPLY_OK.
    static func error(_ tlv: HuaweiTLV) throws -> Int32 {
        if tlv.contains(0x7F) { return try tlv.int(0x7F) }
        return replyOK
    }

    /// HuaweiDataSyncCommon.ConfigData; the Java defaults (-1) mean "not sent".
    public struct ConfigData: Equatable, Sendable {
        public var configId: Int32 = -1
        public var configAction: Int8 = -1
        public var configData: Bytes?
        public var configUnknown: Int64 = -1

        public init(configId: Int32 = -1, configAction: Int8 = -1, configData: Bytes? = nil, configUnknown: Int64 = -1) {
            self.configId = configId
            self.configAction = configAction
            self.configData = configData
            self.configUnknown = configUnknown
        }
    }

    public enum ConfigCommand {
        public static let id: UInt8 = 0x01

        /// `ConfigCommand.Request`: tags 01 src package, 02 dst package, 83 { 84 { 05 id, 06 action, 07 data, 08 unknown } ... }.
        public static func request(srcPackage: String, dstPackage: String, configs: [ConfigData]) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, string: srcPackage)
            tlv.put(0x02, string: dstPackage)
            if !configs.isEmpty {
                var list = HuaweiTLV()
                for config in configs {
                    var item = HuaweiTLV()
                    if config.configId != -1 { item.put(0x05, int: config.configId) }
                    if config.configAction != -1 { item.put(0x06, byte: UInt8(bitPattern: config.configAction)) }
                    if let data = config.configData { item.put(0x07, bytes: data) }
                    if config.configUnknown != -1 { item.put(0x08, long: config.configUnknown) }
                    list.put(0x84, tlv: item)
                }
                tlv.put(0x83, tlv: list)
            }
            return HuaweiPacket(serviceId: DataSync.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var srcPackage: String
            public var dstPackage: String
            /// The reply code; REPLY_OK unless the watch sent tag 0x7F.
            public var code: Int32 = DataSync.replyOK
            public var configs: [ConfigData] = []

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "DataSync config")
                (srcPackage, dstPackage, code, configs) = try PacketsJava.parsing("DataSync config") {
                    let src = try tlv.string(0x01)
                    let dst = try tlv.string(0x02)
                    let code = try DataSync.error(tlv)
                    if code != DataSync.replyOK { return (src, dst, code, []) }
                    var configs: [ConfigData] = []
                    if tlv.contains(0x83) {
                        for sub in try tlv.object(0x83).objects(0x84) {
                            var config = ConfigData()
                            if sub.contains(0x05) { config.configId = try sub.int(0x05) }
                            if sub.contains(0x06) { config.configAction = try sub.byte(0x06) }
                            if sub.contains(0x07) { config.configData = try sub.bytes(0x07) }
                            if sub.contains(0x08) { config.configUnknown = try sub.long(0x08) }
                            configs.append(config)
                        }
                    }
                    return (src, dst, code, configs)
                }
            }
        }
    }
}

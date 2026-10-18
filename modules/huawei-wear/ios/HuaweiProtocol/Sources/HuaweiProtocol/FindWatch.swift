// Port of PhoneFeatures.findWatch (GB HuaweiDataSyncFindDevice.sendStartFindDevice / sendStopFindDevice): a DataSync (0x37) config command
// from `hw.unitedevice.finddevice` to `findDevice`, config id 900100002, action 2 to start and 1 to stop. GB registers it only with
// ExpandCapability 79 and sends config commands only with ExpandCapability 83.
import Foundation

public enum FindWatch {
    /// What `PhoneFeatures.findWatchSupported` reports: both capability bits are set in the bitmap the watch sent during init.
    public static func supported(_ caps: DeviceCaps) -> Bool {
        caps.expandCapability(DataSync.findDeviceCapability) && caps.expandCapability(DataSync.configCommandCapability)
    }

    /// The reason a watch cannot be found, nil when it can.
    public static func unsupportedReason(_ caps: DeviceCaps) -> String? {
        if !caps.expandCapability(DataSync.findDeviceCapability) {
            return "The watch does not report find-device support (ExpandCapability \(DataSync.findDeviceCapability))"
        }
        if !caps.expandCapability(DataSync.configCommandCapability) {
            return "The watch does not report DataSync config commands (ExpandCapability \(DataSync.configCommandCapability))"
        }
        return nil
    }

    /// Sends start (`true`) or stop (`false`). GB's SendDataSyncConfigCommand has addToResponse = false: the reply is only logged
    /// (`DataSyncService` logs it), so this returns once the frames are written.
    public static func send(session: HuaweiSession, caps: DeviceCaps, log: LogSink, start: Bool) async throws {
        if let reason = unsupportedReason(caps) { throw WearError(.unsupported, reason) }
        let config = DataSync.ConfigData(configId: DataSync.findDeviceConfigId, configAction: start ? 2 : 1)
        let packet = DataSync.ConfigCommand.request(
            srcPackage: DataSync.findDeviceSrcPackage, dstPackage: DataSync.findDeviceDstPackage, configs: [config]
        )
        log(LogEntry(.info, "Find watch: \(start ? "start" : "stop")"))
        try await session.send(packet, label: "FindWatch \(start ? "start" : "stop")")
    }
}

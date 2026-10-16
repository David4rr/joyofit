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
    /// (see `attach`), so this returns once the frames are written.
    public static func send(session: HuaweiSession, caps: DeviceCaps, log: LogSink, start: Bool) async throws {
        if let reason = unsupportedReason(caps) { throw WearError(.unsupported, reason) }
        let config = DataSync.ConfigData(configId: DataSync.findDeviceConfigId, configAction: start ? 2 : 1)
        let packet = DataSync.ConfigCommand.request(
            srcPackage: DataSync.findDeviceSrcPackage, dstPackage: DataSync.findDeviceDstPackage, configs: [config]
        )
        log(LogEntry(.info, "Find watch: \(start ? "start" : "stop")"))
        try await session.send(packet, label: "FindWatch \(start ? "start" : "stop")")
    }

    /// Logs what the watch answers on DataSync config (`37/01`), like DataSyncService does on Android; the session allows one subscriber
    /// per service and command, so this is the only one. Returns the subscription id for `HuaweiSession.unsubscribe`.
    public static func attach(session: HuaweiSession, log: @escaping LogSink) async -> Int {
        await session.subscribe(service: DataSync.id, command: DataSync.ConfigCommand.id, label: "datasync config") { packet in
            do {
                let reply = try DataSync.ConfigCommand.Response(packet: packet)
                let items = reply.configs.map { "id=\($0.configId) action=\($0.configAction)" }.joined(separator: ", ")
                log(LogEntry(
                    reply.code == DataSync.replyOK ? .info : .error,
                    "DataSync config from watch: src=\(reply.srcPackage) wear=\(reply.dstPackage) code=\(reply.code) (100000 is OK) \(items.isEmpty ? "no items" : items)"
                ))
            } catch {
                log(LogEntry(.error, "DataSync config: could not parse the watch's packet: \(error)"))
            }
        }
    }
}

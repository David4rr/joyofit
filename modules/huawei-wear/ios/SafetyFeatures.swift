// Fall detection over DataSync (config 900500038). Port of the fall half of SafetyFeatures.kt; `getSafety` merges it with the inert SOS relay
// half (iOS apps cannot send SMS). Fall detection is only offered when the watch reports what Huawei Health needs for it: ExpandCapability 83
// (DataSync configs) and SupportedCommands service 0x33 command 1 (`isSupportSosTransmission`). See SafetyPayloads for the wire format.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class SafetyFeatures: DataSyncFeature, @unchecked Sendable {
    public let name = "safety"
    public let settings: WatchExtrasSettings
    private let link: LinkHandleSource
    private let events: WearEvents
    private let lock = NSLock()
    private var service: DataSyncService?
    private let now: @Sendable () -> Date

    public init(link: LinkHandleSource, settings: WatchExtrasSettings, events: WearEvents, now: @escaping @Sendable () -> Date = { Date() }) {
        self.link = link
        self.settings = settings
        self.events = events
        self.now = now
    }

    private func log(_ message: String) { events.info(message) }

    private func dataSync() -> DataSyncService? { lock.locked { service } }

    public func register(service: DataSyncService) {
        lock.locked { self.service = service }
        service.onConfig(phonePkg: SafetyPayloads.fallPhonePackage, watchPkg: SafetyPayloads.fallWatchPackage, configId: SafetyPayloads.fallConfigId) { [weak self] config in
            self?.onFallConfig(config)
        }
    }

    public func onConnected() async throws {
        let gate = fallGate()
        log("Fall detection: \(gate ?? "supported") (config \(SafetyPayloads.fallConfigId), bit \(DataSyncWire.capConfig), 0x33/01)")
        if gate == nil { _ = try await queryFall() }
    }

    // MARK: fall detection

    /// Why fall detection cannot be used with the connected watch, or nil when it can.
    public func fallGate() -> String? {
        guard let handle = link.handle() else { return "no watch connected" }
        if !handle.caps.expandCapability(DataSyncWire.capConfig) {
            return "the watch does not report DataSync configs (ExpandCapability \(DataSyncWire.capConfig))"
        }
        if !handle.caps.supports(0x33, 0x01) { return "the watch does not list SOS support (service 0x33 command 01)" }
        return nil
    }

    /// Asks the watch for its switch (config 900500038, action 2, no data); the answer arrives in `onFallConfig`.
    public func queryFall() async throws -> Bool {
        if let reason = fallGate() {
            log("Fall detection query not sent: \(reason)")
            return false
        }
        guard let service = dataSync() else { return false }
        return try await service.sendConfig(
            phonePkg: SafetyPayloads.fallPhonePackage, watchPkg: SafetyPayloads.fallWatchPackage, configId: SafetyPayloads.fallConfigId,
            data: nil, action: SafetyPayloads.actionQuery, what: "fall detection query"
        )
    }

    /// Sets the watch's switch (action 1 with `{fallDetectionSwitch, timeStamp}`); the stored state follows the watch's own report.
    public func setFall(_ enabled: Bool) async throws -> Bool {
        if let reason = fallGate() { throw WearError(.unsupported, "Fall detection cannot be changed: \(reason)") }
        guard let service = dataSync() else { return false }
        let nowMs = Int64(now().timeIntervalSince1970 * 1000)
        let sent = try await service.sendConfig(
            phonePkg: SafetyPayloads.fallPhonePackage, watchPkg: SafetyPayloads.fallWatchPackage, configId: SafetyPayloads.fallConfigId,
            data: SafetyPayloads.fallConfig(enabled: enabled, timeStampMs: nowMs), action: SafetyPayloads.actionSet, modifyMs: nowMs,
            what: "fall detection \(enabled ? "on" : "off")"
        )
        if sent {
            // Huawei Health stores what it sent as well; the watch's own report (onFallConfig) overwrites it.
            settings.fallSwitch = enabled ? 1 : 0
            settings.fallUpdatedMs = nowMs
        }
        return sent
    }

    private func onFallConfig(_ config: SampleConfigIn) {
        guard let item = config.items.first else {
            log("Fall detection: config from the watch has no item")
            return
        }
        guard let state = SafetyPayloads.parseFallConfig(item.data) else {
            log("Fall detection: config from the watch (action \(item.action)) carries no readable fallDetectionSwitch: \(DataSyncWire.describe(item.data))")
            return
        }
        settings.fallSwitch = state.switchState
        settings.fallUpdatedMs = state.timeStampMs > 0 ? state.timeStampMs : Int64(now().timeIntervalSince1970 * 1000)
        log("Fall detection: the watch reports \(state.switchState == 1 ? "ON" : "OFF") (action \(item.action), timeStamp \(state.timeStampMs))")
    }

    // MARK: JS

    /// `SafetyStatus`: the real fall detection and sleep report values; the SOS relay half stays the inert one (iOS cannot send SMS).
    public func status() -> [String: Any] {
        var status = Inert.safety()
        let gate = fallGate()
        status["fallSupported"] = gate == nil
        status["fallNote"] = gate ?? "the watch reports fall detection support"
        status["fallSwitch"] = settings.fallSwitch
        status["fallUpdatedMs"] = settings.fallUpdatedMs
        status["sleepReportEnabled"] = settings.sleepReportEnabled
        status["sleepReportSupported"] = link.handle()?.caps.expandCapability(DataSyncWire.capEvent) ?? false
        return status
    }
}

#endif

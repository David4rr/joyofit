// The watch-side settings that are plain protocol commands on iOS too: alarms, the health sensor switches, live heart rate, the one-minute
// HRV measurement and the automatic stress switch. Ports of the alarm part of PhoneFeatures.kt and of HealthSensors/LiveHeartRate/HrvSpot/
// StressSwitch, reaching the watch through the live `LinkHandle`. Registered as a `LinkObserver` for what has to follow the session.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class WatchSettingsFeatures: LinkObserver, @unchecked Sendable {
    private let handle: @Sendable () -> LinkHandle?
    private let settings: WearSettings
    private let events: WearEvents
    private let nowMs: @Sendable () -> Int64

    public init(
        handle: @escaping @Sendable () -> LinkHandle?, settings: WearSettings, events: WearEvents,
        nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.handle = handle
        self.settings = settings
        self.events = events
        self.nowMs = nowMs
    }

    // MARK: LinkObserver

    public func linkConnected(_ handle: LinkHandle) async {}

    public func linkDisconnected() {}

    // MARK: alarms

    private func alarmsJS(_ alarms: WatchAlarms) -> [String: Any] {
        let caps = handle()?.caps
        return alarms.toJS(supported: caps.map(AlarmSync.supported) ?? false, smartSupported: caps.map(AlarmSync.smartSupported) ?? false)
    }

    /// `getAlarms`: the alarms last read from or pushed to the watch; empty before the first exchange.
    public func cachedAlarms() -> [String: Any] { alarmsJS(WatchAlarms.fromJson(settings.alarmsJson)) }

    /// `refreshAlarms`: reads the watch's alarms and keeps them.
    public func refreshAlarms() async throws -> [String: Any] {
        guard let h = handle() else { throw WearError(.notConnected, "Not connected to a watch") }
        let alarms = try await AlarmSync.read(session: h.session, caps: h.caps, log: events.sink)
        settings.alarmsJson = alarms.toJson()
        return alarmsJS(alarms)
    }

    /// `setAlarms`: pushes `alarms` and returns what the watch holds afterwards (read back, so a missing acknowledgment is visible).
    public func setAlarms(_ alarms: WatchAlarms) async throws -> [String: Any] {
        try AlarmSync.validate(alarms)
        guard let h = handle() else { throw WearError(.notConnected, "Not connected to a watch") }
        try await AlarmSync.write(session: h.session, caps: h.caps, log: events.sink, alarms: alarms)
        return try await refreshAlarms()
    }
}

#endif

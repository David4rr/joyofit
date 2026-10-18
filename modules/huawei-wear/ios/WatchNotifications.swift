// Notifications on iOS. The Android app reads the phone's notifications and writes them to the watch; iOS does not let an app do that.
// Instead the watch reads the iPhone's notifications itself over ANCS, which iOS offers to an accessory the user allowed ("Show
// Notifications" under Settings > Bluetooth > the watch, or the system prompt the first time). What the app can do is switch the watch's own
// notification switch (Notifications 02/04, GB `PREF_NOTIFICATION_ENABLE`) and report whether iOS shares notifications with the watch.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// The one setting: nil until the user chooses, so a watch's switch is not touched before that (a switch the user set elsewhere, for
/// example by Huawei Health, stays as it is).
public final class WatchNotificationSettings: @unchecked Sendable {
    private let defaults: UserDefaults
    private static let key = "watch_notifications_enabled"

    public init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? UserDefaults(suiteName: "joyofit_settings") ?? .standard
    }

    public var enabled: Bool? {
        get { defaults.object(forKey: Self.key) == nil ? nil : defaults.bool(forKey: Self.key) }
        set {
            if let newValue { defaults.set(newValue, forKey: Self.key) } else { defaults.removeObject(forKey: Self.key) }
        }
    }
}

public final class WatchNotifications: LinkObserver, @unchecked Sendable {
    private let link: WearLink
    private let events: WearEvents
    public let settings: WatchNotificationSettings

    public init(link: WearLink, events: WearEvents, settings: WatchNotificationSettings = WatchNotificationSettings()) {
        self.link = link
        self.events = events
        self.settings = settings
    }

    // MARK: LinkObserver

    /// Applies the saved choice to a freshly connected watch, as Android's init does with its notification switch.
    public func linkConnected(_ handle: LinkHandle) async {
        guard let enabled = settings.enabled else {
            events.info("Notifications: no choice made in the app, the watch's own switch is left as it is")
            return
        }
        do {
            _ = try await Self.send(handle: handle, enabled: enabled, log: events.sink)
        } catch {
            events.error("NotificationState not sent: \(error)")
        }
    }

    public func linkDisconnected() {}

    // MARK: JS

    /// `NotificationAccessStatus`: `granted` is iOS sharing notifications with the watch (ANCS), `enabled` the watch's switch as chosen here.
    public func access() -> [String: Any] {
        ["granted": link.ancsAuthorized() ?? false, "enabled": settings.enabled ?? false]
    }

    /// Stores the choice and, when a watch is connected, sets its switch. Throws when the watch does not list the command.
    public func setEnabled(_ enabled: Bool) async throws {
        settings.enabled = enabled
        guard let handle = link.handle() else { return }
        guard try await Self.send(handle: handle, enabled: enabled, log: events.sink) else {
            throw WearError(.unsupported, "The watch does not list the notification switch (service 02, command 04)")
        }
    }

    /// SendNotificationSwitch: a watch that does not list 02/04 is not sent it. True when the watch acknowledged.
    static func send(handle: LinkHandle, enabled: Bool, log: LogSink) async throws -> Bool {
        guard handle.caps.supports(Int(Notifications.id), Int(Notifications.NotificationState.id)) else { return false }
        try await handle.operationLock.withLock {
            _ = try await handle.session.request(
                Notifications.NotificationState.request(enabled: enabled), timeoutMs: Timeouts.initMs, label: "NotificationState"
            )
        }
        log(LogEntry(.info, "NotificationState: \(enabled ? "on" : "off")"))
        return true
    }
}

#endif

// Process-wide owner of the one WearLink. The JS module, the background controller and the app delegate all reach the watch through this
// object, so there is never a second link. Events fan out to whichever JS module instance is alive (none, when the app has no JS running)
// and update `status`. Port of WearRuntime.kt (the parts that exist on iOS).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// What a status screen shows.
public struct ServiceStatus: Equatable, Sendable {
    public var state: LinkState
    public var battery: Int?
    /// `SyncResult.to` of the last stored sync of this process, unix seconds.
    public var lastSyncSec: Int64?
    /// Why the link is down, when the background loop knows (waiting for Bluetooth, retry, paused...).
    public var note: String?
}

/// A watch seen advertising: what `getBondedDevices` lists on iOS, which has no list of bonded devices.
public struct NearbyWatch: Sendable, Equatable {
    public let identifier: String
    public let name: String?

    public init(identifier: String, name: String?) {
        self.identifier = identifier
        self.name = name
    }
}

public final class WearRuntime: @unchecked Sendable {
    public let settings: WearSettings
    public let syncStore: SyncStore
    /// What the support report quotes; fed from `events` whether or not a screen listens.
    public let supportLog = SupportLog()
    public let environment: SupportReport.Environment

    /// The fan-out `WearLink`, the background controller and the module log through.
    public var events: WearEvents { fanOut }
    public private(set) var link: WearLink!
    public private(set) var controller: BackgroundController!
    /// Features that act on the live session register here; see `LinkObservers`.
    public let linkObservers = LinkObservers()
    /// Find my watch.
    public private(set) var features: PhoneFeatures!
    /// The watch's notification switch and iOS's ANCS state.
    public private(set) var notifications: WatchNotifications!
    /// Alarms, health sensor switches, live heart rate, HRV and stress (the watch settings that are plain protocol commands).
    public private(set) var watchSettings: WatchSettingsFeatures!
    /// Weather push (settings, the watch's weather requests, the refresh timer).
    public private(set) var weather: WeatherController!
    /// Watch face list, install, activate and delete.
    public private(set) var watchfaces: WatchfaceController!
    /// The watch's photo face and its photos.
    public private(set) var photoFaces: PhotoFaceController!
    /// The one subscriber of DataSync (service 0x37); features register their handlers on it.
    public private(set) var dataSync: DataSyncService!
    /// Editable watch-face options over DataSync.
    public private(set) var faceCustomizer: WatchfaceCustomizer!
    /// Activity-ring goals and reminders.
    public private(set) var activityGoals: ActivityGoals!
    /// Weight, body fat, resting metabolism and the Health Glance card.
    public private(set) var bodyMetrics: BodyMetrics!

    /// Called after every stored sync (the HealthKit export hooks in here).
    public var onSyncComplete: (@Sendable (SyncSummary) -> Void)?

    private let nearby: @Sendable (_ timeoutMs: Int) async throws -> [NearbyWatch]
    private let fanOut = FanOut()
    private let lock = NSLock()
    private var listeners: [UUID: WearEvents] = [:]
    private var _paused = false
    private var _status = ServiceStatus(state: .disconnected, battery: nil, lastSyncSec: nil, note: nil)
    private var nearbyCache: (atMs: Int, list: [NearbyWatch])?
    private let nowMs: @Sendable () -> Int

    /// The user disconnected in the app while background mode is on: auto-reconnect waits until a connect from the app, or background being
    /// switched off and on again.
    public var paused: Bool { lock.locked { _paused } }

    public var status: ServiceStatus { lock.locked { _status } }

    public init(
        settings: WearSettings,
        syncStore: SyncStore,
        deviceStore: DeviceStore,
        gate: BluetoothGate,
        environment: SupportReport.Environment,
        phoneModel: String,
        transportFactory: @escaping TransportFactory,
        nearby: @escaping @Sendable (_ timeoutMs: Int) async throws -> [NearbyWatch] = { _ in [] },
        expiring: @escaping ExpiringWork = { _, work in await work() },
        now: @escaping @Sendable () -> Date = { Date() },
        clock: @escaping @Sendable () -> Int = BackgroundController.uptimeMs,
        weatherLocation: LocationSource = UnavailableLocationSource(),
        weatherFetch: @escaping WeatherFetch = WeatherNetwork.fetch,
        weatherDefaults: UserDefaults? = nil,
        goalsDefaults: UserDefaults? = nil
    ) {
        self.settings = settings
        self.syncStore = syncStore
        self.environment = environment
        self.nearby = nearby
        self.nowMs = clock
        fanOut.runtime = self
        link = WearLink(
            events: fanOut, settings: settings, syncStore: syncStore, deviceStore: deviceStore, gate: gate, phoneModel: phoneModel,
            transportFactory: transportFactory, now: now
        )
        controller = BackgroundController(runtime: self, expiring: expiring, clock: clock)
        features = PhoneFeatures(link: link, events: fanOut)
        notifications = WatchNotifications(link: link, events: fanOut)
        linkObservers.add(notifications)
        watchSettings = WatchSettingsFeatures(handle: { [link] in link?.handle() }, settings: settings, syncStore: syncStore, events: fanOut)
        linkObservers.add(watchSettings)
        weather = WeatherController(
            settings: WeatherSettings(defaults: weatherDefaults), link: link, events: fanOut, location: weatherLocation, fetch: weatherFetch, expiring: expiring, now: now
        )
        linkObservers.add(weather)
        watchfaces = WatchfaceController(link: link, events: fanOut)
        photoFaces = PhotoFaceController(link: link, events: fanOut)
        dataSync = DataSyncService(link: link, events: fanOut)
        faceCustomizer = WatchfaceCustomizer(events: fanOut, faces: { [watchfaces] in try await watchfaces!.entries() })
        dataSync.register(faceCustomizer)
        activityGoals = ActivityGoals(defaults: goalsDefaults, service: dataSync, events: fanOut, settings: settings)
        dataSync.register(activityGoals)
        bodyMetrics = BodyMetrics(store: syncStore, service: dataSync, events: fanOut, settings: settings)
        dataSync.register(bodyMetrics)
        linkObservers.add(dataSync)
    }

    // MARK: events

    /// Fans every event of the link out to `listener` until `removeListener`.
    public func addListener(_ listener: WearEvents) -> UUID {
        let token = UUID()
        lock.locked { listeners[token] = listener }
        return token
    }

    public func removeListener(_ token: UUID) { lock.locked { listeners[token] = nil } }

    fileprivate func currentListeners() -> [WearEvents] { lock.locked { Array(listeners.values) } }

    fileprivate func handleState(_ state: LinkState, _ error: String?) {
        if state == .connecting { supportLog.connectStarted() }
        supportLog.add("STATE \(state.rawValue)" + (error.map { ": \($0)" } ?? ""))
        lock.locked {
            _status.state = state
            if state != .disconnected { _status.note = nil }
        }
        if state == .connected, let handle = link.handle() { linkObservers.connected(handle) }
        if state == .disconnected { linkObservers.disconnected() }
        currentListeners().forEach { $0.state(state, error: error) }
        if state == .disconnected || state == .connected { controller?.onLinkChanged() }
    }

    fileprivate func handleBattery(_ level: Int) {
        lock.locked { _status.battery = level }
        currentListeners().forEach { $0.battery(level) }
    }

    fileprivate func handleSyncComplete(_ summary: SyncSummary) {
        lock.locked { _status.lastSyncSec = summary.to }
        onSyncComplete?(summary)
        currentListeners().forEach { $0.syncComplete(summary) }
    }

    fileprivate func handleHeartRate(_ bpm: Int, _ tsMs: Int64) { currentListeners().forEach { $0.heartRate(bpm: bpm, tsMs: tsMs) } }

    fileprivate func handleHrvProgress(_ secondsLeft: Int, _ beats: Int) { currentListeners().forEach { $0.hrvProgress(secondsLeft: secondsLeft, beats: beats) } }

    fileprivate func handleLog(_ entry: LogEntry) {
        let ids = entry.serviceId.map { " svc=\(SupportReport.hex2($0)) cmd=\(SupportReport.hex2(entry.commandId ?? 0))" } ?? ""
        let hexForConsole = entry.hex.map { " \($0)" } ?? ""
        // Mirrored to the console under the JoyoFit tags, so the log can be read over the device syslog with the UI closed.
        WearConsole.general("\(entry.direction.rawValue.uppercased())\(ids) \(entry.message)\(hexForConsole)", error: entry.direction == .error)
        let command = (entry.serviceId != nil && entry.commandId != nil) ? " \(SupportReport.hex2(entry.serviceId!))/\(SupportReport.hex2(entry.commandId!))" : ""
        let packet = entry.hex.map { " \($0.prefix(96))\($0.count > 96 ? "..." : "")" } ?? ""
        WearConsole.ble("[\(entry.direction.rawValue)]\(command) \(entry.message)\(packet)")
        // Without the frame hex: it is encrypted with this phone's key and means nothing to anyone reading the report.
        supportLog.add("\(entry.direction.rawValue.uppercased())\(ids) \(entry.message)")
        currentListeners().forEach { $0.log(entry) }
    }

    public func setNote(_ note: String?) { lock.locked { _status.note = note } }

    private final class FanOut: WearEvents, @unchecked Sendable {
        weak var runtime: WearRuntime?
        func state(_ state: LinkState, error: String?) { runtime?.handleState(state, error) }
        func battery(_ level: Int) { runtime?.handleBattery(level) }
        func syncComplete(_ summary: SyncSummary) { runtime?.handleSyncComplete(summary) }
        func log(_ entry: LogEntry) { runtime?.handleLog(entry) }
        func heartRate(bpm: Int, tsMs: Int64) { runtime?.handleHeartRate(bpm, tsMs) }
        func hrvProgress(secondsLeft: Int, beats: Int) { runtime?.handleHrvProgress(secondsLeft, beats) }
        func uploadProgress(bytes: Int, total: Int) { runtime?.currentListeners().forEach { $0.uploadProgress(bytes: bytes, total: total) } }
        func uploadResult(ok: Bool, fileName: String, code: Int?, message: String) {
            runtime?.currentListeners().forEach { $0.uploadResult(ok: ok, fileName: fileName, code: code, message: message) }
        }
        func faceCustomization(_ payload: [String: Any]) { runtime?.currentListeners().forEach { $0.faceCustomization(payload) } }
    }

    // MARK: bonded devices

    /// iOS has no list of bonded Bluetooth devices. The watches `getBondedDevices` returns are the remembered one, plus the ones advertising
    /// within a short scan while no link is open (cached for 30 s), each with the support level of its model.
    public func bondedDevices() async throws -> [[String: Any]] {
        var found: [NearbyWatch] = []
        if let address = settings.watchAddress {
            found.append(NearbyWatch(identifier: address, name: settings.watchName))
        }
        if link.currentState() == .disconnected {
            do {
                for watch in try await cachedNearby() where !found.contains(where: { $0.identifier.caseInsensitiveCompare(watch.identifier) == .orderedSame }) {
                    found.append(watch)
                }
            } catch {
                // Bluetooth off or not allowed: the remembered watch still lists; with none, the user needs to hear why.
                if found.isEmpty { throw error }
            }
        }
        return found
            .map { watch -> [String: Any] in
                let name = watch.name ?? watch.identifier
                var entry: [String: Any] = ["address": DeviceStore.normalize(watch.identifier), "name": name]
                for (key, value) in WatchModels.match(watch.name).toJS() { entry[key] = value }
                return entry
            }
            .sorted { ($0["name"] as! String).lowercased() < ($1["name"] as! String).lowercased() }
    }

    private func cachedNearby() async throws -> [NearbyWatch] {
        let now = nowMs()
        if let cache = lock.locked({ nearbyCache }), now - cache.atMs < 30_000 { return cache.list }
        let list = try await nearby(4_000)
        lock.locked { nearbyCache = (now, list) }
        return list
    }

    // MARK: support report

    /// The support report: the last watch, its capabilities and the kept log, without addresses or serial.
    public func supportReport() -> [String: Any] {
        let device = link.deviceInfo() ?? link.lastDeviceInfo
        var identifiers = [String]()
        if let a = settings.watchAddress { identifiers.append(a) }
        if let a = device?.address { identifiers.append(a) }
        return SupportReport.build(
            environment: environment,
            watchName: link.lastAttemptName ?? settings.watchName,
            device: device,
            linkState: link.currentState().rawValue,
            log: supportLog.lines(),
            caps: link.lastCaps,
            transport: .le,
            identifiers: identifiers
        )
    }

    // MARK: link actions from the app

    public func connectFromApp(_ address: String) async throws -> WatchDeviceInfo {
        lock.locked { _paused = false }
        return try await link.connect(address)
    }

    public func disconnectFromApp() {
        if settings.backgroundEnabled {
            lock.locked { _paused = true }
            setNote("Disconnected in the app. Connect there to resume.")
        }
        link.disconnect()
    }

    public func forget(_ rawAddress: String) {
        let address = DeviceStore.normalize(rawAddress)
        link.forget(address)
        if let remembered = settings.watchAddress, remembered.caseInsensitiveCompare(address) == .orderedSame {
            try? setBackground(nil)
            settings.watchAddress = nil
            settings.watchName = nil
        }
    }

    /// JS reload with background off: nothing keeps the link, so it is closed as before.
    public func onModuleDestroyed() {
        watchSettings.liveHeartRate.setActive(false)
        watchSettings.hrv.cancel()
        if !settings.backgroundEnabled { link.shutdown() }
    }

    // MARK: background mode

    /// Starts the background session for `rawAddress` (the controller connects, reconnects and syncs while iOS keeps the process alive), or
    /// stops it when `rawAddress` is nil.
    public func setBackground(_ rawAddress: String?) throws {
        guard let rawAddress else {
            settings.backgroundEnabled = false
            lock.locked { _paused = false }
            setNote(nil)
            controller.stop()
            return
        }
        let address = DeviceStore.normalize(rawAddress)
        guard UUID(uuidString: address) != nil else {
            throw WearError(.invalidAddress, "'\(rawAddress)' is not a Bluetooth peripheral identifier")
        }
        if settings.watchAddress != address { settings.watchName = nil }
        settings.watchAddress = address
        settings.backgroundEnabled = true
        lock.locked { _paused = false }
        setNote(nil)
        controller.start()
        controller.nudge(reset: true)
    }

    /// Brings the controller back when background mode is on but it is not running (a relaunch by iOS, an app update).
    public func ensureBackgroundRunning() {
        if settings.backgroundEnabled && settings.watchAddress != nil && !controller.isRunning { controller.start() }
    }

    public func backgroundStatus() -> [String: Any] {
        [
            "enabled": settings.backgroundEnabled,
            "address": settings.watchAddress ?? NSNull(),
            "name": settings.watchName ?? NSNull(),
            "running": controller.isRunning,
            "paused": paused,
            "syncIntervalMinutes": settings.syncIntervalMinutes,
        ]
    }

    public func setSyncInterval(_ minutes: Int) throws {
        if minutes < WearSettings.minSyncIntervalMin || minutes > WearSettings.maxSyncIntervalMin {
            throw WearError(
                .invalidArgument,
                "Sync interval must be \(WearSettings.minSyncIntervalMin) to \(WearSettings.maxSyncIntervalMin) minutes, got \(minutes)"
            )
        }
        settings.syncIntervalMinutes = minutes
        controller.reschedule()
    }

    // MARK: activity goals

    /// Stores the goals and reminders and sends them; true when they all reached the watch. The steps goal and the profile's daily step goal are
    /// one number: the profile (which goes out as MotionGoal 07/01) follows the ring's goal.
    public func setActivityGoals(_ goals: ActivityGoalsData) async throws -> Bool {
        try ActivityGoalsCodec.validate(goals)
        if let profile = settings.profile, profile.dailyStepGoal != goals.steps {
            var next = profile
            next.dailyStepGoal = goals.steps
            _ = try await setUserProfile(next)
        }
        return try await activityGoals.set(goals)
    }

    // MARK: profile

    /// Stores the profile; true when it also reached the connected watch.
    public func setUserProfile(_ profile: UserProfileData, thisYear: Int = Calendar.current.component(.year, from: Date())) async throws -> Bool {
        if let message = profile.validationError(thisYear: thisYear) { throw WearError(.invalidArgument, message) }
        settings.profile = profile
        guard let handle = link.handle() else { return false }
        do {
            let sent = try await ProfileSender.sendProfile(session: handle.session, caps: handle.caps, log: events.sink, profile: profile)
            return sent > 0
        } catch let e as WearError {
            events.error("Profile not sent: \(e.message)")
            return false
        }
    }
}

#endif

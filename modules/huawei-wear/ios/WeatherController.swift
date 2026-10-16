// Fetches weather and keeps the watch's weather screen current. Port of WeatherController.kt (derived from Gadgetbridge's
// HuaweiWeatherManager.{sendWeather,handleAsyncMessage} and AsynchronousResponse.handleWeatherCheck):
// - on connect (when the weather switch is on and the watch lists the weather service),
// - whenever the watch asks (service 0f command 04, TLV 0x7f = 0x186AA, GB `handleAsyncMessage`),
// - every `intervalMinutes` while the link is up AND the process runs.
// When it cannot get weather it tells the watch why (GB's WeatherError packets).
//
// What differs from Android, which times its refresh with an idle-safe alarm: iOS suspends the app, and a suspended app runs no timer. So the
// interval is a Task that counts only while the process runs, plus two hooks that look at the clock when the process is awake again: the app
// coming to the foreground and the background controller's sync wake (a bluetooth-central wake). Whatever the timer missed is pushed then;
// `lastPushAt` in the status is always the time of a push that really reached the watch.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// The live connection, as the weather needs it: `WearLink` in the app, a scripted watch in the logic tests.
public protocol LinkHandleProvider: AnyObject, Sendable {
    func handle() -> LinkHandle?
}

extension WearLink: LinkHandleProvider {}

public final class WeatherController: LinkObserver, @unchecked Sendable {
    /// Weather request code in the watch's 0f/04 message (GB handleAsyncMessage).
    public static let watchRequestCode: Int32 = 0x000186AA
    /// A reconnect inside this window reuses the last fetched report.
    static let connectMaxAgeSec: Int64 = 10 * 60
    /// A watch that opens its weather screen repeatedly does not refetch inside this window.
    static let requestMaxAgeSec: Int64 = 5 * 60
    static let retryMs = 10 * 60_000

    private let settings: WeatherSettings
    private let link: LinkHandleProvider
    private let events: WearEvents
    private let location: WeatherLocation
    private let fetch: WeatherFetch
    private let expiring: ExpiringWork
    private let now: @Sendable () -> Date
    private let zone: @Sendable () -> TimeZone
    private let sleep: @Sendable (Int) async throws -> Void

    private let lock = NSLock()
    /// GB `syncInProgress`: a push already running swallows the next request.
    private var pushing = false
    private var cache: WeatherReport?
    private var cacheKey: String?
    private var lastPushAtSec: Int64?
    private var lastError: String?
    private var lastTempC: Int?
    private var lastCondition: String?
    private var lastPlaceName: String?
    private var subscribed: (session: HuaweiSession, id: Int)?
    private var timer: Task<Void, Never>?
    private var timerGeneration = 0
    /// Wall-clock second the next periodic push is due; the hooks compare it with the clock after the process was suspended.
    private var nextDueAtSec: Int64?

    public init(
        settings: WeatherSettings,
        link: LinkHandleProvider,
        events: WearEvents,
        location: LocationSource,
        fetch: @escaping WeatherFetch = WeatherNetwork.fetch,
        expiring: @escaping ExpiringWork = { _, work in await work() },
        now: @escaping @Sendable () -> Date = { Date() },
        zone: @escaping @Sendable () -> TimeZone = { .current },
        sleep: @escaping @Sendable (Int) async throws -> Void = { try await Task.sleep(nanoseconds: UInt64(max($0, 0)) * 1_000_000) }
    ) {
        self.settings = settings
        self.link = link
        self.events = events
        self.fetch = fetch
        self.expiring = expiring
        self.now = now
        self.zone = zone
        self.sleep = sleep
        self.location = WeatherLocation(source: location, settings: settings, now: now) { [events] in events.info($0) }
    }

    private func info(_ message: String) { events.info(message) }
    private func fail(_ message: String) { events.error(message) }
    private func nowSec() -> Int64 { Int64(now().timeIntervalSince1970) }
    private func intervalMs() -> Int { settings.intervalMinutes * 60_000 }

    // MARK: link lifecycle (LinkObserver)

    /// A new session: listen for the watch's own weather requests, and push when the switch is on.
    public func linkConnected(_ handle: LinkHandle) async {
        let id = await handle.session.subscribe(service: Weather.id, command: Weather.WeatherDeviceRequest.id, label: "weather request") { [weak self] packet in
            self?.onWatchMessage(handle, packet)
        }
        lock.locked { subscribed = (handle.session, id) }
        let supported = HuaweiWeatherSender.supported(handle.caps)
        info("Weather: the watch \(supported ? "lists" : "does not list") the weather service (0f/01); switch is \(settings.enabled ? "on" : "off")")
        if settings.enabled && supported {
            await runExpiring("JoyoFit weather") { _ = try? await self.pushAndSchedule("connect", maxAgeSec: WeatherController.connectMaxAgeSec) }
        }
    }

    public func linkDisconnected() {
        lock.locked { subscribed = nil }
        stopTicker()
    }

    /// Runs `body` with the extra execution time iOS grants for it; errors are the body's to handle.
    private func runExpiring(_ name: String, _ body: @escaping @Sendable () async -> Void) async {
        await expiring(name, body)
    }

    /// A setting changed: push at once when the watch is connected, or stop the timer when the switch went off.
    private func onSettingsChanged() {
        lock.locked {
            cache = nil
            cacheKey = nil
        }
        Task { [self] in
            if link.handle() == nil { return }
            if settings.enabled {
                await runExpiring("JoyoFit weather") { _ = try? await self.pushAndSchedule("settings", maxAgeSec: 0) }
            } else {
                stopTicker()
            }
        }
    }

    /// The interval changed: the next push is one new interval away.
    private func onIntervalChanged() {
        if link.handle() != nil && settings.enabled { scheduleNext(intervalMs()) }
    }

    // MARK: hooks for a process that was asleep

    /// The app came to the foreground, or the background controller woke for a sync: push if the periodic push is overdue. The timer cannot
    /// have fired while the process was suspended; this is where the clock is read again.
    public func pushIfDue(_ reason: String) async {
        guard settings.enabled, let handle = link.handle(), HuaweiWeatherSender.supported(handle.caps) else { return }
        if let due = lock.locked({ nextDueAtSec }), nowSec() < due { return }
        await runExpiring("JoyoFit weather") { _ = try? await self.pushAndSchedule(reason, maxAgeSec: 0) }
    }

    // MARK: watch request

    /// Runs on the session's executor: must not block, so the work moves to a task.
    private func onWatchMessage(_ handle: LinkHandle, _ packet: HuaweiPacket) {
        let code = (try? packet.tlv?.int(0x7F)) ?? -1
        Task { [self] in
            await runExpiring("JoyoFit weather request") { await self.answerWatch(handle, code: code) }
        }
    }

    private func answerWatch(_ handle: LinkHandle, code: Int32) async {
        let sender = HuaweiWeatherSender(session: handle.session, caps: handle.caps, log: events.sink)
        do {
            if code != WeatherController.watchRequestCode {
                info("Weather: watch message " + String(format: "0x%08x", UInt32(bitPattern: code)) + ", acknowledged")
                try await sender.acknowledge()
                return
            }
            info("Weather: the watch asked for weather")
            if !settings.enabled {
                info("Weather: switch is off, telling the watch")
                _ = try await sender.sendError(.weatherDisabled)
                return
            }
            do {
                try await pushAndSchedule("watch request", maxAgeSec: WeatherController.requestMaxAgeSec)
            } catch let e as WearError {
                if let watchError = WeatherErrorCodes.watchError(e.code) { _ = try await sender.sendError(watchError) }
            }
        } catch is CancellationError {
            return
        } catch {
            fail("Weather: answering the watch failed: \((error as? WearError)?.message ?? "\(error)")")
        }
    }

    // MARK: fetch and push

    /// One push, then the next timer: an interval away, or `retryMs` when the network failed. Errors are logged and kept in the status; they also
    /// reach the caller (the watch request, `refreshWeather`).
    @discardableResult
    func pushAndSchedule(_ reason: String, maxAgeSec: Int64) async throws -> Bool {
        var delay = intervalMs()
        var failure: WearError?
        var pushed = false
        do {
            pushed = try await push(reason, maxAgeSec: maxAgeSec)
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as WearError {
            failure = e
        } catch {
            // Anything unexpected must not escape as something other than a coded error.
            let e = WearError(.weatherNetwork, "Could not get the weather: \(error)", underlying: error)
            lock.locked { lastError = e.message }
            failure = e
        }
        if let failure {
            fail("Weather (\(reason)) failed [\(failure.code.rawValue)]: \(failure.message)")
            if failure.code == .weatherNetwork { delay = min(delay, WeatherController.retryMs) }
        }
        scheduleNext(delay)
        if let failure { throw failure }
        return pushed
    }

    /// Fetches (or reuses a report younger than `maxAgeSec`) and sends it. Returns false when another push was already running. Throws a `WearError`:
    /// NOT_CONNECTED, UNSUPPORTED, a weather code, or the protocol error of the failed request.
    @discardableResult
    func push(_ reason: String, maxAgeSec: Int64) async throws -> Bool {
        guard let handle = link.handle() else { throw WearError(.notConnected, "Not connected to a watch") }
        let sender = HuaweiWeatherSender(session: handle.session, caps: handle.caps, log: events.sink)
        guard sender.supported() else { throw WearError(.unsupported, "The watch does not support weather") }
        guard settings.enabled else { throw WearError(.weatherDisabled, "Weather is switched off") }
        let acquired: Bool = lock.locked {
            if pushing { return false }
            pushing = true
            return true
        }
        guard acquired else {
            info("Weather (\(reason)): a push is already running, skipped")
            return false
        }
        defer { lock.locked { pushing = false } }

        let report: WeatherReport
        do {
            report = try await loadReport(maxAgeSec: maxAgeSec)
        } catch let e as WearError {
            lock.locked { lastError = e.message }
            throw e
        }
        let at = nowSec()
        do {
            try await sender.send(report: report, unit: settings.unit, nowSec: at, zone: zone())
        } catch let e as WearError {
            lock.locked { lastError = e.message }
            throw e
        }
        lock.locked {
            lastPushAtSec = nowSec()
            lastError = nil
            lastTempC = Int(WeatherPackets.temperatureByte(report.tempC))
            lastCondition = WeatherIcons.forWmo(report.code).name
            lastPlaceName = report.place.name
        }
        info("Weather (\(reason)): pushed")
        return true
    }

    private func cacheKeyOf() -> String {
        switch settings.locationMode {
        case .city:
            let city = settings.city
            return "city:\(city.map { "\($0.latitude)" } ?? "nil"),\(city.map { "\($0.longitude)" } ?? "nil")"
        case .current: return "current"
        }
    }

    private func loadReport(maxAgeSec: Int64) async throws -> WeatherReport {
        let at = nowSec()
        let key = cacheKeyOf()
        if let hit: WeatherReport = lock.locked({ cache.flatMap { cacheKey == key && at - $0.fetchedAtSec <= maxAgeSec ? $0 : nil } }) { return hit }

        let place: WeatherPlace
        switch settings.locationMode {
        case .city:
            guard let city = settings.city else { throw WearError(.weatherLocation, "No city chosen for the weather") }
            place = city
        case .current:
            do {
                place = try await location.current()
            } catch let e as WeatherLocationError {
                throw WearError(.weatherLocation, e.message, underlying: e)
            }
        }
        info("Weather: fetching Open-Meteo for \(place.name ?? "an unnamed place") (\(String(format: "%.2f, %.2f", place.latitude, place.longitude)))")
        let report: WeatherReport
        do {
            report = try await OpenMeteo.fetchForecast(place: place, nowSec: at, fetch: fetch)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw WearError(.weatherNetwork, "Could not get the weather: \(describe(error))", underlying: error)
        }
        lock.locked {
            cache = report
            cacheKey = key
        }
        return report
    }

    private func describe(_ error: Error) -> String {
        if let bad = error as? OpenMeteoBadResponse { return bad.message }
        return (error as NSError).localizedDescription
    }

    /// `refreshWeather()` from JS: a fresh fetch and push now; throws what went wrong.
    public func refreshNow() async throws -> [String: Any] {
        try await pushAndSchedule("app", maxAgeSec: 0)
        return status()
    }

    /// Geocodes `query` and stores the first match as the chosen city.
    public func setCity(_ query: String) async throws -> WeatherPlace {
        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw WearError(.invalidArgument, "Enter a city name") }
        let places: [WeatherPlace]
        do {
            places = try await OpenMeteo.searchCity(query, fetch: fetch)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw WearError(.weatherNetwork, "Could not search for the city: \(describe(error))", underlying: error)
        }
        guard let place = places.first else {
            throw WearError(.invalidArgument, "No city found for \"\(query.trimmingCharacters(in: .whitespacesAndNewlines))\"")
        }
        settings.city = place
        info("Weather: city set to \(place.name ?? "?") (\(place.detail ?? "no region")) \(String(format: "%.2f, %.2f", place.latitude, place.longitude))")
        onSettingsChanged()
        return place
    }

    // MARK: settings from JS; each validates, stores, and acts on a connected watch

    /// Switching on in "this phone" mode asks for the location permission first (the system prompt, once): Android's JS asks before calling.
    public func setEnabled(_ enabled: Bool) async {
        if enabled && settings.locationMode == .current { _ = await location.requestAuthorization() }
        settings.enabled = enabled
        info("Weather: switch \(enabled ? "on" : "off")")
        onSettingsChanged()
    }

    public func setUnit(_ wire: String) throws {
        guard let unit = TemperatureUnit(wire: wire) else {
            throw WearError(.invalidArgument, "Temperature unit must be celsius or fahrenheit, got '\(wire)'")
        }
        settings.unit = unit
        onSettingsChanged()
    }

    /// Choosing "this phone" asks for the location permission (the system prompt, once).
    public func setLocationMode(_ wire: String) async throws {
        guard let mode = WeatherLocationMode(wire: wire) else {
            throw WearError(.invalidArgument, "Location mode must be current or city, got '\(wire)'")
        }
        if mode == .current { _ = await location.requestAuthorization() }
        settings.locationMode = mode
        onSettingsChanged()
    }

    public func setIntervalMinutes(_ minutes: Int) throws {
        if minutes < WeatherSettings.minIntervalMin || minutes > WeatherSettings.maxIntervalMin {
            throw WearError(
                .invalidArgument, "Weather interval must be \(WeatherSettings.minIntervalMin) to \(WeatherSettings.maxIntervalMin) minutes, got \(minutes)"
            )
        }
        settings.intervalMinutes = minutes
        onIntervalChanged()
    }

    /// `WeatherStatus` in HuaweiWear.types.ts.
    public func status() -> [String: Any] {
        let handle = link.handle()
        let snapshot = lock.locked { (lastPushAtSec, lastError, lastTempC, lastCondition, lastPlaceName) }
        return [
            "enabled": settings.enabled,
            "unit": settings.unit.wire,
            "locationMode": settings.locationMode.wire,
            "intervalMinutes": settings.intervalMinutes,
            "city": orNull(settings.city?.toJS()),
            "locationPermission": location.hasPermission(),
            "watchSupported": orNull(handle.map { HuaweiWeatherSender.supported($0.caps) }),
            "lastPushAt": orNull(snapshot.0),
            "lastError": orNull(snapshot.1),
            "lastTemperatureC": orNull(snapshot.2),
            "lastCondition": orNull(snapshot.3),
            "lastLocationName": orNull(snapshot.4),
        ]
    }

    private func orNull<T>(_ value: T?) -> Any { value.map { $0 as Any } ?? NSNull() }

    // MARK: timer

    private func scheduleNext(_ delayMs: Int) {
        guard settings.enabled, link.handle() != nil else { return }
        let due = nowSec() + Int64((delayMs + 999) / 1000)
        let (generation, previous): (Int, Task<Void, Never>?) = lock.locked {
            timerGeneration += 1
            nextDueAtSec = due
            return (timerGeneration, timer)
        }
        previous?.cancel()
        let task = Task { [self] in
            do { try await sleep(delayMs) } catch { return }
            guard lock.locked({ timerGeneration == generation }) else { return }
            await tick()
        }
        lock.locked { if timerGeneration == generation { timer = task } else { task.cancel() } }
    }

    private func tick() async {
        if link.handle() == nil || !settings.enabled {
            stopTicker()
            return
        }
        await runExpiring("JoyoFit weather") { _ = try? await self.pushAndSchedule("interval", maxAgeSec: 0) }
    }

    private func stopTicker() {
        let previous: Task<Void, Never>? = lock.locked {
            timerGeneration += 1
            nextDueAtSec = nil
            let t = timer
            timer = nil
            return t
        }
        previous?.cancel()
    }
}

#endif

// The phone's coarse position for the weather in "this phone" mode. Port of WeatherLocation.kt over a `LocationSource` (CoreLocation on a phone,
// a fake in the logic tests):
//
// 1. The newest last-known fix, if it is under `freshSec` old.
// 2. Otherwise one fresh fix (waits up to `fixTimeoutMs`).
// 3. Otherwise the stale last-known fix, then the position stored by the previous successful call.
//
// iOS gives an app that is not in the foreground no location with when-in-use authorization, so a background wake (the watch asking for weather)
// usually answers from steps 1 and 3.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

/// No usable position: `permissionMissing` tells "not allowed" from "the phone has none".
public struct WeatherLocationError: Error, CustomStringConvertible, Sendable {
    public let message: String
    public let permissionMissing: Bool
    public init(_ message: String, permissionMissing: Bool) {
        self.message = message
        self.permissionMissing = permissionMissing
    }

    public var description: String { message }
}

public struct LocationFix: Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double
    /// When the system took the fix, unix seconds.
    public var timeSec: Int64

    public init(latitude: Double, longitude: Double, timeSec: Int64) {
        self.latitude = latitude
        self.longitude = longitude
        self.timeSec = timeSec
    }
}

public enum LocationAuthorization: Sendable, Equatable {
    /// The user was never asked.
    case notDetermined
    /// Denied, or restricted by a profile or parental controls: asking again does nothing.
    case denied
    /// When-in-use or always.
    case granted
}

/// What the position needs from the platform.
public protocol LocationSource: AnyObject, Sendable {
    var authorization: LocationAuthorization { get }
    /// Shows the system prompt when the user was never asked and returns the answer; returns at once otherwise.
    func requestAuthorization() async -> LocationAuthorization
    /// The system's newest cached fix, without asking for a new one.
    func lastKnown() async -> LocationFix?
    /// One new coarse fix; nil when none can be had. Must return promptly when its task is cancelled.
    func currentFix() async -> LocationFix?
    /// The name of a place ("Bandung"): locality, else sub-administrative area, else administrative area; nil when it cannot be told.
    func placeName(latitude: Double, longitude: Double) async -> String?
}

/// A platform without location (the Linux logic tests, a build without CoreLocation): never granted.
public final class UnavailableLocationSource: LocationSource, @unchecked Sendable {
    public init() {}
    public var authorization: LocationAuthorization { .denied }
    public func requestAuthorization() async -> LocationAuthorization { .denied }
    public func lastKnown() async -> LocationFix? { nil }
    public func currentFix() async -> LocationFix? { nil }
    public func placeName(latitude: Double, longitude: Double) async -> String? { nil }
}

/// Runs `operation`, giving up with nil after `ms`; the operation is cancelled when the time is up.
func withTimeoutOrNil<T: Sendable>(ms: Int, _ operation: @escaping @Sendable () async -> T?) async -> T? {
    await withTaskGroup(of: T?.self) { group in
        group.addTask { await operation() }
        group.addTask {
            try? await Task.sleep(nanoseconds: UInt64(max(ms, 0)) * 1_000_000)
            return nil
        }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
    }
}

public final class WeatherLocation: @unchecked Sendable {
    /// A last-known fix younger than this is used as is.
    public static let freshSec: Int64 = 60 * 60
    public static let fixTimeoutMs = 15_000
    static let geocodeTimeoutMs = 5_000
    /// Moving less than this keeps the stored place name.
    static let reuseNameKm = 5.0

    private let source: LocationSource
    private let settings: WeatherSettings
    private let log: @Sendable (String) -> Void
    private let now: @Sendable () -> Date
    private let fixTimeoutMs: Int

    public init(
        source: LocationSource, settings: WeatherSettings, fixTimeoutMs: Int = WeatherLocation.fixTimeoutMs, now: @escaping @Sendable () -> Date = { Date() },
        log: @escaping @Sendable (String) -> Void
    ) {
        self.source = source
        self.settings = settings
        self.fixTimeoutMs = fixTimeoutMs
        self.now = now
        self.log = log
    }

    public var authorization: LocationAuthorization { source.authorization }
    public func hasPermission() -> Bool { source.authorization == .granted }
    public func requestAuthorization() async -> LocationAuthorization { await source.requestAuthorization() }

    public func current() async throws -> WeatherPlace {
        guard hasPermission() else { throw WeatherLocationError("Location permission is not granted", permissionMissing: true) }
        let lastKnown = await source.lastKnown()
        var fix = lastKnown
        if lastKnown == nil || Int64(now().timeIntervalSince1970) - lastKnown!.timeSec > WeatherLocation.freshSec {
            let source = self.source
            if let fresh = await withTimeoutOrNil(ms: fixTimeoutMs, { await source.currentFix() }) {
                fix = fresh
            } else {
                log("Weather: no fresh location fix, using \(lastKnown != nil ? "the last known one" : "the stored position")")
            }
        }
        guard let fix else {
            guard let stored = settings.lastFix else {
                throw WeatherLocationError("No location is available yet; open the app with location on, or choose a city", permissionMissing: false)
            }
            return stored
        }
        return await place(fix)
    }

    /// Names the fix, reusing the stored name when the phone barely moved, and stores it.
    private func place(_ fix: LocationFix) async -> WeatherPlace {
        let previous = settings.lastFix
        let name: String?
        if let previous, previous.name != nil,
            WeatherLocation.distanceKm(previous.latitude, previous.longitude, fix.latitude, fix.longitude) < WeatherLocation.reuseNameKm {
            name = previous.name
        } else {
            let source = self.source
            name = await withTimeoutOrNil(ms: WeatherLocation.geocodeTimeoutMs) { await source.placeName(latitude: fix.latitude, longitude: fix.longitude) }
        }
        let place = WeatherPlace(name: name, latitude: fix.latitude, longitude: fix.longitude)
        settings.lastFix = place
        return place
    }

    /// Great-circle distance (haversine); the 5 km threshold does not need an ellipsoid.
    public static func distanceKm(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = 6371.0088
        let p1 = lat1 * .pi / 180
        let p2 = lat2 * .pi / 180
        let dp = (lat2 - lat1) * .pi / 180
        let dl = (lon2 - lon1) * .pi / 180
        let a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * r * asin(min(1, sqrt(a)))
    }
}

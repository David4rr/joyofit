// The weather feature's user settings. Port of WeatherSettings.kt: they live in the same defaults suite as `WearSettings` (`joyofit_settings`) under
// `weather_` keys, so the module, the background wake and the watch-request handler all read the same values. Foundation only (Linux logic tests).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public final class WeatherSettings: @unchecked Sendable {
    public static let defaultIntervalMin = 60
    public static let minIntervalMin = 15
    public static let maxIntervalMin = 1440

    private static let suiteName = "joyofit_settings"
    private let defaults: UserDefaults

    private enum Key {
        static let enabled = "weather_enabled"
        static let unit = "weather_unit"
        static let mode = "weather_location_mode"
        static let interval = "weather_interval_min"
        static let cityLat = "weather_city_lat"
        static let cityLon = "weather_city_lon"
        static let cityName = "weather_city_name"
        static let cityDetail = "weather_city_detail"
        static let fixLat = "weather_fix_lat"
        static let fixLon = "weather_fix_lon"
        static let fixName = "weather_fix_name"
    }

    public init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? UserDefaults(suiteName: WeatherSettings.suiteName) ?? .standard
    }

    /// Off until the user switches it on: it needs the internet and the phone's location.
    public var enabled: Bool {
        get { defaults.bool(forKey: Key.enabled) }
        set { defaults.set(newValue, forKey: Key.enabled) }
    }

    public var unit: TemperatureUnit {
        get { TemperatureUnit(wire: defaults.string(forKey: Key.unit) ?? "") ?? .celsius }
        set { defaults.set(newValue.wire, forKey: Key.unit) }
    }

    public var locationMode: WeatherLocationMode {
        get { WeatherLocationMode(wire: defaults.string(forKey: Key.mode) ?? "") ?? .current }
        set { defaults.set(newValue.wire, forKey: Key.mode) }
    }

    public var intervalMinutes: Int {
        get { defaults.object(forKey: Key.interval) == nil ? WeatherSettings.defaultIntervalMin : defaults.integer(forKey: Key.interval) }
        set { defaults.set(newValue, forKey: Key.interval) }
    }

    /// The city chosen for `WeatherLocationMode.city`.
    public var city: WeatherPlace? {
        get { read(Key.cityLat, Key.cityLon, Key.cityName, Key.cityDetail) }
        set { write(newValue, Key.cityLat, Key.cityLon, Key.cityName, Key.cityDetail) }
    }

    /// The last position the phone gave for `WeatherLocationMode.current`. Used when no fresh fix can be had (iOS gives a suspended or background
    /// app no location updates with when-in-use authorization).
    public var lastFix: WeatherPlace? {
        get { read(Key.fixLat, Key.fixLon, Key.fixName, nil) }
        set { write(newValue, Key.fixLat, Key.fixLon, Key.fixName, nil) }
    }

    private func read(_ latKey: String, _ lonKey: String, _ nameKey: String, _ detailKey: String?) -> WeatherPlace? {
        guard defaults.object(forKey: latKey) != nil, defaults.object(forKey: lonKey) != nil else { return nil }
        return WeatherPlace(
            name: defaults.string(forKey: nameKey), latitude: defaults.double(forKey: latKey), longitude: defaults.double(forKey: lonKey),
            detail: detailKey.flatMap { defaults.string(forKey: $0) }
        )
    }

    private func write(_ place: WeatherPlace?, _ latKey: String, _ lonKey: String, _ nameKey: String, _ detailKey: String?) {
        guard let place else {
            for key in [latKey, lonKey, nameKey] + (detailKey.map { [$0] } ?? []) { defaults.removeObject(forKey: key) }
            return
        }
        defaults.set(place.latitude, forKey: latKey)
        defaults.set(place.longitude, forKey: lonKey)
        if let name = place.name { defaults.set(name, forKey: nameKey) } else { defaults.removeObject(forKey: nameKey) }
        if let detailKey {
            if let detail = place.detail { defaults.set(detail, forKey: detailKey) } else { defaults.removeObject(forKey: detailKey) }
        }
    }
}

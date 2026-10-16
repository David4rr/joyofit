// Everything the user configures that must survive without JS running: the remembered watch, background mode and its sync interval,
// and the profile/goal. Port of WearSettings.kt; UserDefaults (suite `joyofit_settings`) replaces the private SharedPreferences file.
// Pure logic (Foundation only), so the logic tests run it on Linux.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public final class WearSettings: @unchecked Sendable {
    public static let defaultSyncIntervalMin = 30
    public static let minSyncIntervalMin = 5
    public static let maxSyncIntervalMin = 1440

    private static let suiteName = "joyofit_settings"
    private let defaults: UserDefaults

    private enum Key {
        static let address = "watch_address"
        static let name = "watch_name"
        static let background = "background_enabled"
        static let interval = "sync_interval_min"
        static let profileHeight = "profile_height_cm"
        static let profileWeight = "profile_weight_kg"
        static let profileBirthYear = "profile_birth_year"
        static let profileSex = "profile_sex"
        static let profileGoal = "profile_step_goal"
        static let alarmsJson = "alarms_json"
    }

    public init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? UserDefaults(suiteName: WearSettings.suiteName) ?? .standard
    }

    /// The watch last connected from the app or enabled for background: the CoreBluetooth peripheral identifier (upper case UUID string),
    /// the iOS counterpart of Android's upper case MAC.
    public var watchAddress: String? {
        get { defaults.string(forKey: Key.address) }
        set { set(newValue, forKey: Key.address) }
    }

    /// The Bluetooth name the watch advertised (`HUAWEI WATCH FIT 4 Pro-40A`); the scan matches it by stem when the identifier is unknown.
    public var watchName: String? {
        get { defaults.string(forKey: Key.name) }
        set { set(newValue, forKey: Key.name) }
    }

    public var backgroundEnabled: Bool {
        get { defaults.bool(forKey: Key.background) }
        set { defaults.set(newValue, forKey: Key.background) }
    }

    public var syncIntervalMinutes: Int {
        get { defaults.object(forKey: Key.interval) == nil ? WearSettings.defaultSyncIntervalMin : defaults.integer(forKey: Key.interval) }
        set { defaults.set(newValue, forKey: Key.interval) }
    }

    /// Profile and goal as the JS Settings screen stores them; nil until the user saves one.
    public var profile: UserProfileData? {
        get {
            guard defaults.object(forKey: Key.profileHeight) != nil else { return nil }
            return UserProfileData(
                heightCm: defaults.integer(forKey: Key.profileHeight),
                weightKg: defaults.double(forKey: Key.profileWeight),
                birthYear: defaults.integer(forKey: Key.profileBirthYear),
                sex: defaults.string(forKey: Key.profileSex) ?? "unknown",
                dailyStepGoal: defaults.integer(forKey: Key.profileGoal)
            )
        }
        set {
            if let p = newValue {
                defaults.set(p.heightCm, forKey: Key.profileHeight)
                defaults.set(p.weightKg, forKey: Key.profileWeight)
                defaults.set(p.birthYear, forKey: Key.profileBirthYear)
                defaults.set(p.sex, forKey: Key.profileSex)
                defaults.set(p.dailyStepGoal, forKey: Key.profileGoal)
            } else {
                for key in [Key.profileHeight, Key.profileWeight, Key.profileBirthYear, Key.profileSex, Key.profileGoal] {
                    defaults.removeObject(forKey: key)
                }
            }
        }
    }

    /// The alarms last read from or pushed to the watch as `WatchAlarms.toJson` (Android `alarmsJson`); nil before the first exchange.
    public var alarmsJson: String? {
        get { defaults.string(forKey: Key.alarmsJson) }
        set { set(newValue, forKey: Key.alarmsJson) }
    }

    private func set(_ value: String?, forKey key: String) {
        if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
    }
}

extension UserProfileData {
    /// `UserProfile` in HuaweiWear.types.ts.
    public func toJS() -> [String: Any] {
        [
            "heightCm": heightCm,
            "weightKg": weightKg,
            "birthYear": birthYear,
            "sex": sex,
            "dailyStepGoal": dailyStepGoal,
        ]
    }

    /// `WearRuntime.validate(UserProfileData)`: the ranges the Settings screen enforces. `thisYear` is injected for tests.
    public func validationError(thisYear: Int) -> String? {
        if !(100...250).contains(heightCm) { return "Height must be 100 to 250 cm" }
        if !(weightKg >= 20.0 && weightKg <= 300.0) { return "Weight must be 20 to 300 kg" }
        if !(1900...thisYear).contains(birthYear) { return "Birth year must be 1900 to \(thisYear)" }
        if sex != "male" && sex != "female" && sex != "unknown" { return "Sex must be male, female or unknown" }
        if !(1000...100_000).contains(dailyStepGoal) { return "Step goal must be 1000 to 100000" }
        return nil
    }
}

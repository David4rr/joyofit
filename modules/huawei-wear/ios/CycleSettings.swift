// The menstrual calendar's user settings, the cycle part of WatchExtrasSettings.kt. Same defaults suite as `WeatherSettings` (`joyofit_settings`)
// under `cycle_` keys. Foundation only (Linux logic tests).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public final class CycleSettings: @unchecked Sendable {
    private static let suiteName = "joyofit_settings"
    private let defaults: UserDefaults

    private enum Key {
        static let enabled = "cycle_enabled"
        static let switches = "cycle_switches"
    }

    public init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? UserDefaults(suiteName: CycleSettings.suiteName) ?? .standard
    }

    /// The menstrual calendar on the watch. Off by default.
    public var enabled: Bool {
        get { defaults.bool(forKey: Key.enabled) }
        set { defaults.set(newValue, forKey: Key.enabled) }
    }

    /// The reminder switches (`Switches.bitfield`), master off by default.
    public var switches: MenstrualCodec.Switches {
        get {
            let stored = defaults.object(forKey: Key.switches) as? Int ?? MenstrualCodec.Switches().bitfield(includeEasyPregnancy: true)
            return MenstrualCodec.Switches(bitfield: stored)
        }
        set { defaults.set(newValue.bitfield(includeEasyPregnancy: true), forKey: Key.switches) }
    }
}

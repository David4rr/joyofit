// The "inert" answers of the native API features that have no iOS counterpart or whose protocol layer is not ported yet: the exact shapes of
// HuaweiWear*.types.ts with every capability off, so JS never meets an undefined function or a missing field. Nothing here claims that
// anything reached the watch. Pure logic (Foundation only); the logic tests also dump these for a TypeScript type-check against the
// real `.types.ts` files.
import Foundation

public enum Inert {
    /// What every unsupported command says (code `ERR_UNSUPPORTED`).
    public static let unavailable = "not available on iOS yet"

    public static func message(_ what: String) -> String { "\(what): \(unavailable)" }

    /// `PhoneFeatures`: find my phone, calls and call control are all off, and no Android permission applies.
    public static func phoneFeatures() -> [String: Any] {
        [
            "findPhoneEnabled": false,
            "callsEnabled": false,
            "callControlEnabled": false,
            "readPhoneState": false,
            "readCallLog": false,
            "readContacts": false,
            "callerIdSupported": false,
            "answerPhoneCalls": false,
            "findWatchSupported": false,
        ]
    }

    /// `NotificationAccessStatus`: iOS has no notification listener for third-party apps.
    public static func notificationAccess() -> [String: Any] { ["granted": false, "enabled": false] }

    /// `WatchAlarms`: nothing read from or pushed to the watch.
    public static func alarms() -> [String: Any] {
        [
            "event": [Any](),
            "smart": NSNull(),
            "updatedAt": NSNull(),
            "supported": false,
            "smartSupported": false,
        ]
    }

    /// `HealthSensorsStatus`: switches off, `supported` null (nothing is known about the watch).
    public static func healthSensors() -> [String: Any] {
        [
            "automaticHeartRate": false,
            "automaticSpo2": false,
            "truSleep": false,
            "highHeartRateAlert": 0,
            "lowHeartRateAlert": 0,
            "supported": NSNull(),
        ]
    }

    /// `StressStatus`.
    public static func stress() -> [String: Any] { ["enabled": false, "lastCalibratedAt": NSNull(), "supported": false] }

    /// `WeatherStatus`: off, nothing pushed.
    public static func weather() -> [String: Any] {
        [
            "enabled": false,
            "unit": "celsius",
            "locationMode": "current",
            "intervalMinutes": 60,
            "city": NSNull(),
            "locationPermission": false,
            "watchSupported": NSNull(),
            "lastPushAt": NSNull(),
            "lastError": NSNull(),
            "lastTemperatureC": NSNull(),
            "lastCondition": NSNull(),
            "lastLocationName": NSNull(),
        ]
    }

    /// `SafetyStatus`: no fall detection, no SOS relay (iOS apps cannot send SMS), the sleep report off.
    public static func safety() -> [String: Any] {
        [
            "fallSupported": false,
            "fallNote": "Fall detection is \(unavailable)",
            "fallSwitch": -1,
            "fallUpdatedMs": 0,
            "sosRelayEnabled": false,
            "smsSupported": false,
            "smsPermission": false,
            "telephony": false,
            "simReady": false,
            "sosReady": false,
            "sosBlockers": [sosBlocker],
            "sosListedByWatch": false,
            "sleepReportEnabled": false,
            "sleepReportSupported": false,
        ]
    }

    public static let sosBlocker = "The SOS text message relay is \(unavailable)"

    /// `SosRelayTest`: what an SOS request would do; sends nothing, to nobody.
    public static func sosRelayTest() -> [String: Any] { ["ready": false, "blockers": [sosBlocker]] }

    /// `CycleOverview`: an empty log with the cycle calendar off. `today` is the local `YYYY-MM-DD`; the averages are the Android defaults.
    public static func cycle(today: String, watchConnected: Bool) -> [String: Any] {
        [
            "today": today,
            "enabled": false,
            "periods": [Any](),
            "days": [Any](),
            "predictions": [Any](),
            "averageCycleDays": 28,
            "averagePeriodDays": 5,
            "periodOngoing": false,
            "daysLate": 0,
            "switches": [
                "master": false, "periodStart": false, "periodEnd": false, "fertileStart": false, "fertileEnd": false, "easyPregnancy": false,
            ] as [String: Any],
            "watchConnected": watchConnected,
            "watchSupported": false,
            "watchNote": "The cycle calendar is \(unavailable)",
            "easyPregnancySwitch": false,
        ]
    }

    /// `DietStatus`: nothing stored, nothing pushed, no watch-logged meals.
    public static func diet() -> [String: Any] {
        [
            "date": NSNull(),
            "mealCount": NSNull(),
            "intakeKcal": NSNull(),
            "goals": NSNull(),
            "updatedAt": NSNull(),
            "pushedAt": NSNull(),
            "lastResult": NSNull(),
            "unsyncedWatchMeals": 0,
            "pendingWatchMeals": [Any](),
            "supported": NSNull(),
        ]
    }

    /// `BodyMetrics`: nothing stored.
    public static func bodyMetrics() -> [String: Any] {
        [
            "weightKg": NSNull(), "weightTs": NSNull(), "bodyFatPct": NSNull(), "bodyFatTs": NSNull(),
            "restingKcal": NSNull(), "systolic": NSNull(), "diastolic": NSNull(), "bpTs": NSNull(),
        ]
    }

    /// `ActivityGoalsStatus`: Huawei Health's defaults (the steps goal is the profile's daily goal when one is saved), nothing sent.
    public static func activityGoals(dailyStepGoal: Int?) -> [String: Any] {
        [
            "steps": dailyStepGoal ?? 10_000,
            "calories": 300,
            "exerciseMinutes": 30,
            "standHours": 12,
            "remindStand": true,
            "remindProgress": true,
            "remindGoalReached": true,
            "configSupported": NSNull(),
            "lastSentAt": NSNull(),
        ]
    }

    /// `HealthyLivingStatus`: off.
    public static func healthyLiving() -> [String: Any] {
        [
            "supported": false,
            "gate": "ExpandCapability 37",
            "gateSet": false,
            "enabled": false,
            "registered": false,
            "pingCode": NSNull(),
            "msgVer": NSNull(),
            "packageSize": 0,
            "lastRequestAt": NSNull(),
            "lastReportAt": NSNull(),
            "lastReport": NSNull(),
        ]
    }

    /// `CoursesStatus`: off, no gate seen.
    public static func courses() -> [String: Any] {
        ["enabled": false, "gate41": false, "gate169": false, "gate295": false, "p2p": false]
    }

    /// Local calendar day, `YYYY-MM-DD`.
    public static func today(now: Date = Date(), calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

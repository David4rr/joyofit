import XCTest
@testable import HuaweiWearLogic

/// The inert answers keep the exact field names of HuaweiWear*.types.ts. `inert-shapes.check.ts` (run by `scripts/check-inert-shapes.sh`)
/// type-checks the JSON this test dumps against the real TypeScript types.
final class InertStatusTests: XCTestCase {
    private func keys(_ d: [String: Any]) -> Set<String> { Set(d.keys) }

    func testPhoneFeaturesAllOff() {
        let f = Inert.phoneFeatures()
        XCTAssertEqual(keys(f), ["findPhoneEnabled", "callsEnabled", "callControlEnabled", "readPhoneState", "readCallLog", "readContacts", "callerIdSupported", "answerPhoneCalls", "findWatchSupported"])
        XCTAssertTrue(f.values.allSatisfy { ($0 as? Bool) == false })
    }

    func testNotificationAccessIsNotGrantedAndNotEnabled() {
        XCTAssertEqual(Inert.notificationAccess() as NSDictionary, ["granted": false, "enabled": false] as NSDictionary)
    }

    func testAlarmsAreEmptyAndUnsupported() {
        let a = Inert.alarms()
        XCTAssertEqual(keys(a), ["event", "smart", "updatedAt", "supported", "smartSupported"])
        XCTAssertEqual((a["event"] as? [Any])?.count, 0)
        XCTAssertTrue(a["smart"] is NSNull)
        XCTAssertTrue(a["updatedAt"] is NSNull)
        XCTAssertEqual(a["supported"] as? Bool, false)
    }

    func testStatusObjectsHaveTheirTypeScriptFields() {
        XCTAssertEqual(keys(Inert.healthSensors()), ["automaticHeartRate", "automaticSpo2", "truSleep", "highHeartRateAlert", "lowHeartRateAlert", "supported"])
        XCTAssertTrue(Inert.healthSensors()["supported"] is NSNull)
        XCTAssertEqual(keys(Inert.stress()), ["enabled", "lastCalibratedAt", "supported"])
        XCTAssertEqual(
            keys(Inert.weather()),
            ["enabled", "unit", "locationMode", "intervalMinutes", "city", "locationPermission", "watchSupported", "lastPushAt", "lastError", "lastTemperatureC", "lastCondition", "lastLocationName"]
        )
        XCTAssertEqual(Inert.weather()["enabled"] as? Bool, false)
        XCTAssertEqual(
            keys(Inert.safety()),
            ["fallSupported", "fallNote", "fallSwitch", "fallUpdatedMs", "sosRelayEnabled", "smsSupported", "smsPermission", "telephony", "simReady", "sosReady", "sosBlockers", "sosListedByWatch", "sleepReportEnabled", "sleepReportSupported"]
        )
        XCTAssertEqual(Inert.safety()["fallSwitch"] as? Int, -1)
        XCTAssertEqual(keys(Inert.sosRelayTest()), ["ready", "blockers"])
        XCTAssertEqual(Inert.sosRelayTest()["ready"] as? Bool, false)
        XCTAssertEqual((Inert.sosRelayTest()["blockers"] as? [String])?.count, 1)
        XCTAssertEqual(
            keys(Inert.cycle(today: "2026-10-16", watchConnected: false)),
            ["today", "enabled", "periods", "days", "predictions", "averageCycleDays", "averagePeriodDays", "periodOngoing", "daysLate", "switches", "watchConnected", "watchSupported", "watchNote", "easyPregnancySwitch"]
        )
        XCTAssertEqual(keys(Inert.cycle(today: "x", watchConnected: true)["switches"] as! [String: Any]), ["master", "periodStart", "periodEnd", "fertileStart", "fertileEnd", "easyPregnancy"])
        XCTAssertEqual(keys(Inert.diet()), ["date", "mealCount", "intakeKcal", "goals", "updatedAt", "pushedAt", "lastResult", "unsyncedWatchMeals", "pendingWatchMeals", "supported"])
        XCTAssertEqual(keys(Inert.bodyMetrics()), ["weightKg", "weightTs", "bodyFatPct", "bodyFatTs", "restingKcal", "systolic", "diastolic", "bpTs"])
        XCTAssertEqual(keys(Inert.healthyLiving()), ["supported", "gate", "gateSet", "enabled", "registered", "pingCode", "msgVer", "packageSize", "lastRequestAt", "lastReportAt", "lastReport"])
        XCTAssertEqual(keys(Inert.courses()), ["enabled", "gate41", "gate169", "gate295", "p2p"])
    }

    func testActivityGoalsDefaultsFollowTheProfileGoal() {
        XCTAssertEqual(Inert.activityGoals(dailyStepGoal: nil)["steps"] as? Int, 10_000)
        XCTAssertEqual(Inert.activityGoals(dailyStepGoal: 7_500)["steps"] as? Int, 7_500)
        XCTAssertEqual(
            keys(Inert.activityGoals(dailyStepGoal: nil)),
            ["steps", "calories", "exerciseMinutes", "standHours", "remindStand", "remindProgress", "remindGoalReached", "configSupported", "lastSentAt"]
        )
        XCTAssertTrue(Inert.activityGoals(dailyStepGoal: nil)["configSupported"] is NSNull)
    }

    func testTodayIsALocalIsoDay() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 7 * 3600)!
        XCTAssertEqual(Inert.today(now: Date(timeIntervalSince1970: 1_700_000_000), calendar: calendar), "2023-11-15")
    }

    func testMessagesSayNotAvailableOnIos() {
        XCTAssertEqual(Inert.message("findWatch"), "findWatch: not available on iOS yet")
    }

    /// Writes every inert shape (and the other plain-Swift JS shapes) for the TypeScript check when INERT_SHAPES_OUT is set.
    func testDumpShapesForTheTypeScriptCheck() throws {
        guard let out = ProcessInfo.processInfo.environment["INERT_SHAPES_OUT"] else { return }
        let info = WatchDeviceInfo(
            address: "6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77", name: "HUAWEI WATCH FIT 4 Pro-40A", productModel: nil, softwareVersion: "6.1", hardwareVersion: nil,
            serialNumber: nil, batteryLevel: 50, authMode: .hichain3, model: "Huawei Watch Fit 4 Pro", support: .tested
        )
        let shapes: [String: Any] = [
            "PhoneFeatures": Inert.phoneFeatures(),
            "NotificationAccessStatus": Inert.notificationAccess(),
            "WatchAlarms": Inert.alarms(),
            "HealthSensorsStatus": Inert.healthSensors(),
            "StressStatus": Inert.stress(),
            "WeatherStatus": Inert.weather(),
            "SafetyStatus": Inert.safety(),
            "SosRelayTest": Inert.sosRelayTest(),
            "CycleOverview": Inert.cycle(today: "2026-10-16", watchConnected: false),
            "DietStatus": Inert.diet(),
            "BodyMetrics": Inert.bodyMetrics(),
            "ActivityGoalsStatus": Inert.activityGoals(dailyStepGoal: nil),
            "HealthyLivingStatus": Inert.healthyLiving(),
            "CoursesStatus": Inert.courses(),
            "DeviceInfo": info.toJS(),
            "BondedDevice": ["address": info.address, "name": info.name].merging(WatchModels.match(info.name).toJS()) { a, _ in a },
            "UserProfile": UserProfileData(heightCm: 170, weightKg: 65.5, birthYear: 1990, sex: "male", dailyStepGoal: 8000).toJS(),
            "SyncSummary": SyncSummary(from: 1, to: 2, samples: 3, sleep: 4, totalSteps: 5, totalCalories: 6, totalDistance: 7).toJS(),
            "HealthConnectExportResult": HealthExportCounts().toJS(),
            "SupportReport": SupportReport.build(
                environment: .init(app: "a", phone: "p"), watchName: nil, device: nil, linkState: "disconnected", log: [], caps: nil, transport: nil
            ),
        ]
        let data = try JSONSerialization.data(withJSONObject: shapes, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: out))
    }
}

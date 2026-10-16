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

    func testStatusObjectsHaveTheirTypeScriptFields() {
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
        let features = WatchSettingsFeatures(
            handle: { nil }, settings: WearSettings(defaults: ephemeralDefaults()), syncStore: SyncStore(url: temporaryDatabaseURL()), events: RecordingEvents()
        )
        let events = RecordingEvents()
        let weather = WeatherController(settings: WeatherSettings(defaults: ephemeralDefaults()), link: FakeLink(events: events), events: events, location: UnavailableLocationSource())
        let runtime = WearRuntime(
            settings: WearSettings(defaults: ephemeralDefaults()), syncStore: SyncStore(url: temporaryDatabaseURL()),
            deviceStore: DeviceStore(secrets: MemorySecretStore()), gate: AlwaysReadyGate(), environment: .init(app: "app 1 (1)", phone: "Apple test"),
            phoneModel: "test", transportFactory: { request, delegate in FakeTransport(.hangConnect, request: request, delegate: delegate) },
            p2pDefaults: ephemeralDefaults()
        )
        let p2p = runtime.p2p!
        let populatedHealthyLiving: [String: Any] = {
            p2p.settings.healthLivingMsgVer = 3.0
            p2p.settings.healthLivingPackageSize = 8192
            p2p.settings.healthLivingLastRequestMs = 1_792_110_700_000
            p2p.settings.healthLivingLastReportMs = 1_792_110_701_000
            p2p.settings.healthLivingLastSummary = "day 20261016: #1=-/23✓"
            return p2p.healthLivingStatus()
        }()
        let populatedWeather: [String: Any] = [
            "enabled": true, "unit": "fahrenheit", "locationMode": "city", "intervalMinutes": 30,
            "city": WeatherPlace(name: "Bandung", latitude: -6.9, longitude: 107.6, detail: "West Java, Indonesia").toJS(),
            "locationPermission": true, "watchSupported": true, "lastPushAt": Int64(1_792_110_700), "lastError": "x", "lastTemperatureC": -3,
            "lastCondition": "LIGHT_RAIN", "lastLocationName": "Bandung",
        ]
        let shapes: [String: Any] = [
            "PhoneFeatures": Inert.phoneFeatures(),
            "NotificationAccessStatus": Inert.notificationAccess(),
            // The live watch settings with nothing connected and nothing stored: the same objects the module returns at launch.
            "WatchAlarms": features.cachedAlarms(),
            "HealthSensorsStatus": features.healthSensorsStatus(),
            "StressStatus": features.stress.status(),
            "HrvReading": HrvReadingData(start: 1, end: 61, rmssd: 42.5, sdnn: 50.1, meanRr: 850.2, beats: 70, heartRate: 71).toJS(),
            "WeatherStatus": weather.status(),
            "WeatherStatus#populated": populatedWeather,
            "SafetyStatus": Inert.safety(),
            "SosRelayTest": Inert.sosRelayTest(),
            "CycleOverview": Inert.cycle(today: "2026-10-16", watchConnected: false),
            "DietStatus": Inert.diet(),
            "BodyMetrics": Inert.bodyMetrics(),
            "ActivityGoalsStatus": Inert.activityGoals(dailyStepGoal: nil),
            // The P2P statuses of the real controller, nothing connected, and with what a watch's request leaves behind.
            "HealthyLivingStatus": p2p.healthLivingStatus(),
            "HealthyLivingStatus#populated": populatedHealthyLiving,
            "CoursesStatus": p2p.coursesStatus(),
            "RunningCoursePushResult": P2pController.pushResultJS(messageId: 12, fileName: "12courseInfo.bin", bytes: 80, uploadStatus: nil, answer: nil),
            "RunningCoursePushResult#answered": P2pController.pushResultJS(messageId: 12, fileName: "12courseInfo.bin", bytes: 80, uploadStatus: 1, answer: [0x01, 0xAB]),
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

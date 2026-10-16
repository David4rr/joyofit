import XCTest
@testable import HuaweiWearLogic

/// The weather feature end to end without Bluetooth, network or location: a real `HuaweiSession` over a scripted watch, canned Open-Meteo answers
/// (recorded from the real API), a fake location source and a clock the test drives. The expectations are those of WeatherController.kt.
final class WeatherControllerTests: XCTestCase {
    /// 2026-10-16 07:31:40 UTC, a hundred seconds after the recorded forecast's observation time.
    private let start: Int64 = 1_792_110_700

    private struct Rig {
        let controller: WeatherController
        let settings: WeatherSettings
        let link: FakeLink
        let events: RecordingEvents
        let clock: ManualClock
        let location: FakeLocation
        let meteo: FakeOpenMeteo
    }

    private func makeRig(
        enabled: Bool = true, mode: WeatherLocationMode = .city, authorization: LocationAuthorization = .granted, connected: Bool = true,
        commands: [Int: Bytes]? = nil
    ) -> Rig {
        let events = RecordingEvents()
        let settings = WeatherSettings(defaults: ephemeralDefaults())
        settings.enabled = enabled
        settings.locationMode = mode
        settings.city = WeatherPlace(name: "Bandung", latitude: -6.92222, longitude: 107.60694, detail: "West Java, Indonesia, ID")
        let link = commands.map { FakeLink(events: events, commands: $0) } ?? FakeLink(events: events)
        link.setConnected(connected)
        let clock = ManualClock(startSec: start)
        let location = FakeLocation(authorization)
        let meteo = FakeOpenMeteo()
        let controller = WeatherController(
            settings: settings, link: link, events: events, location: location, fetch: meteo.fetch, now: { clock.now() },
            zone: { TimeZone(identifier: "Asia/Jakarta")! }, sleep: { try await clock.sleep($0) }
        )
        return Rig(controller: controller, settings: settings, link: link, events: events, clock: clock, location: location, meteo: meteo)
    }

    private func str(_ status: [String: Any], _ key: String) -> String? { status[key] as? String }

    // MARK: status

    func testTheStatusOfAFreshInstallMatchesTheTypeScriptShape() {
        let events = RecordingEvents()
        let controller = WeatherController(
            settings: WeatherSettings(defaults: ephemeralDefaults()), link: FakeLink(events: events), events: events, location: UnavailableLocationSource()
        )
        let status = controller.status()
        XCTAssertEqual(
            Set(status.keys),
            ["enabled", "unit", "locationMode", "intervalMinutes", "city", "locationPermission", "watchSupported", "lastPushAt", "lastError", "lastTemperatureC", "lastCondition", "lastLocationName"]
        )
        XCTAssertEqual(status["enabled"] as? Bool, false)
        XCTAssertEqual(status["unit"] as? String, "celsius")
        XCTAssertEqual(status["locationMode"] as? String, "current")
        XCTAssertEqual(status["intervalMinutes"] as? Int, 60)
        XCTAssertEqual(status["locationPermission"] as? Bool, false)
        for key in ["city", "watchSupported", "lastPushAt", "lastError", "lastTemperatureC", "lastCondition", "lastLocationName"] {
            XCTAssertTrue(status[key] is NSNull, key)
        }
    }

    func testTheStatusSaysWhetherTheConnectedWatchListsWeather() {
        XCTAssertEqual(makeRig().controller.status()["watchSupported"] as? Bool, true)
        XCTAssertEqual(makeRig(commands: [0x0F: [0x02]]).controller.status()["watchSupported"] as? Bool, false)
        XCTAssertTrue(makeRig(connected: false).controller.status()["watchSupported"] is NSNull, "no watch connected")
    }

    // MARK: connect

    func testConnectPushesTheCityWeatherAndTheStatusReportsIt() async throws {
        let rig = makeRig()
        await rig.controller.linkConnected(rig.link.handleValue)

        XCTAssertEqual(rig.link.watch.keys, ["0f/09", "0f/05", "0f/02", "0f/06", "0f/0a", "0f/01", "18/07", "0f/08"])
        XCTAssertEqual(rig.meteo.forecastRequests.count, 1)
        XCTAssertTrue(rig.meteo.forecastRequests[0].hasPrefix("https://api.open-meteo.com/v1/forecast?latitude=-6.92&longitude=107.61&"), rig.meteo.forecastRequests[0])
        let status = rig.controller.status()
        XCTAssertEqual(status["lastPushAt"] as? Int64, start)
        XCTAssertEqual(status["lastTemperatureC"] as? Int, 24)
        XCTAssertEqual(status["lastCondition"] as? String, "SUNNY")
        XCTAssertEqual(status["lastLocationName"] as? String, "Bandung")
        XCTAssertTrue(status["lastError"] is NSNull)
        XCTAssertEqual(try rig.link.watch.requests[5].tlv.string(0x08), "Bandung")
        XCTAssertEqual(try rig.link.watch.requests[5].tlv.byte(0x09), 24)
        XCTAssertTrue(rig.events.messages(.info).contains("Weather (connect): pushed"))
        await eventually("the timer sleeping") { rig.clock.sleeping == 1 }
        XCTAssertEqual(rig.clock.delays, [3_600_000], "the next push is one interval away")
    }

    func testTheSwitchOffMeansNothingIsSentOnConnect() async {
        let rig = makeRig(enabled: false)
        await rig.controller.linkConnected(rig.link.handleValue)
        XCTAssertTrue(rig.link.watch.requests.isEmpty)
        XCTAssertTrue(rig.meteo.urls.isEmpty)
        XCTAssertEqual(rig.clock.sleeping, 0)
        XCTAssertTrue(rig.events.messages(.info).contains { $0.contains("switch is off") })
    }

    func testAWatchWithoutWeatherIsNotPushedTo() async {
        let rig = makeRig(commands: [0x0F: [0x02, 0x09]])
        await rig.controller.linkConnected(rig.link.handleValue)
        XCTAssertTrue(rig.link.watch.requests.isEmpty)
        XCTAssertTrue(rig.events.messages(.info).contains { $0.contains("does not list the weather service") })
    }

    func testAReconnectInsideTenMinutesReusesTheReportAndASettingChangeDropsIt() async throws {
        let rig = makeRig()
        await rig.controller.linkConnected(rig.link.handleValue)
        rig.clock.advance(5 * 60)
        await rig.controller.linkConnected(rig.link.handleValue)
        XCTAssertEqual(rig.meteo.forecastRequests.count, 1, "9 minutes later the report is reused")
        XCTAssertEqual(rig.link.watch.count("0f/01"), 2, "but it is pushed again")

        rig.clock.advance(6 * 60)
        await rig.controller.linkConnected(rig.link.handleValue)
        XCTAssertEqual(rig.meteo.forecastRequests.count, 2, "a report older than ten minutes is fetched again")

        try rig.controller.setUnit("fahrenheit")
        await eventually("the push after the unit change") { rig.link.watch.count("0f/01") == 4 }
        XCTAssertEqual(rig.meteo.forecastRequests.count, 3, "a setting change drops the cached report")
        XCTAssertEqual(try rig.link.watch.requests.last { $0.key == "0f/01" }!.tlv.byte(0x0A), 1)
    }

    // MARK: location

    func testThisPhoneModeUsesTheFixAndStoresItWithItsName() async throws {
        let rig = makeRig(mode: .current)
        rig.location.last = LocationFix(latitude: -6.9147444, longitude: 107.6098111, timeSec: start - 600)
        rig.location.name = "Bandung"
        await rig.controller.linkConnected(rig.link.handleValue)

        XCTAssertEqual(rig.location.fixRequests, 0, "a fix from ten minutes ago is fresh enough")
        XCTAssertTrue(rig.meteo.forecastRequests[0].contains("latitude=-6.91&longitude=107.61"))
        XCTAssertEqual(rig.settings.lastFix, WeatherPlace(name: "Bandung", latitude: -6.9147444, longitude: 107.6098111))
        XCTAssertEqual(try rig.link.watch.requests.first { $0.key == "0f/01" }!.tlv.string(0x08), "Bandung")
        // The position goes to the watch as GpsAndTime, rounded to 7 decimals.
        XCTAssertTrue(rig.link.watch.requests.contains { $0.key == "18/07" })
    }

    func testWithoutPermissionTheWatchIsToldAndTheStatusSaysWhy() async throws {
        let rig = makeRig(mode: .current, authorization: .denied)
        await rig.controller.linkConnected(rig.link.handleValue)
        XCTAssertEqual(rig.link.watch.keys, [], "a failed fetch sends nothing on its own")
        XCTAssertEqual(rig.controller.status()["lastError"] as? String, "Location permission is not granted")
        XCTAssertEqual(rig.controller.status()["locationPermission"] as? Bool, false)
        XCTAssertTrue(rig.meteo.urls.isEmpty)
        XCTAssertTrue(rig.events.messages(.error).contains { $0.contains("[ERR_WEATHER_LOCATION]") })

        // The watch asks: it is told with GPS_PERMISSION_ERROR (1) on the extended error command.
        rig.link.watchSends(code: WeatherController.watchRequestCode)
        await eventually("the error packet") { rig.link.watch.count("0f/0c") == 1 }
        XCTAssertEqual(try rig.link.watch.requests.first { $0.key == "0f/0c" }!.tlv.object(0x81).byte(0x02), 1)
    }

    func testNoCityChosenIsALocationError() async {
        let rig = makeRig(mode: .city)
        rig.settings.city = nil
        do {
            _ = try await rig.controller.refreshNow()
            XCTFail("refreshed without a city")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .weatherLocation)
            XCTAssertEqual(e.message, "No city chosen for the weather")
        } catch {
            XCTFail("\(error)")
        }
    }

    func testNoFixAtAllIsALocationErrorWithAHint() async {
        let rig = makeRig(mode: .current)
        do {
            try await rig.controller.push("test", maxAgeSec: 0)
            XCTFail("pushed without a position")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .weatherLocation)
            XCTAssertTrue(e.message.contains("choose a city"), e.message)
        } catch {
            XCTFail("\(error)")
        }
    }

    // MARK: failures

    func testANetworkFailureIsReportedRetriedSoonAndTellsTheWatch() async throws {
        let rig = makeRig()
        rig.meteo.failure = URLError(.notConnectedToInternet)
        await rig.controller.linkConnected(rig.link.handleValue)
        XCTAssertTrue(rig.link.watch.requests.isEmpty)
        XCTAssertTrue((rig.controller.status()["lastError"] as? String)?.hasPrefix("Could not get the weather: ") == true)
        XCTAssertEqual(rig.clock.delays, [600_000], "a failed fetch is retried in ten minutes, not an hour")

        rig.link.watchSends(code: WeatherController.watchRequestCode)
        await eventually("the network error packet") { rig.link.watch.count("0f/0c") == 1 }
        XCTAssertEqual(try rig.link.watch.requests.first { $0.key == "0f/0c" }!.tlv.object(0x81).byte(0x02), 0)
    }

    func testABadAnswerIsANetworkError() async {
        let rig = makeRig()
        rig.meteo.forecast = #"{"error":true,"reason":"Too many requests"}"#
        do {
            _ = try await rig.controller.refreshNow()
            XCTFail("a refused request was pushed")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .weatherNetwork)
            XCTAssertEqual(e.message, "Could not get the weather: Open-Meteo: Too many requests")
        } catch {
            XCTFail("\(error)")
        }
    }

    func testARefusedStartIsAProtocolErrorAndNotAPush() async {
        let rig = makeRig()
        rig.link.watch.responder = { request in
            var tlv = HuaweiTLV()
            tlv.put(0x7F, int: 0x000186A1)
            return [ScriptedWatch.tlvFrame(service: request.service, command: request.command, tlv)]
        }
        do {
            _ = try await rig.controller.refreshNow()
            XCTFail("a refusing watch counted as pushed")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .protocolError)
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertTrue(rig.controller.status()["lastPushAt"] is NSNull, "lastPushAt is only ever a push that reached the watch")
        XCTAssertNotNil(rig.controller.status()["lastError"] as? String)
    }

    func testAnErrorOfALaterPushKeepsTheLastGoodPushAndClearsOnSuccess() async throws {
        let rig = makeRig()
        _ = try await rig.controller.refreshNow()
        XCTAssertEqual(rig.controller.status()["lastPushAt"] as? Int64, start)
        rig.clock.advance(120)
        rig.meteo.failure = URLError(.timedOut)
        do { _ = try await rig.controller.refreshNow() } catch {}
        XCTAssertEqual(rig.controller.status()["lastPushAt"] as? Int64, start, "the failed attempt does not move the time of the last push")
        XCTAssertNotNil(rig.controller.status()["lastError"] as? String)
        rig.meteo.failure = nil
        _ = try await rig.controller.refreshNow()
        XCTAssertTrue(rig.controller.status()["lastError"] is NSNull)
        XCTAssertEqual(rig.controller.status()["lastPushAt"] as? Int64, start + 120)
    }

    func testRefreshNeedsAConnectedWatchAndAnEnabledSwitch() async {
        let off = makeRig(enabled: false)
        do {
            _ = try await off.controller.refreshNow()
            XCTFail("refreshed with the switch off")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .weatherDisabled)
        } catch {
            XCTFail("\(error)")
        }
        let disconnected = makeRig(connected: false)
        do {
            _ = try await disconnected.controller.refreshNow()
            XCTFail("refreshed without a watch")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .notConnected)
        } catch {
            XCTFail("\(error)")
        }
        let unsupported = makeRig(commands: [0x0F: [0x02]])
        do {
            _ = try await unsupported.controller.refreshNow()
            XCTFail("refreshed a watch without weather")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
        } catch {
            XCTFail("\(error)")
        }
    }

    // MARK: the watch asks

    func testTheWatchRequestIsAnsweredWithAPushAndReusesAFiveMinuteOldReport() async throws {
        let rig = makeRig()
        await rig.controller.linkConnected(rig.link.handleValue)
        rig.link.watch.clear()
        rig.clock.advance(4 * 60)
        rig.link.watchSends(code: WeatherController.watchRequestCode)
        await eventually("the push after the request") { rig.link.watch.count("0f/08") == 1 }
        XCTAssertEqual(rig.meteo.forecastRequests.count, 1, "four minutes old: reused")

        rig.link.watch.clear()
        rig.clock.advance(2 * 60)
        rig.link.watchSends(code: WeatherController.watchRequestCode)
        await eventually("the second push") { rig.link.watch.count("0f/08") == 1 }
        XCTAssertEqual(rig.meteo.forecastRequests.count, 2, "six minutes old: fetched again")
    }

    func testTheWatchRequestWithTheSwitchOffIsToldWeatherDisabled() async throws {
        let rig = makeRig(enabled: false)
        await rig.controller.linkConnected(rig.link.handleValue)
        rig.link.watchSends(code: WeatherController.watchRequestCode)
        await eventually("the disabled error") { rig.link.watch.count("0f/0c") == 1 }
        XCTAssertEqual(try rig.link.watch.requests[0].tlv.object(0x81).byte(0x02), 2)
        XCTAssertTrue(rig.meteo.urls.isEmpty)
    }

    func testAnotherWatchMessageIsAcknowledgedWithAnUnencryptedDeviceRequest() async throws {
        let rig = makeRig()
        await rig.controller.linkConnected(rig.link.handleValue)
        rig.link.watch.clear()
        rig.link.watchSends(code: 0x1234)
        await eventually("the acknowledgement") { rig.link.watch.count("0f/04") == 1 }
        let ack = rig.link.watch.requests[0]
        XCTAssertFalse(ack.encrypted)
        XCTAssertEqual(try ack.tlv.int(0x01), 0x000186A0)
        XCTAssertEqual(rig.link.watch.keys, ["0f/04"], "no push")
    }

    // MARK: timer and the hooks for a woken process

    func testTheIntervalTimerPushesAgainAndReschedules() async throws {
        let rig = makeRig()
        rig.settings.intervalMinutes = 30
        await rig.controller.linkConnected(rig.link.handleValue)
        await eventually("the timer sleeping") { rig.clock.sleeping == 1 }
        XCTAssertEqual(rig.clock.delays, [1_800_000])
        rig.clock.advance(1800)
        rig.clock.fire()
        await eventually("the interval push") { rig.link.watch.count("0f/01") == 2 }
        await eventually("the timer sleeping again") { rig.clock.sleeping == 1 }
        XCTAssertEqual(rig.clock.delays, [1_800_000, 1_800_000])
        XCTAssertEqual(rig.meteo.forecastRequests.count, 2, "the interval push always fetches")
    }

    func testChangingTheIntervalRestartsTheTimer() async throws {
        let rig = makeRig()
        await rig.controller.linkConnected(rig.link.handleValue)
        await eventually("the timer sleeping") { rig.clock.sleeping == 1 }
        try rig.controller.setIntervalMinutes(15)
        await eventually("the timer restarted with the new interval") { rig.clock.delays.last == 900_000 }
        await eventually("one timer left") { rig.clock.sleeping == 1 }
    }

    func testDisconnectingStopsTheTimerAndSwitchingOffStopsPushing() async throws {
        let rig = makeRig()
        await rig.controller.linkConnected(rig.link.handleValue)
        await eventually("the timer sleeping") { rig.clock.sleeping == 1 }
        rig.link.setConnected(false)
        rig.controller.linkDisconnected()
        await eventually("the timer cancelled") { rig.clock.sleeping == 0 }

        let second = makeRig()
        await second.controller.linkConnected(second.link.handleValue)
        await eventually("the timer sleeping") { second.clock.sleeping == 1 }
        await second.controller.setEnabled(false)
        await eventually("the timer cancelled") { second.clock.sleeping == 0 }
        let pushes = second.link.watch.count("0f/01")
        second.clock.advance(7200)
        await second.controller.pushIfDue("test")
        XCTAssertEqual(second.link.watch.count("0f/01"), pushes, "nothing is pushed with the switch off")
    }

    func testAnOverdueTimerIsMadeUpWhenTheProcessWakesUp() async throws {
        let rig = makeRig()
        await rig.controller.linkConnected(rig.link.handleValue)
        XCTAssertEqual(rig.link.watch.count("0f/01"), 1)

        // The process was suspended, so the timer never fired. A wake before the push is due does nothing...
        rig.clock.advance(30 * 60)
        await rig.controller.pushIfDue("app foreground")
        XCTAssertEqual(rig.link.watch.count("0f/01"), 1)

        // ...one after it pushes, with a fresh fetch.
        rig.clock.advance(31 * 60)
        await rig.controller.pushIfDue("background sync")
        XCTAssertEqual(rig.link.watch.count("0f/01"), 2)
        XCTAssertEqual(rig.meteo.forecastRequests.count, 2)
        XCTAssertEqual(rig.controller.status()["lastPushAt"] as? Int64, start + 61 * 60)
        XCTAssertTrue(rig.events.messages(.info).contains("Weather (background sync): pushed"))
    }

    func testAFailedPushIsMadeUpAfterTheRetryDelay() async throws {
        let rig = makeRig()
        rig.meteo.failure = URLError(.notConnectedToInternet)
        await rig.controller.linkConnected(rig.link.handleValue)
        rig.meteo.failure = nil
        rig.clock.advance(5 * 60)
        await rig.controller.pushIfDue("app foreground")
        XCTAssertTrue(rig.link.watch.requests.isEmpty, "five minutes after a failure the retry is not due yet")
        rig.clock.advance(6 * 60)
        await rig.controller.pushIfDue("app foreground")
        XCTAssertEqual(rig.link.watch.count("0f/01"), 1)
    }

    // MARK: settings from JS

    func testSettingsAreValidatedAndStored() async throws {
        let rig = makeRig(enabled: false, mode: .current)
        for (unit, expected) in [("fahrenheit", TemperatureUnit.fahrenheit), ("celsius", .celsius)] {
            try rig.controller.setUnit(unit)
            XCTAssertEqual(rig.settings.unit, expected)
        }
        XCTAssertThrowsError(try rig.controller.setUnit("kelvin")) {
            XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument)
            XCTAssertEqual(($0 as? WearError)?.message, "Temperature unit must be celsius or fahrenheit, got 'kelvin'")
        }
        XCTAssertEqual(rig.settings.unit, .celsius)

        do {
            try await rig.controller.setLocationMode("gps")
            XCTFail("an unknown mode was accepted")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .invalidArgument)
            XCTAssertEqual(e.message, "Location mode must be current or city, got 'gps'")
        }
        try await rig.controller.setLocationMode("city")
        XCTAssertEqual(rig.settings.locationMode, .city)

        for minutes in [14, 1441, 0, -5] {
            XCTAssertThrowsError(try rig.controller.setIntervalMinutes(minutes)) { XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument, "\(minutes)") }
        }
        try rig.controller.setIntervalMinutes(15)
        try rig.controller.setIntervalMinutes(1440)
        XCTAssertEqual(rig.settings.intervalMinutes, 1440)
        XCTAssertEqual(rig.controller.status()["intervalMinutes"] as? Int, 1440)
    }

    func testChoosingThisPhoneOrSwitchingOnInThatModeAsksForLocationOnce() async throws {
        let rig = makeRig(enabled: false, mode: .city, authorization: .notDetermined, connected: false)
        try await rig.controller.setLocationMode("city")
        XCTAssertEqual(rig.location.prompts, 0, "a city needs no location")
        await rig.controller.setEnabled(true)
        XCTAssertEqual(rig.location.prompts, 0, "switching on with a city needs no location either")
        try await rig.controller.setLocationMode("current")
        XCTAssertEqual(rig.location.prompts, 1)
        XCTAssertEqual(rig.controller.status()["locationPermission"] as? Bool, true)
        await rig.controller.setEnabled(true)
        XCTAssertEqual(rig.location.prompts, 1, "the system asks only once")
        XCTAssertEqual(rig.settings.locationMode, .current)
        XCTAssertTrue(rig.settings.enabled)
    }

    func testADeniedPromptStillSavesTheModeAndTheStatusSaysNotGranted() async throws {
        let rig = makeRig(enabled: false, mode: .city, authorization: .notDetermined, connected: false)
        rig.location.grantOnPrompt = false
        try await rig.controller.setLocationMode("current")
        XCTAssertEqual(rig.settings.locationMode, .current)
        XCTAssertEqual(rig.controller.status()["locationPermission"] as? Bool, false)
    }

    func testSwitchingOnWithAWatchPushesAtOnce() async throws {
        let rig = makeRig(enabled: false)
        await rig.controller.linkConnected(rig.link.handleValue)
        XCTAssertTrue(rig.link.watch.requests.isEmpty)
        await rig.controller.setEnabled(true)
        await eventually("the push after switching on") { rig.link.watch.count("0f/01") == 1 }
        XCTAssertEqual(rig.controller.status()["enabled"] as? Bool, true)
    }

    // MARK: city search

    func testSettingTheCityStoresTheFirstMatchAndReturnsItsJsShape() async throws {
        let rig = makeRig(connected: false)
        rig.settings.city = nil
        let place = try await rig.controller.setCity("Bandung")
        XCTAssertEqual(place.name, "Bandung")
        XCTAssertEqual(rig.settings.city, place)
        XCTAssertEqual(place.toJS()["detail"] as? String, "West Java, Indonesia, ID")
        XCTAssertEqual(place.toJS()["latitude"] as? Double, -6.92222)
        let status = rig.controller.status()
        XCTAssertEqual((status["city"] as? [String: Any])?["name"] as? String, "Bandung")
        XCTAssertEqual(rig.meteo.urls, ["https://geocoding-api.open-meteo.com/v1/search?name=Bandung&count=1&language=en&format=json"])
    }

    func testCitySearchFailures() async {
        let rig = makeRig(connected: false)
        for blank in ["", "   "] {
            do {
                _ = try await rig.controller.setCity(blank)
                XCTFail("searched for nothing")
            } catch let e as WearError {
                XCTAssertEqual(e.code, .invalidArgument)
                XCTAssertEqual(e.message, "Enter a city name")
            } catch {
                XCTFail("\(error)")
            }
        }
        rig.meteo.geocoding = "{\"generationtime_ms\":0.8}"
        do {
            _ = try await rig.controller.setCity(" Zzzz ")
            XCTFail("found a city that does not exist")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .invalidArgument)
            XCTAssertEqual(e.message, "No city found for \"Zzzz\"")
        } catch {
            XCTFail("\(error)")
        }
        rig.meteo.failure = URLError(.notConnectedToInternet)
        do {
            _ = try await rig.controller.setCity("Bandung")
            XCTFail("searched without a network")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .weatherNetwork)
            XCTAssertTrue(e.message.hasPrefix("Could not search for the city: "), e.message)
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertEqual(rig.settings.city?.name, "Bandung", "a failed search leaves the stored city")
    }

    func testChoosingACityWhileConnectedPushesIt() async throws {
        let rig = makeRig()
        await rig.controller.linkConnected(rig.link.handleValue)
        rig.link.watch.clear()
        _ = try await rig.controller.setCity("Bandung, East Java")
        await eventually("the push for the new city") { rig.link.watch.count("0f/01") == 1 }
        XCTAssertEqual(rig.settings.city?.detail, "East Java, Indonesia, ID")
        XCTAssertTrue(rig.meteo.forecastRequests.last!.contains("latitude=-8.17&longitude=111.78"), rig.meteo.forecastRequests.last!)
    }

    // MARK: observers

    func testTheControllerListensToTheLinkThroughTheObserverList() async {
        let rig = makeRig()
        let observers = LinkObservers()
        observers.add(rig.controller)
        for task in observers.connected(rig.link.handleValue) { await task.value }
        XCTAssertEqual(rig.link.watch.count("0f/01"), 1)
        observers.disconnected()
        await eventually("the timer cancelled") { rig.clock.sleeping == 0 }
    }
}

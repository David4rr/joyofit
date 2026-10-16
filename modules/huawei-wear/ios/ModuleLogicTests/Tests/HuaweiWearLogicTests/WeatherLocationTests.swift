import XCTest
@testable import HuaweiWearLogic

/// The position lookup of WeatherLocation.kt over a fake `LocationSource`, and the settings store.
final class WeatherLocationTests: XCTestCase {
    private let now: Int64 = 1_792_110_700

    private func make(_ source: FakeLocation, fixTimeoutMs: Int = 200) -> (WeatherLocation, WeatherSettings, RecordingEvents) {
        let settings = WeatherSettings(defaults: ephemeralDefaults())
        let events = RecordingEvents()
        let location = WeatherLocation(source: source, settings: settings, fixTimeoutMs: fixTimeoutMs, now: { Date(timeIntervalSince1970: TimeInterval(self.now)) }) { events.info($0) }
        return (location, settings, events)
    }

    func testWithoutPermissionItSaysSo() async {
        for authorization in [LocationAuthorization.denied, .notDetermined] {
            let (location, _, _) = make(FakeLocation(authorization))
            XCTAssertFalse(location.hasPermission())
            do {
                _ = try await location.current()
                XCTFail("a position without permission")
            } catch let e as WeatherLocationError {
                XCTAssertTrue(e.permissionMissing)
                XCTAssertEqual(e.message, "Location permission is not granted")
            } catch {
                XCTFail("\(error)")
            }
        }
    }

    func testAFreshLastKnownFixIsUsedWithoutAskingForANewOne() async throws {
        let source = FakeLocation(.granted)
        source.last = LocationFix(latitude: -6.9, longitude: 107.6, timeSec: now - 3000)
        source.fresh = LocationFix(latitude: 1, longitude: 1, timeSec: now)
        source.name = "Bandung"
        let (location, settings, _) = make(source)
        let place = try await location.current()
        XCTAssertEqual(place, WeatherPlace(name: "Bandung", latitude: -6.9, longitude: 107.6))
        XCTAssertEqual(source.fixRequests, 0)
        XCTAssertEqual(settings.lastFix, place)
    }

    func testAStaleLastKnownFixIsReplacedByAFreshOne() async throws {
        let source = FakeLocation(.granted)
        source.last = LocationFix(latitude: -6.9, longitude: 107.6, timeSec: now - 2 * 3600)
        source.fresh = LocationFix(latitude: 3.1, longitude: 101.7, timeSec: now)
        source.name = "Kuala Lumpur"
        let (location, _, _) = make(source)
        let place = try await location.current()
        XCTAssertEqual(place.latitude, 3.1)
        XCTAssertEqual(place.name, "Kuala Lumpur")
        XCTAssertEqual(source.fixRequests, 1)
    }

    func testWhenNoFreshFixComesTheStaleLastKnownOneIsUsedAndTheLogSaysSo() async throws {
        let source = FakeLocation(.granted)
        source.last = LocationFix(latitude: -6.9, longitude: 107.6, timeSec: now - 2 * 3600)
        source.hangFix = true
        let (location, _, events) = make(source, fixTimeoutMs: 50)
        let place = try await location.current()
        XCTAssertEqual(place.latitude, -6.9)
        XCTAssertTrue(events.messages().contains("Weather: no fresh location fix, using the last known one"))
    }

    func testWithNothingElseTheStoredPositionAnswersAndWithNothingAtAllItIsAnError() async throws {
        let source = FakeLocation(.granted)
        source.fresh = nil
        let (location, settings, events) = make(source)
        do {
            _ = try await location.current()
            XCTFail("a position from nowhere")
        } catch let e as WeatherLocationError {
            XCTAssertFalse(e.permissionMissing)
            XCTAssertTrue(e.message.contains("choose a city"))
        }
        settings.lastFix = WeatherPlace(name: "Bandung", latitude: -6.9, longitude: 107.6)
        let place = try await location.current()
        XCTAssertEqual(place, WeatherPlace(name: "Bandung", latitude: -6.9, longitude: 107.6))
        XCTAssertTrue(events.messages().contains("Weather: no fresh location fix, using the stored position"))
    }

    func testThePlaceNameIsKeptWhenThePhoneMovedLessThanFiveKilometres() async throws {
        let source = FakeLocation(.granted)
        let (location, settings, _) = make(source)
        settings.lastFix = WeatherPlace(name: "Bandung", latitude: -6.9, longitude: 107.6)
        // About 2 km north-east.
        source.last = LocationFix(latitude: -6.885, longitude: 107.615, timeSec: now - 10)
        source.name = "Somewhere else"
        var place = try await location.current()
        XCTAssertEqual(place.name, "Bandung")
        XCTAssertEqual(source.nameRequests, 0)

        // About 50 km away.
        source.last = LocationFix(latitude: -6.5, longitude: 107.9, timeSec: now - 10)
        place = try await location.current()
        XCTAssertEqual(place.name, "Somewhere else")
        XCTAssertEqual(source.nameRequests, 1)
    }

    func testAnUnnamedPositionStaysUnnamed() async throws {
        let source = FakeLocation(.granted)
        source.last = LocationFix(latitude: -6.9, longitude: 107.6, timeSec: now - 10)
        let (location, _, _) = make(source)
        let place = try await location.current()
        XCTAssertNil(place.name)
        XCTAssertTrue(place.toJS()["name"] is NSNull)
    }

    func testDistanceIsGreatCircleKilometres() {
        XCTAssertEqual(WeatherLocation.distanceKm(0, 0, 0, 1), 111.19, accuracy: 0.1)
        XCTAssertEqual(WeatherLocation.distanceKm(-6.9, 107.6, -6.9, 107.6), 0, accuracy: 0.0001)
        XCTAssertEqual(WeatherLocation.distanceKm(-6.9, 107.6, -6.885, 107.615), 2.35, accuracy: 0.1)
    }

    // MARK: settings

    func testSettingsDefaultsAndRoundTrip() {
        let settings = WeatherSettings(defaults: ephemeralDefaults())
        XCTAssertFalse(settings.enabled)
        XCTAssertEqual(settings.unit, .celsius)
        XCTAssertEqual(settings.locationMode, .current)
        XCTAssertEqual(settings.intervalMinutes, 60)
        XCTAssertNil(settings.city)
        XCTAssertNil(settings.lastFix)

        settings.enabled = true
        settings.unit = .fahrenheit
        settings.locationMode = .city
        settings.intervalMinutes = 240
        let city = WeatherPlace(name: "Bandung", latitude: -6.92222, longitude: 107.60694, detail: "West Java, Indonesia, ID")
        settings.city = city
        settings.lastFix = WeatherPlace(name: nil, latitude: 1.5, longitude: -2.5)
        XCTAssertTrue(settings.enabled)
        XCTAssertEqual(settings.unit, .fahrenheit)
        XCTAssertEqual(settings.locationMode, .city)
        XCTAssertEqual(settings.intervalMinutes, 240)
        XCTAssertEqual(settings.city, city)
        XCTAssertEqual(settings.lastFix, WeatherPlace(name: nil, latitude: 1.5, longitude: -2.5))

        settings.city = nil
        settings.lastFix = nil
        XCTAssertNil(settings.city)
        XCTAssertNil(settings.lastFix)
    }

    func testSettingsAreSharedBetweenInstancesOfTheSameSuite() {
        let defaults = ephemeralDefaults()
        WeatherSettings(defaults: defaults).enabled = true
        XCTAssertTrue(WeatherSettings(defaults: defaults).enabled, "the module, the wake and the watch-request handler read the same values")
    }

    func testTheRuntimeOwnsTheWeatherControllerAndAnnouncesTheSessionToIt() async {
        let rt = WearRuntime(
            settings: WearSettings(defaults: ephemeralDefaults()), syncStore: SyncStore(url: temporaryDatabaseURL()),
            deviceStore: DeviceStore(secrets: MemorySecretStore()), gate: AlwaysReadyGate(),
            environment: .init(app: "app 1 (1)", phone: "Apple test"), phoneModel: "test",
            transportFactory: { request, delegate in FakeTransport(.hangConnect, request: request, delegate: delegate) },
            weatherDefaults: ephemeralDefaults()
        )
        XCTAssertEqual(rt.weather.status()["enabled"] as? Bool, false)
        XCTAssertTrue(rt.weather.status()["watchSupported"] is NSNull, "no watch connected")
        XCTAssertEqual(rt.weather.status()["locationPermission"] as? Bool, false, "no location source on this platform")
    }
}

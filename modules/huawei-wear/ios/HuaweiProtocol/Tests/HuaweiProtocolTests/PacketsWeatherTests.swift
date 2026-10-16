import XCTest
@testable import HuaweiProtocol

/// Weather packets against the real Gadgetbridge `Weather` class (Fixtures/packetsWeather.json, from GoldenGen/src/GoldenWeather.java), and the Java
/// number formatting the Kotlin weather code depends on.
final class PacketsWeatherTests: XCTestCase {
    let g = try! Golden.load("packetsWeather")

    static func settings(_ flags: String) -> Weather.Settings {
        var s = Weather.Settings()
        for flag in flags.split(separator: ",") {
            switch flag {
            case "weather": s.weatherSupported = true
            case "wind": s.windSupported = true
            case "pm25": s.pm25Supported = true
            case "temp": s.temperatureSupported = true
            case "loc": s.locationNameSupported = true
            case "curTemp": s.currentTemperatureSupported = true
            case "unit": s.unitSupported = true
            case "aqi": s.airQualityIndexSupported = true
            case "time": s.timeSupported = true
            case "source": s.sourceSupported = true
            case "icon": s.weatherIconSupported = true
            case "extHourly": s.extendedHourlyForecast = true
            case "sunrise": s.sunRiseSetSupported = true
            case "moon": s.moonPhaseSupported = true
            case "uv": s.uvIndexSupported = true
            default: XCTFail("unknown flag \(flag)")
            }
        }
        return s
    }

    private func optInt(_ c: [String: Any], _ key: String) -> Int? {
        guard let n = c[key] as? NSNumber else { return nil }
        return n.intValue
    }

    private func check(_ packet: HuaweiPacket, _ c: [String: Any], _ name: String, file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name, file: file, line: line)
        XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name, file: file, line: line)
        XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name, file: file, line: line)
        XCTAssertEqual(packet.isSliced, c.bool("sliced"), name, file: file, line: line)
        XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), name, file: file, line: line)
        XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], name, file: file, line: line)
    }

    // MARK: requests

    func testRequestsMatchJava() throws {
        let requests = g.list("requests")
        XCTAssertGreaterThanOrEqual(requests.count, 130)
        var current = 0
        for c in requests {
            let name = c.str("name")
            if c["settings"] != nil {
                current += 1
                let packet = Weather.CurrentWeatherRequest.request(
                    settings: Self.settings(c.str("settings")),
                    icon: c.opt("icon").flatMap { Weather.Icon(rawValue: $0) },
                    windDirection: optInt(c, "windDirection").map { Int32(truncatingIfNeeded: $0) },
                    windSpeed: optInt(c, "windSpeed").map { Int8(truncatingIfNeeded: $0) },
                    lowestTemperature: optInt(c, "low").map { Int8(truncatingIfNeeded: $0) },
                    highestTemperature: optInt(c, "high").map { Int8(truncatingIfNeeded: $0) },
                    pm25: optInt(c, "pm25").map { Int16(truncatingIfNeeded: $0) },
                    locationName: c.opt("location"),
                    currentTemperature: optInt(c, "cur").map { Int8(truncatingIfNeeded: $0) },
                    temperatureUnit: c.opt("unit").flatMap { Weather.TemperatureFormat(rawValue: $0) },
                    airQualityIndex: optInt(c, "aqi").map { Int16(truncatingIfNeeded: $0) },
                    observationTime: optInt(c, "obs").map { Int32(truncatingIfNeeded: $0) },
                    uvIndex: (c["uv"] as? NSNumber).map { Float(truncating: $0) },
                    sourceName: c.opt("source"),
                    humidity: optInt(c, "humidity").map { Int8(truncatingIfNeeded: $0) },
                    windSpeedValue: optInt(c, "windValue").map { Int32(truncatingIfNeeded: $0) },
                    feelLikeTemperature: optInt(c, "feel").map { Int32(truncatingIfNeeded: $0) }
                )
                try check(packet, c, name)
                continue
            }
            let p = c["packet"] as? [String: Any] ?? [:]
            let packet: HuaweiPacket
            switch c.str("kind") {
            case "support": packet = Weather.WeatherSupport.request()
            case "extendedSupport": packet = Weather.WeatherExtendedSupport.request()
            case "sunMoonSupport": packet = Weather.WeatherSunMoonSupport.request()
            case "start": packet = Weather.WeatherStart.request()
            case "deviceRequest": packet = Weather.WeatherDeviceRequest.request(responseValue: Int32(truncatingIfNeeded: c.int("value")))
            case "unit": packet = Weather.WeatherUnitRequest.request(temperatureFormat: Weather.TemperatureFormat(rawValue: c.str("unit"))!)
            case "errorSimple": packet = Weather.WeatherErrorSimple.request(errorCode: Weather.ErrorCode(rawValue: c.str("code"))!)
            case "errorExtended":
                packet = Weather.WeatherErrorExtended.request(errorCode: Weather.ErrorCode(rawValue: c.str("code"))!, serverError: c.bool("serverError"))
            case "gps":
                packet = GpsAndTime.CurrentGPSRequest.request(
                    timestamp: Int32(c.int("timestamp")), latitude: (c["latitude"] as! NSNumber).doubleValue, longitude: (c["longitude"] as! NSNumber).doubleValue
                )
            default:
                XCTFail("unknown kind in \(name)")
                continue
            }
            try check(packet, p, name)
        }
        XCTAssertGreaterThanOrEqual(current, 100)
    }

    func testForecastsMatchJava() throws {
        let forecasts = g.list("forecasts")
        XCTAssertEqual(forecasts.count, 17)
        for c in forecasts {
            let name = c.str("name")
            func byte(_ d: [String: Any], _ key: String) -> Int8? { optInt(d, key).map { Int8(truncatingIfNeeded: $0) } }
            func int(_ d: [String: Any], _ key: String) -> Int32? { optInt(d, key).map { Int32(truncatingIfNeeded: $0) } }
            let hours = (c["hours"] as? [[String: Any]])?.map { h in
                Weather.WeatherForecastData.TimeData(
                    timestamp: Int32(h.int("timestamp")), icon: h.opt("icon").flatMap { Weather.Icon(rawValue: $0) }, temperature: byte(h, "temperature"),
                    precipitation: byte(h, "precipitation"), uvIndex: byte(h, "uv")
                )
            }
            let days = (c["days"] as? [[String: Any]])?.map { d in
                Weather.WeatherForecastData.DayData(
                    timestamp: Int32(d.int("timestamp")), icon: d.opt("icon").flatMap { Weather.Icon(rawValue: $0) }, highTemperature: byte(d, "high"),
                    lowTemperature: byte(d, "low"), sunriseTime: int(d, "sunrise"), sunsetTime: int(d, "sunset"), moonRiseTime: int(d, "moonRise"),
                    moonSetTime: int(d, "moonSet"), moonPhase: d.opt("moonPhase").flatMap { Weather.MoonPhase(rawValue: $0) }
                )
            }
            try check(Weather.WeatherForecastData.request(settings: Self.settings(c.str("settings")), hours: hours, days: days), c, name)
        }
        XCTAssertGreaterThan(forecasts.map { ($0["frames"] as? [String])?.count ?? 0 }.max() ?? 0, 1, "at least one forecast is cut into slices")
    }

    // MARK: responses

    func testResponsesMatchJava() throws {
        let responses = g.list("responses")
        XCTAssertEqual(responses.count, 49)
        var failures = 0
        for c in responses {
            let name = c.str("name")
            let packet = try PacketsKit.tlvPacket(c.int("service"), c.int("command"), c.str("tlv"))
            do {
                var fields: [String: Any] = [:]
                switch c.int("command") {
                case 0x02:
                    let r = try Weather.WeatherSupport.Response(packet: packet)
                    fields = [
                        "supportedBitmap": Int(r.supportedBitmap), "weatherSupported": r.weatherSupported, "windSupported": r.windSupported, "pm25Supported": r.pm25Supported,
                        "temperatureSupported": r.temperatureSupported, "locationNameSupported": r.locationNameSupported,
                        "currentTemperatureSupported": r.currentTemperatureSupported, "unitSupported": r.unitSupported, "airQualityIndexSupported": r.airQualityIndexSupported,
                    ]
                case 0x06:
                    let r = try Weather.WeatherExtendedSupport.Response(packet: packet)
                    fields = ["supportedBitmap": Int(r.supportedBitmap), "timeSupported": r.timeSupported, "sourceSupported": r.sourceSupported, "weatherIconSupported": r.weatherIconSupported]
                case 0x09:
                    let r = try Weather.WeatherStart.Response(packet: packet)
                    fields = ["successCode": Int(r.successCode), "success": r.success]
                case 0x0A:
                    let r = try Weather.WeatherSunMoonSupport.Response(packet: packet)
                    fields = ["supportedBitmap": Int(r.supportedBitmap), "sunRiseSetSupported": r.sunRiseSetSupported, "moonPhaseSupported": r.moonPhaseSupported]
                default:
                    XCTFail("\(name): unexpected command")
                }
                guard c.bool("ok") else {
                    XCTFail("\(name): Java failed with \(c.str("exception")) but Swift parsed")
                    continue
                }
                XCTAssertEqual(PacketsKit.canonical(fields), PacketsKit.canonical(c["fields"] ?? [:]), name)
            } catch {
                guard !c.bool("ok") else {
                    XCTFail("\(name): Java parsed but Swift failed with \(error)")
                    continue
                }
                failures += 1
                let (swiftName, swiftParse) = PacketsKit.exceptionClass(error)
                XCTAssertEqual(swiftParse, c.bool("parseException"), "\(name): Java \(c.str("exception")), Swift \(swiftName)")
                if c.bool("parseException") { XCTAssertEqual(swiftName, c.str("exception"), name) }
            }
        }
        XCTAssertGreaterThanOrEqual(failures, 10)
    }

    // MARK: Java number formatting and the moon

    func testTwoDecimalsAndSevenDecimalRoundingMatchJava() {
        let formats = g.list("formats")
        XCTAssertGreaterThan(formats.count, 1000)
        for f in formats {
            let value = Double(bitPattern: UInt64(bitPattern: Int64(truncating: f["bits"] as! NSNumber)))
            XCTAssertEqual(JavaNumbers.twoDecimals(value), f.str("coordinate"), "%.2f of \(value)")
            let expected = (f["rounded7"] as! NSNumber).doubleValue
            XCTAssertEqual(JavaNumbers.roundedToSevenDecimals(value), expected, "setScale(7) of \(value)")
        }
    }

    func testUrlEncodingMatchesJava() {
        for e in g.list("encodings") { XCTAssertEqual(JavaNumbers.urlEncode(e.str("text")), e.str("encoded"), e.str("text")) }
    }

    func testMoonPhaseMatchesTheKotlinFormula() {
        let moon = g.list("moon")
        XCTAssertGreaterThan(moon.count, 100)
        for m in moon {
            let degrees = Moon.phaseDegrees((m["epoch"] as! NSNumber).int64Value)
            XCTAssertEqual(degrees, m.int("degrees"), "epoch \(m["epoch"] ?? "")")
            XCTAssertEqual(Weather.degreesToMoonPhase(degrees)?.rawValue, m.opt("phase"))
        }
        for p in g.list("phases") { XCTAssertEqual(Weather.degreesToMoonPhase(p.int("degrees"))?.rawValue, p.opt("phase"), "degrees \(p.int("degrees"))") }
    }
}

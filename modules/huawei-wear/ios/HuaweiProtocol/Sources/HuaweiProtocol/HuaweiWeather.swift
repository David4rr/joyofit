// Port of HuaweiWeather.kt (derived from Gadgetbridge's HuaweiWeatherManager.{sendWeather,fixupWeather,handleAsyncMessage} and the SendWeather*Request
// chain): builds the weather packets from a `WeatherReport` (no I/O, `WeatherPackets`) and runs GB's request sequence over one session
// (`HuaweiWeatherSender`).
import Foundation

public enum WeatherPackets {
    /// Whole degrees, clamped to the signed byte the watch takes.
    public static func temperatureByte(_ celsius: Double) -> Int8 {
        Int8(clamping: Weather.javaRound(celsius))
    }

    /// Hours the forecast request carries (SendWeatherForecastRequest).
    public static let maxHours = 24
    /// Days including today (SendWeatherForecastRequest).
    public static let maxDays = 8

    /// SendWeatherCurrentRequest. Temperatures are always Celsius, like GB (`K - 273`); the unit tag (0x0a) is what tells the watch to display Fahrenheit.
    public static func current(settings: Weather.Settings, report: WeatherReport, unit: TemperatureUnit) -> HuaweiPacket {
        let today = report.daily[0]
        return Weather.CurrentWeatherRequest.request(
            settings: settings,
            icon: WeatherIcons.forWmo(report.code),
            windDirection: report.windDirection,
            windSpeed: Int8(truncatingIfNeeded: Beaufort.fromKmh(report.windSpeedKmh)),
            lowestTemperature: temperatureByte(today.minC),
            highestTemperature: temperatureByte(today.maxC),
            pm25: nil, // Open-Meteo's forecast API has no air quality
            locationName: report.place.name,
            currentTemperature: temperatureByte(report.tempC),
            temperatureUnit: unit.format,
            airQualityIndex: nil,
            observationTime: report.observedAtSec,
            uvIndex: report.uvIndex.map { Float($0) },
            sourceName: sourceName,
            humidity: Int8(truncatingIfNeeded: min(max(report.humidity, 0), 100)),
            windSpeedValue: Weather.javaRound(report.windSpeedKmh),
            feelLikeTemperature: Weather.javaRound(report.feelsLikeC)
        )
    }

    /// SendWeatherForecastRequest after GB's fixupWeather: the next 24 hours, then today (current icon, as GB does) and up to seven more days.
    /// Open-Meteo has no moon times, so they are 0 and skipped by the packet; the moon phase is computed (`Moon`).
    public static func forecast(settings: Weather.Settings, report: WeatherReport, nowSec: Int64, zone: TimeZone) -> HuaweiPacket {
        let hours: [Weather.WeatherForecastData.TimeData] = Array(report.hourly.lazy.filter { Int64($0.timestamp) > nowSec }.prefix(maxHours)).map { hour in
            Weather.WeatherForecastData.TimeData(
                timestamp: hour.timestamp,
                icon: WeatherIcons.forWmo(hour.code),
                temperature: temperatureByte(hour.tempC),
                precipitation: Int8(truncatingIfNeeded: min(max(hour.precipProbability ?? 0, 0), 100)),
                uvIndex: Int8(truncatingIfNeeded: min(max(Weather.javaRound(hour.uvIndex ?? 0), 0), 127))
            )
        }

        let calendar = dayCalendar(zone)
        let dayCount = min(report.daily.count, maxDays)
        var days: [Weather.WeatherForecastData.DayData] = []
        days.reserveCapacity(dayCount)
        let today = report.daily[0]
        days.append(
            day(
                timestamp: report.observedAtSec,
                code: report.code,
                source: today,
                sunrise: sunInDay(today.sunrise, calendar: calendar, nowSec: nowSec, day: 0),
                sunset: sunInDay(today.sunset, calendar: calendar, nowSec: nowSec, day: 0),
                moonPhaseAt: dayStartSec(calendar, nowSec, 0) + 12 * 3600
            )
        )
        for i in 1..<max(dayCount, 1) {
            let forecast = report.daily[i]
            days.append(
                day(
                    // GB: the observation time plus whole days, not the day's own midnight.
                    timestamp: report.observedAtSec &+ Int32(truncatingIfNeeded: 24 * 3600 * i),
                    code: forecast.code,
                    source: forecast,
                    sunrise: sunInDay(forecast.sunrise, calendar: calendar, nowSec: nowSec, day: i),
                    sunset: sunInDay(forecast.sunset, calendar: calendar, nowSec: nowSec, day: i),
                    moonPhaseAt: dayStartSec(calendar, nowSec, i) + 12 * 3600
                )
            )
        }
        return Weather.WeatherForecastData.request(settings: settings, hours: hours, days: days)
    }

    private static func day(timestamp: Int32, code: Int32, source: WeatherDay, sunrise: Int32, sunset: Int32, moonPhaseAt: Int64) -> Weather.WeatherForecastData.DayData {
        Weather.WeatherForecastData.DayData(
            timestamp: timestamp,
            icon: WeatherIcons.forWmo(code),
            highTemperature: temperatureByte(source.maxC),
            lowTemperature: temperatureByte(source.minC),
            sunriseTime: sunrise,
            sunsetTime: sunset,
            moonRiseTime: 0,
            moonSetTime: 0,
            moonPhase: Weather.degreesToMoonPhase(Moon.phaseDegrees(moonPhaseAt))
        )
    }

    /// GB fixupWeather: "if this is wrong the watch does not display any weather data at all", so a sun time outside the local day it belongs to
    /// (`day` days after today) is sent as 0.
    public static func sunInDay(_ timeSec: Int32, zone: TimeZone, nowSec: Int64, day: Int) -> Int32 {
        sunInDay(timeSec, calendar: dayCalendar(zone), nowSec: nowSec, day: day)
    }

    private static func sunInDay(_ timeSec: Int32, calendar: Calendar, nowSec: Int64, day: Int) -> Int32 {
        if timeSec == 0 { return 0 }
        let start = dayStartSec(calendar, nowSec, day)
        let end = dayStartSec(calendar, nowSec, day + 1)
        // GB timeOutOfDateInterval: out when check <= start or check > end.
        let check = Int64(timeSec)
        return (check <= start || check > end) ? 0 : timeSec
    }

    private static func dayCalendar(_ zone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar
    }

    /// Midnight, `plusDays` calendar days after the day of `nowSec`, in the calendar's zone (`LocalDate.plusDays(n).atStartOfDay(zone)`).
    private static func dayStartSec(_ calendar: Calendar, _ nowSec: Int64, _ plusDays: Int) -> Int64 {
        let today = calendar.startOfDay(for: Date(timeIntervalSince1970: TimeInterval(nowSec)))
        let shifted = calendar.date(byAdding: .day, value: plusDays, to: today) ?? today.addingTimeInterval(TimeInterval(plusDays * 86400))
        return Int64(calendar.startOfDay(for: shifted).timeIntervalSince1970)
    }

    /// SendWeatherCurrentRequest: GB passes its app name as the source.
    public static let sourceName = "Open-Meteo"

    /// SendWeatherErrorRequest: the extended packet when the watch lists 0f/0c, else the simple one (0f/07).
    public static func error(caps: DeviceCaps, code: Weather.ErrorCode) -> HuaweiPacket? {
        if caps.supports(Int(Weather.id), Int(Weather.WeatherErrorExtended.id)) {
            return Weather.WeatherErrorExtended.request(errorCode: code, serverError: false)
        }
        if caps.supports(Int(Weather.id), Int(Weather.WeatherErrorSimple.id)) {
            return Weather.WeatherErrorSimple.request(errorCode: code)
        }
        return nil
    }

    /// GB rounds the position to 7 decimals and back-dates the timestamp by a day so a workout's GPS wins.
    public static func gps(nowSec: Int64, place: WeatherPlace) -> HuaweiPacket {
        GpsAndTime.CurrentGPSRequest.request(
            timestamp: Int32(truncatingIfNeeded: nowSec - 86400),
            latitude: JavaNumbers.roundedToSevenDecimals(place.latitude),
            longitude: JavaNumbers.roundedToSevenDecimals(place.longitude)
        )
    }
}

/// The weather packet sequence of GB's HuaweiWeatherManager.sendWeather, over one `HuaweiSession`.
public struct HuaweiWeatherSender: Sendable {
    /// The watch's reply code on 0f/xx that means "ok"; other codes are only logged.
    static let okReplyCode: Int32 = 0x000186A0

    private let session: HuaweiSession
    private let caps: DeviceCaps
    private let log: LogSink

    public init(session: HuaweiSession, caps: DeviceCaps, log: @escaping LogSink) {
        self.session = session
        self.caps = caps
        self.log = log
    }

    /// Whether the watch lists the weather service at all (HuaweiState.supportsWeather: 0f/01).
    public static func supported(_ caps: DeviceCaps) -> Bool { caps.supports(Int(Weather.id), Int(Weather.CurrentWeatherRequest.id)) }

    public func supported() -> Bool { HuaweiWeatherSender.supported(caps) }

    private func info(_ message: String) { log(LogEntry(.info, message)) }

    /// Start, unit, support flags, current weather, position, forecast, each waiting for the watch's reply like GB's request chain. `zone` is the
    /// phone's: it decides which sun times fall in "today".
    public func send(report: WeatherReport, unit: TemperatureUnit, nowSec: Int64, zone: TimeZone = .current) async throws {
        if !supported() { throw WearError(.unsupported, "The watch does not list the weather service (0f/01)") }
        var settings = Weather.Settings()
        settings.uvIndexSupported = caps.expandCapability(0x2F) // supportsWeatherUvIndex
        settings.extendedHourlyForecast = caps.expandCapability(0xC0) // supportsWeatherExtendedHourForecast

        // SendWeatherStartRequest: a non-ok code stops GB's chain.
        let start: Weather.WeatherStart.Response = try await session.request(Weather.WeatherStart.request(), timeoutMs: Timeouts.queryMs, label: "WeatherStart")
        if !start.success {
            throw WearError(.protocolError, "WeatherStart: the watch refused (code " + hex32(start.successCode) + ")")
        }
        settings.weatherSupported = true

        if caps.supports(Int(Weather.id), Int(Weather.WeatherUnitRequest.id)) {
            _ = try await ask(Weather.WeatherUnitRequest.request(temperatureFormat: unit.format), "WeatherUnit")
        }

        let support: Weather.WeatherSupport.Response = try await session.request(
            Weather.WeatherSupport.request(), timeoutMs: Timeouts.queryMs, label: "WeatherSupport"
        )
        settings.weatherSupported = support.weatherSupported
        settings.windSupported = support.windSupported
        settings.pm25Supported = support.pm25Supported
        settings.temperatureSupported = support.temperatureSupported
        settings.locationNameSupported = support.locationNameSupported
        settings.currentTemperatureSupported = support.currentTemperatureSupported
        settings.unitSupported = support.unitSupported
        settings.airQualityIndexSupported = support.airQualityIndexSupported
        info("Weather support bitmap " + hex(UInt32(UInt8(bitPattern: support.supportedBitmap)), width: 2))

        if caps.supports(Int(Weather.id), Int(Weather.WeatherExtendedSupport.id)) {
            let extended: Weather.WeatherExtendedSupport.Response = try await session.request(
                Weather.WeatherExtendedSupport.request(), timeoutMs: Timeouts.queryMs, label: "WeatherExtendedSupport"
            )
            settings.timeSupported = extended.timeSupported
            settings.sourceSupported = extended.sourceSupported
            settings.weatherIconSupported = extended.weatherIconSupported
            info("Weather extended bitmap " + hex(UInt32(UInt16(bitPattern: extended.supportedBitmap)), width: 4))
        }

        if caps.supports(Int(Weather.id), Int(Weather.WeatherSunMoonSupport.id)) {
            let sunMoon: Weather.WeatherSunMoonSupport.Response = try await session.request(
                Weather.WeatherSunMoonSupport.request(), timeoutMs: Timeouts.queryMs, label: "WeatherSunMoonSupport"
            )
            settings.sunRiseSetSupported = sunMoon.sunRiseSetSupported
            settings.moonPhaseSupported = sunMoon.moonPhaseSupported
            info("Weather sun/moon bitmap " + hex(UInt32(bitPattern: sunMoon.supportedBitmap), width: 2))
        }

        _ = try await ask(WeatherPackets.current(settings: settings, report: report, unit: unit), "WeatherCurrent")
        info(
            "Weather current sent: \(report.place.name ?? "unnamed place") \(WeatherPackets.temperatureByte(report.tempC))\u{00B0}C "
                + "\(WeatherIcons.forWmo(report.code).name) (WMO \(report.code)), unit \(unit.wire)"
        )

        // SendGpsAndTimeToDeviceRequest: GB sends it by default when the watch lists 0x18/0x06.
        if caps.supports(Int(GpsAndTime.id), 0x06) {
            do {
                _ = try await ask(WeatherPackets.gps(nowSec: nowSec, place: report.place), "WeatherGps")
                info("Weather position sent to the watch")
            } catch let e as WearError {
                if e.code == .disconnected { throw e }
                log(LogEntry(.error, "Weather position skipped: \(e.message)"))
            }
        }

        if caps.supports(Int(Weather.id), Int(Weather.WeatherForecastData.id)) {
            let forecast = WeatherPackets.forecast(settings: settings, report: report, nowSec: nowSec, zone: zone)
            _ = try await ask(forecast, "WeatherForecast")
            info("Weather forecast sent: \(min(report.daily.count, WeatherPackets.maxDays)) days, hourly from \(iso8601(nowSec))")
        }
    }

    /// SendWeatherErrorRequest; returns false when the watch lists neither error command.
    public func sendError(_ code: Weather.ErrorCode) async throws -> Bool {
        guard let packet = WeatherPackets.error(caps: caps, code: code) else { return false }
        _ = try await ask(packet, "WeatherError (\(code.rawValue))")
        info("Weather error sent to the watch: \(code.rawValue)")
        return true
    }

    /// SendWeatherDeviceRequest: GB's answer to a watch weather message that is not a request (`addToResponse = false`).
    public func acknowledge() async throws {
        try await session.send(Weather.WeatherDeviceRequest.request(responseValue: Weather.resultSuccess), label: "WeatherDeviceRequest ack")
    }

    private func ask(_ packet: HuaweiPacket, _ label: String) async throws -> HuaweiPacket {
        let response = try await session.request(packet, timeoutMs: Timeouts.queryMs, label: label)
        if let code = try? response.tlv?.int(0x7F), code != HuaweiWeatherSender.okReplyCode {
            info("\(label): reply code " + hex32(code))
        }
        return response
    }

    private func hex32(_ value: Int32) -> String { hex(UInt32(bitPattern: value), width: 8) }

    /// `0x%0Nx`.
    private func hex(_ value: UInt32, width: Int) -> String {
        let digits = String(value, radix: 16)
        return "0x" + String(repeating: "0", count: max(0, width - digits.count)) + digits
    }

    /// `Instant.toString()` for whole seconds.
    private func iso8601(_ epochSec: Int64) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(epochSec)))
    }
}

/// Error codes of the weather feature (`WeatherErrorCodes` in WeatherController.kt) and what the watch is told for each.
public enum WeatherErrorCodes {
    public static func watchError(_ code: ErrorCode) -> Weather.ErrorCode? {
        switch code {
        case .weatherLocation: return .gpsPermissionError
        case .weatherNetwork: return .networkError
        case .weatherDisabled: return .weatherDisabled
        default: return nil
        }
    }
}

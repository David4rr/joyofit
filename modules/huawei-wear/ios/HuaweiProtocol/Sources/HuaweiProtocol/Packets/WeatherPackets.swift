// Port of Weather.java (service 0x0f) and of the Kotlin CurrentGpsRequest (GpsAndTime 0x18/0x07) that GB sends after the current weather.
// A Java request class becomes a `request(...)` function with the Java flags (encrypted and sliced unless the constructor says otherwise);
// a Java `Response` becomes a `Response: PacketResponse` whose `init(packet:)` is `parseTlv()` (same failure classes as the Java, see
// DeviceConfigPackets.swift). Quirks are kept: the icon byte table, the wind word, the rounding of the UV index, `Settings` gating every tag.
import Foundation

public enum Weather {
    public static let id: UInt8 = 0x0F

    /// `Weather.Settings`: what the watch told the phone it can show (WeatherSupport 0f/02, WeatherExtendedSupport 0f/06, WeatherSunMoonSupport 0f/0a,
    /// and ExpandCapability bits for the UV index and the extended hourly forecast). Nothing is sent that the watch did not announce.
    public struct Settings: Equatable, Sendable {
        public var weatherSupported = false
        public var windSupported = false
        public var pm25Supported = false
        public var temperatureSupported = false
        public var locationNameSupported = false
        public var currentTemperatureSupported = false
        public var unitSupported = false
        public var airQualityIndexSupported = false
        public var timeSupported = false
        public var sourceSupported = false
        public var weatherIconSupported = false
        public var extendedHourlyForecast = false
        public var sunRiseSetSupported = false
        public var moonPhaseSupported = false
        public var uvIndexSupported = false

        public init() {}
    }

    /// `Weather.WeatherIcon`; the raw value is the Java enum name (it is also what `WeatherStatus.lastCondition` reports).
    public enum Icon: String, CaseIterable, Sendable {
        case sunny = "SUNNY"
        case cloudy = "CLOUDY"
        case overcast = "OVERCAST"
        case showers = "SHOWERS"
        case thunderstorms = "THUNDERSTORMS"
        case thunderAndHail = "THUNDER_AND_HAIL"
        case sleet = "SLEET"
        case lightRain = "LIGHT_RAIN"
        case rain = "RAIN"
        case heavyRain = "HEAVY_RAIN"
        case rainStorm = "RAIN_STORM"
        case heavyRainStorms = "HEAVY_RAIN_STORMS"
        case severeRainStorms = "SEVERE_RAIN_STORMS"
        case snowFlurries = "SNOW_FLURRIES"
        case lightSnow = "LIGHT_SNOW"
        case snow = "SNOW"
        case heavySnow = "HEAVY_SNOW"
        case snowstorms = "SNOWSTORMS"
        case fog = "FOG"
        case freezingRain = "FREEZING_RAIN"
        case dustStorm = "DUST_STORM"
        case lightToModerateRain = "LIGHT_TO_MODERATE_RAIN"
        case moderateToHeavyRain = "MODERATE_TO_HEAVY_RAIN"
        case heavyToSevereRain = "HEAVY_TO_SEVERE_RAIN"
        case heavyToTorrentialRain = "HEAVY_TO_TORRENTIAL_RAIN"
        case severeToTorrentialRain = "SEVERE_TO_TORRENTIAL_RAIN"
        case lightToModerateSnow = "LIGHT_TO_MODERATE_SNOW"
        case moderateToHeavySnow = "MODERATE_TO_HEAVY_SNOW"
        case heavySnowToBlizzard = "HEAVY_SNOW_TO_BLIZZARD"
        case dust = "DUST"
        case sand = "SAND"
        case sandstorms = "SANDSTORMS"
        case freezing = "FREEZING"
        case hot = "HOT"
        case cold = "COLD"
        case windy = "WINDY"
        case hazy = "HAZY"
        case unknown = "UNKNOWN"

        public var name: String { rawValue }

        /// `iconToByte`: the first 36 are consecutive from 0x00, HAZY is 0x35, anything else 0x63 ("any higher and the current weather breaks").
        public var byte: UInt8 {
            switch self {
            case .hazy: return 0x35
            case .unknown: return 0x63
            default: return UInt8(Icon.allCases.firstIndex(of: self)!)
            }
        }
    }

    public enum TemperatureFormat: String, Sendable {
        case celsius = "CELSIUS"
        case fahrenheit = "FAHRENHEIT"

        var byte: UInt8 { self == .fahrenheit ? 1 : 0 }
    }

    /// `Weather.MoonPhase`, in the order of the watch's byte (1 to 8).
    public enum MoonPhase: String, CaseIterable, Sendable {
        case newMoon = "NEW_MOON"
        case waxingCrescent = "WAXING_CRESCENT"
        case firstQuarter = "FIRST_QUARTER"
        case waxingGibbous = "WAXING_GIBBOUS"
        case fullMoon = "FULL_MOON"
        case waningGibbous = "WANING_GIBBOUS"
        case thirdQuarter = "THIRD_QUARTER"
        case waningCrescent = "WANING_CRESCENT"

        var byte: UInt8 { UInt8(MoonPhase.allCases.firstIndex(of: self)! + 1) }
    }

    /// `degreesToMoonPhase`: nil outside 0...360, with six degrees of leeway around the four principal phases.
    public static func degreesToMoonPhase(_ degrees: Int) -> MoonPhase? {
        let leeway = 6
        if degrees < 0 || degrees > 360 { return nil }
        if degrees >= 360 - leeway || degrees <= leeway { return .newMoon }
        if degrees < 90 { return .waxingCrescent }
        if degrees <= 90 + leeway { return .firstQuarter }
        if degrees < 180 - leeway { return .waxingGibbous }
        if degrees <= 180 + leeway { return .fullMoon }
        if degrees < 270 - leeway { return .waningGibbous }
        if degrees <= 270 + leeway { return .thirdQuarter }
        return .waningCrescent
    }

    /// `convertWindDirection`: no wind (outside 0...360) 0, NE 1, E 2, SE 3, S 4, SW 5, W 6, NW 7, N 8. The Java `(int)(degrees / 45.0 + 0.5)`
    /// truncates toward zero, and 0 comes out as 8 (north), so an out-of-range direction is the only way to send "no wind".
    static func windDirectionCode(_ degrees: Int32) -> Int {
        if degrees < 0 || degrees > 360 { return 0 }
        let value = Int(Double(degrees) / 45.0 + 0.5) % 8
        return value == 0 ? 8 : value
    }

    public enum ErrorCode: String, Sendable {
        case networkError = "NETWORK_ERROR"
        case gpsPermissionError = "GPS_PERMISSION_ERROR"
        case weatherDisabled = "WEATHER_DISABLED"

        var byte: UInt8 {
            switch self {
            case .networkError: return 0
            case .gpsPermissionError: return 1
            case .weatherDisabled: return 2
            }
        }
    }

    // MARK: 0f/01 current weather

    public enum CurrentWeatherRequest {
        public static let id: UInt8 = 0x01

        /// `CurrentWeatherRequest`: every tag is gated by `settings` (and by the value being present). Temperatures are Celsius bytes; the unit tag
        /// is what makes the watch display Fahrenheit.
        public static func request(
            settings: Settings,
            icon: Icon?,
            windDirection: Int32?,
            windSpeed: Int8?,
            lowestTemperature: Int8?,
            highestTemperature: Int8?,
            pm25: Int16?,
            locationName: String?,
            currentTemperature: Int8?,
            temperatureUnit: TemperatureFormat?,
            airQualityIndex: Int16?,
            observationTime: Int32?,
            uvIndex: Float?,
            sourceName: String?,
            humidity: Int8?,
            windSpeedValue: Int32?,
            feelLikeTemperature: Int32?
        ) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            var tlv81 = HuaweiTLV()

            if let icon, settings.weatherIconSupported {
                tlv81.put(0x02, byte: icon.byte)
            }

            if settings.windSupported {
                var wind: Int16 = 0
                if let windSpeed { wind = Int16(windSpeed) }
                if let windDirection { wind |= Int16(truncatingIfNeeded: windDirectionCode(windDirection) << 8) }
                tlv81.put(0x03, short: wind)
            }

            if settings.weatherIconSupported || settings.windSupported { tlv.put(0x81, tlv: tlv81) }

            if let lowestTemperature, let highestTemperature, settings.temperatureSupported {
                var range = HuaweiTLV()
                range.put(0x06, byte: UInt8(bitPattern: lowestTemperature))
                range.put(0x07, byte: UInt8(bitPattern: highestTemperature))
                tlv.put(0x85, tlv: range)
            }
            if let pm25, settings.pm25Supported { tlv.put(0x04, short: pm25) }
            if let locationName, settings.locationNameSupported { tlv.put(0x08, string: locationName) }
            if let currentTemperature, settings.currentTemperatureSupported { tlv.put(0x09, byte: UInt8(bitPattern: currentTemperature)) }
            if let temperatureUnit, settings.unitSupported { tlv.put(0x0A, byte: temperatureUnit.byte) }
            if let airQualityIndex, settings.airQualityIndexSupported { tlv.put(0x0B, short: airQualityIndex) }
            if let observationTime, settings.timeSupported { tlv.put(0x0C, int: observationTime) }
            if let sourceName, settings.sourceSupported { tlv.put(0x0E, string: sourceName) }
            if let uvIndex, settings.uvIndexSupported {
                // (byte) Math.round(float): floor(x + 1/2) exactly, saturated to an int, then cut to a byte.
                tlv.put(0x0F, byte: UInt8(truncatingIfNeeded: javaRound(Double(uvIndex))))
            }

            if settings.extendedHourlyForecast {
                if let humidity { tlv.put(0x10, byte: UInt8(bitPattern: humidity)) }
                if let windSpeedValue { tlv.put(0x11, int: windSpeedValue) }
                if let feelLikeTemperature { tlv.put(0x12, int: feelLikeTemperature) }
            }

            return HuaweiPacket(serviceId: Weather.id, commandId: id, tlv: tlv, isEncrypted: true, isSliced: true, complete: true)
        }
    }

    /// `Math.round(double)` as an `Int32` (the `float` overload of Java gives the same for every float): half rounds up, NaN is 0, saturates.
    static func javaRound(_ value: Double) -> Int32 {
        if value.isNaN { return 0 }
        let rounded = (value + 0.5).rounded(.down)
        if rounded >= Double(Int32.max) { return Int32.max }
        if rounded <= Double(Int32.min) { return Int32.min }
        return Int32(rounded)
    }

    // MARK: 0f/02 support

    public enum WeatherSupport {
        public static let id: UInt8 = 0x02

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            return HuaweiPacket(serviceId: Weather.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var supportedBitmap: Int8 = 0
            public var weatherSupported = false
            public var windSupported = false
            public var pm25Supported = false
            public var temperatureSupported = false
            public var locationNameSupported = false
            public var currentTemperatureSupported = false
            public var unitSupported = false
            public var airQualityIndexSupported = false

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WeatherSupport")
                try PacketsJava.parsing("WeatherSupport") {
                    guard tlv.contains(0x01) else { throw PacketError.missingTag(0x01) }
                    let raw = try tlv.bytes(0x01)
                    // getByte() reads element 0 of the value: an empty value is an ArrayIndexOutOfBoundsException.
                    guard let first = raw.first else { throw TLVError.malformed("ArrayIndexOutOfBoundsException: tag 1 is empty") }
                    supportedBitmap = Int8(bitPattern: first)
                    weatherSupported = first & 0x01 != 0
                    windSupported = first & 0x02 != 0
                    pm25Supported = first & 0x04 != 0
                    temperatureSupported = first & 0x08 != 0
                    locationNameSupported = first & 0x10 != 0
                    currentTemperatureSupported = first & 0x20 != 0
                    unitSupported = first & 0x40 != 0
                    airQualityIndexSupported = first & 0x80 != 0
                }
            }
        }
    }

    // MARK: 0f/04 the watch asks, the phone answers

    /// The packet the watch pushes on 0f/04 (TLV 0x7F = `Weather.watchRequestCode` when it wants weather), and the phone's acknowledgement.
    public enum WeatherDeviceRequest {
        public static let id: UInt8 = 0x04

        /// `WeatherDeviceRequest`: not encrypted (the watch's own message is). `responseValue` is HuaweiConstants.RESULT_SUCCESS_INT in practice.
        public static func request(responseValue: Int32) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, int: responseValue)
            return HuaweiPacket(serviceId: Weather.id, commandId: id, tlv: tlv, isEncrypted: false, isSliced: true, complete: true)
        }
    }

    /// `HuaweiConstants.RESULT_SUCCESS_INT`.
    public static let resultSuccess: Int32 = 0x000186A0

    // MARK: 0f/05 unit

    public enum WeatherUnitRequest {
        public static let id: UInt8 = 0x05

        public static func request(temperatureFormat: TemperatureFormat) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: temperatureFormat.byte)
            return HuaweiPacket(serviceId: Weather.id, commandId: id, tlv: tlv)
        }
    }

    // MARK: 0f/06 extended support

    public enum WeatherExtendedSupport {
        public static let id: UInt8 = 0x06

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            return HuaweiPacket(serviceId: Weather.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var supportedBitmap: Int16 = 0
            public var timeSupported = false
            public var sourceSupported = false
            public var weatherIconSupported = false

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WeatherExtendedSupport")
                try PacketsJava.parsing("WeatherExtendedSupport") {
                    guard tlv.contains(0x01) else { throw PacketError.missingTag(0x01) }
                    // getShort(): a value of fewer than two bytes is a BufferUnderflowException.
                    let raw = try tlv.bytes(0x01)
                    guard raw.count >= 2 else { throw TLVError.malformed("BufferUnderflowException: tag 1 has \(raw.count) bytes, wanted a short") }
                    supportedBitmap = try tlv.short(0x01)
                    timeSupported = supportedBitmap & 0x01 != 0
                    sourceSupported = supportedBitmap & 0x02 != 0
                    weatherIconSupported = supportedBitmap & 0x04 != 0
                }
            }
        }
    }

    // MARK: 0f/07 error (simple) and 0f/0c error (extended)

    public enum WeatherErrorSimple {
        public static let id: UInt8 = 0x07

        public static func request(errorCode: ErrorCode) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: errorCode.byte)
            return HuaweiPacket(serviceId: Weather.id, commandId: id, tlv: tlv)
        }
    }

    public enum WeatherErrorExtended {
        public static let id: UInt8 = 0x0C

        public static func request(errorCode: ErrorCode, serverError: Bool) -> HuaweiPacket {
            var inner = HuaweiTLV()
            inner.put(0x02, byte: errorCode.byte)
            if errorCode == .networkError && serverError { inner.put(0x03, byte: 0x01) }
            var tlv = HuaweiTLV()
            tlv.put(0x81, tlv: inner)
            return HuaweiPacket(serviceId: Weather.id, commandId: id, tlv: tlv)
        }
    }

    // MARK: 0f/08 forecast

    public enum WeatherForecastData {
        public static let id: UInt8 = 0x08

        public struct TimeData: Equatable, Sendable {
            public var timestamp: Int32
            public var icon: Icon?
            public var temperature: Int8?
            public var precipitation: Int8?
            public var uvIndex: Int8?

            public init(timestamp: Int32, icon: Icon? = nil, temperature: Int8? = nil, precipitation: Int8? = nil, uvIndex: Int8? = nil) {
                self.timestamp = timestamp
                self.icon = icon
                self.temperature = temperature
                self.precipitation = precipitation
                self.uvIndex = uvIndex
            }
        }

        public struct DayData: Equatable, Sendable {
            public var timestamp: Int32
            public var icon: Icon?
            public var highTemperature: Int8?
            public var lowTemperature: Int8?
            public var sunriseTime: Int32?
            public var sunsetTime: Int32?
            public var moonRiseTime: Int32?
            public var moonSetTime: Int32?
            public var moonPhase: MoonPhase?

            public init(
                timestamp: Int32, icon: Icon? = nil, highTemperature: Int8? = nil, lowTemperature: Int8? = nil, sunriseTime: Int32? = nil,
                sunsetTime: Int32? = nil, moonRiseTime: Int32? = nil, moonSetTime: Int32? = nil, moonPhase: MoonPhase? = nil
            ) {
                self.timestamp = timestamp
                self.icon = icon
                self.highTemperature = highTemperature
                self.lowTemperature = lowTemperature
                self.sunriseTime = sunriseTime
                self.sunsetTime = sunsetTime
                self.moonRiseTime = moonRiseTime
                self.moonSetTime = moonSetTime
                self.moonPhase = moonPhase
            }
        }

        /// `WeatherForecastData.Request`: hours under 0x81/0x82, days under 0x90/0x91, each tag gated by `settings`. Sliced and encrypted.
        public static func request(settings: Settings, hours: [TimeData]?, days: [DayData]?) -> HuaweiPacket {
            var tlv = HuaweiTLV()

            if let hours, !hours.isEmpty {
                var list = HuaweiTLV()
                for hour in hours {
                    var item = HuaweiTLV()
                    item.put(0x03, int: hour.timestamp)
                    if let icon = hour.icon, settings.weatherIconSupported { item.put(0x04, byte: icon.byte) }
                    if let temperature = hour.temperature, settings.temperatureSupported || settings.currentTemperatureSupported {
                        item.put(0x05, byte: UInt8(bitPattern: temperature))
                    }
                    if settings.extendedHourlyForecast {
                        if let precipitation = hour.precipitation { item.put(0x06, byte: UInt8(bitPattern: precipitation)) }
                        if let uvIndex = hour.uvIndex { item.put(0x07, byte: UInt8(bitPattern: uvIndex)) }
                    }
                    list.put(0x82, tlv: item)
                }
                tlv.put(0x81, tlv: list)
            }

            if let days, !days.isEmpty {
                var list = HuaweiTLV()
                for day in days {
                    var item = HuaweiTLV()
                    item.put(0x12, int: day.timestamp)
                    if let icon = day.icon, settings.weatherIconSupported { item.put(0x13, byte: icon.byte) }
                    if settings.temperatureSupported {
                        if let high = day.highTemperature { item.put(0x14, byte: UInt8(bitPattern: high)) }
                        if let low = day.lowTemperature { item.put(0x15, byte: UInt8(bitPattern: low)) }
                    }
                    if settings.sunRiseSetSupported {
                        if let sunrise = day.sunriseTime, sunrise != 0 { item.put(0x16, int: sunrise) }
                        if let sunset = day.sunsetTime, sunset != 0 { item.put(0x17, int: sunset) }
                        if let moonRise = day.moonRiseTime, moonRise != 0 { item.put(0x1A, int: moonRise) }
                        if let moonSet = day.moonSetTime, moonSet != 0 { item.put(0x1B, int: moonSet) }
                    }
                    if let phase = day.moonPhase, settings.moonPhaseSupported { item.put(0x1E, byte: phase.byte) }
                    list.put(0x91, tlv: item)
                }
                tlv.put(0x90, tlv: list)
            }

            return HuaweiPacket(serviceId: Weather.id, commandId: id, tlv: tlv, isEncrypted: true, isSliced: true, complete: true)
        }
    }

    // MARK: 0f/09 start

    public enum WeatherStart {
        public static let id: UInt8 = 0x09

        /// `WeatherStart.Request`: tag 1 = 3 ("TODO: find out what this means" in GB).
        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: 0x03)
            return HuaweiPacket(serviceId: Weather.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var successCode: Int32 = -1
            public var success = false

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WeatherStart")
                try PacketsJava.parsing("WeatherStart") {
                    let raw = try tlv.bytes(0x7F)
                    guard raw.count >= 4 else { throw TLVError.malformed("BufferUnderflowException: tag 127 has \(raw.count) bytes, wanted an int") }
                    successCode = try tlv.int(0x7F)
                    success = successCode == 0x000186A0 || successCode == 0x000186A3
                }
            }
        }
    }

    // MARK: 0f/0a sun and moon support

    public enum WeatherSunMoonSupport {
        public static let id: UInt8 = 0x0A

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            return HuaweiPacket(serviceId: Weather.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var supportedBitmap: Int32 = 0
            public var sunRiseSetSupported = false
            public var moonPhaseSupported = false

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WeatherSunMoonSupport")
                try PacketsJava.parsing("WeatherSunMoonSupport") {
                    guard tlv.contains(0x01) else { throw PacketError.missingTag(0x01) }
                    let raw = try tlv.bytes(0x01)
                    guard raw.count >= 4 else { throw TLVError.malformed("BufferUnderflowException: tag 1 has \(raw.count) bytes, wanted an int") }
                    supportedBitmap = try tlv.int(0x01)
                    sunRiseSetSupported = supportedBitmap & 0x01 != 0
                    moonPhaseSupported = supportedBitmap & 0x02 != 0
                }
            }
        }
    }
}

/// GpsAndTime (service 0x18) command 0x07: the phone's position and a timestamp, sent after the current weather. In Android this class lives in
/// HuaweiWeather.kt (GB's `GpsAndTime.CurrentGPSRequest` is not vendored).
public enum GpsAndTime {
    public static let id: UInt8 = 0x18

    public enum CurrentGPSRequest {
        public static let id: UInt8 = 0x07

        public static func request(timestamp: Int32, latitude: Double, longitude: Double) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, int: timestamp)
            tlv.put(0x02, double: latitude)
            tlv.put(0x03, double: longitude)
            return HuaweiPacket(serviceId: GpsAndTime.id, commandId: id, tlv: tlv)
        }
    }
}

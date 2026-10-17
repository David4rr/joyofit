// Shared vocabulary of the native layer; wire names match HuaweiWear.types.ts and the Android WearTypes.kt.
import Foundation

public enum LinkState: String, Sendable {
    case disconnected, connecting, authenticating, initializing, connected, syncing
}

public enum AuthMode: String, Sendable {
    case normal
    case hichainLite = "hichain-lite"
    case hichain
    case hichain3
}

public enum LogDirection: String, Sendable {
    case tx, rx, info, error
}

public enum ErrorCode: String, Sendable {
    case bluetoothPermission = "ERR_BLUETOOTH_PERMISSION"
    case bluetoothUnavailable = "ERR_BLUETOOTH_UNAVAILABLE"
    case bluetoothOff = "ERR_BLUETOOTH_OFF"
    case invalidAddress = "ERR_INVALID_ADDRESS"
    case notConnected = "ERR_NOT_CONNECTED"
    case busy = "ERR_BUSY"
    case connectFailed = "ERR_CONNECT_FAILED"
    case disconnected = "ERR_DISCONNECTED"
    case authFailed = "ERR_AUTH_FAILED"
    case deviceStatus = "ERR_DEVICE_STATUS"
    case timeout = "ERR_TIMEOUT"
    case protocolError = "ERR_PROTOCOL"
    case storage = "ERR_STORAGE"
    case invalidArgument = "ERR_INVALID_ARGUMENT"
    case unsupported = "ERR_UNSUPPORTED"
    /// A 1-minute HRV measurement gave too few clean beats to compute a reading.
    case hrvTooFewBeats = "ERR_HRV_TOO_FEW_BEATS"
    /// The measurement was cancelled with `cancelHrvMeasurement`.
    case hrvCancelled = "ERR_HRV_CANCELLED"
    /// The calibration minute of the automatic stress switch could not be scored.
    case stressCalibration = "ERR_STRESS_CALIBRATION"
    /// The watch answered the automatic stress setting with an error code.
    case stressRejected = "ERR_STRESS_REJECTED"
    case uploadRejected = "ERR_UPLOAD_REJECTED"
    /// Weather: no position (permission missing, no fix yet, no city chosen). Sent to the watch as GPS_PERMISSION_ERROR.
    case weatherLocation = "ERR_WEATHER_LOCATION"
    /// Weather: Open-Meteo unreachable or answering garbage. Sent to the watch as NETWORK_ERROR.
    case weatherNetwork = "ERR_WEATHER_NETWORK"
    /// Weather: the switch is off. Sent to the watch as WEATHER_DISABLED.
    case weatherDisabled = "ERR_WEATHER_DISABLED"
    /// Huawei import: the ZIP password is wrong or missing.
    case importPassword = "ERR_IMPORT_PASSWORD"
    /// Huawei import: the file is not a ZIP, or not a Huawei Health export.
    case importFormat = "ERR_IMPORT_FORMAT"
    /// `connect` stopped before a first bind: the watch does not know this phone, and a bind replaces its current phone pairing. Nothing on
    /// the watch changed; the app asks the user, then calls `confirmBind` and connects again.
    case bindConfirmation = "ERR_BIND_CONFIRMATION"
}

/// Every failure that reaches JS: a coded error like the Android `WearException`.
public struct WearError: Error, CustomStringConvertible, @unchecked Sendable {
    public let code: ErrorCode
    public let message: String
    public let underlying: Error?
    /// True when the response arrived but could not be read (GB `ParseException`): `ActivitySync` skips such a response.
    public let isParseFailure: Bool
    /// The watch's own status code when the failure is its answer (`ERR_UPLOAD_REJECTED`), like the Android `WearException.statusCode`.
    public let statusCode: Int?

    public init(_ code: ErrorCode, _ message: String, underlying: Error? = nil, isParseFailure: Bool = false, statusCode: Int? = nil) {
        self.code = code
        self.message = message
        self.underlying = underlying
        self.isParseFailure = isParseFailure
        self.statusCode = statusCode
    }

    public var description: String { "\(code.rawValue): \(message)" }
}

public struct LogEntry: Sendable {
    public var direction: LogDirection
    public var serviceId: Int?
    public var commandId: Int?
    public var hex: String?
    public var message: String

    public init(_ direction: LogDirection, service: Int? = nil, command: Int? = nil, hex: String? = nil, _ message: String) {
        self.direction = direction
        self.serviceId = service
        self.commandId = command
        self.hex = hex
        self.message = message
    }
}

/// Where protocol layers send log lines (the module turns them into `onLog`).
public typealias LogSink = @Sendable (LogEntry) -> Void

extension UInt8 {
    /// `0x%02x`, Kotlin `hex2()`.
    public var hex2: String { "0x" + (self < 16 ? "0" : "") + String(self, radix: 16) }
}

/// GB `HuaweiCoordinator.HuaweiDeviceType`. The Fit 4 Pro over Bluetooth LE is `.ble`.
public enum HuaweiDeviceType: Int, Sendable {
    case aw = 0
    case br = 1
    case ble = 2
    case smart = 5
}

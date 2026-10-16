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
    case uploadRejected = "ERR_UPLOAD_REJECTED"
    /// Weather: no position (permission missing, no fix yet, no city chosen). Sent to the watch as GPS_PERMISSION_ERROR.
    case weatherLocation = "ERR_WEATHER_LOCATION"
    /// Weather: Open-Meteo unreachable or answering garbage. Sent to the watch as NETWORK_ERROR.
    case weatherNetwork = "ERR_WEATHER_NETWORK"
    /// Weather: the switch is off. Sent to the watch as WEATHER_DISABLED.
    case weatherDisabled = "ERR_WEATHER_DISABLED"
}

/// Every failure that reaches JS: a coded error like the Android `WearException`.
public struct WearError: Error, CustomStringConvertible, @unchecked Sendable {
    public let code: ErrorCode
    public let message: String
    public let underlying: Error?
    /// True when the response arrived but could not be read (GB `ParseException`): `ActivitySync` skips such a response.
    public let isParseFailure: Bool

    public init(_ code: ErrorCode, _ message: String, underlying: Error? = nil, isParseFailure: Bool = false) {
        self.code = code
        self.message = message
        self.underlying = underlying
        self.isParseFailure = isParseFailure
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

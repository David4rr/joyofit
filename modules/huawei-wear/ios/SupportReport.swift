// Port of SupportReport.kt: the log lines kept for the support report and the report itself. Pure logic (Foundation only).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

/// The watch as `connect` returns it (`DeviceInfo` in HuaweiWear.types.ts).
public struct WatchDeviceInfo: Equatable, Sendable {
    public var address: String
    public var name: String
    public var productModel: String?
    public var softwareVersion: String?
    public var hardwareVersion: String?
    public var serialNumber: String?
    public var batteryLevel: Int?
    public var authMode: AuthMode
    /// See `BondedDevice.model`.
    public var model: String?
    public var support: ModelSupport

    public init(
        address: String, name: String, productModel: String?, softwareVersion: String?, hardwareVersion: String?, serialNumber: String?,
        batteryLevel: Int?, authMode: AuthMode, model: String?, support: ModelSupport
    ) {
        self.address = address
        self.name = name
        self.productModel = productModel
        self.softwareVersion = softwareVersion
        self.hardwareVersion = hardwareVersion
        self.serialNumber = serialNumber
        self.batteryLevel = batteryLevel
        self.authMode = authMode
        self.model = model
        self.support = support
    }

    public func toJS() -> [String: Any] {
        [
            "address": address,
            "name": name,
            "productModel": productModel ?? NSNull(),
            "softwareVersion": softwareVersion ?? NSNull(),
            "hardwareVersion": hardwareVersion ?? NSNull(),
            "serialNumber": serialNumber ?? NSNull(),
            "batteryLevel": batteryLevel ?? NSNull(),
            "authMode": authMode.rawValue,
            "model": model ?? NSNull(),
            "support": support.rawValue,
        ]
    }
}

/// Log lines kept in the process for the support report, so it also covers connects no screen saw (the background session). The lines of
/// the last connect attempt are kept apart from the rolling tail: a day of syncs cannot push out what the watch answered while connecting,
/// which is what a report on a new model is for.
public final class SupportLog: @unchecked Sendable {
    public struct Line: Equatable, Sendable {
        public let seq: Int
        public let atMs: Int64
        public let text: String
    }

    public static let connectLines = 600
    public static let tailLines = 400

    private let lock = NSLock()
    private var connect: [Line] = []
    private var tail: [Line] = []
    private var seq = 0

    public init() {}

    /// A connect attempt starts: from here, lines also go to the connect part until it is full.
    public func connectStarted() {
        lock.lock()
        connect = []
        lock.unlock()
    }

    public func add(_ text: String, atMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        lock.lock()
        defer { lock.unlock() }
        let line = Line(seq: seq, atMs: atMs, text: text)
        seq += 1
        if connect.count < SupportLog.connectLines { connect.append(line) }
        tail.append(line)
        if tail.count > SupportLog.tailLines { tail.removeFirst() }
    }

    /// The connect part and the tail, oldest first, each line once.
    public func lines() -> [Line] {
        lock.lock()
        defer { lock.unlock() }
        var seen = Set<Int>()
        return (connect + tail).filter { seen.insert($0.seq).inserted }.sorted { $0.seq < $1.seq }
    }
}

public enum SupportReport {
    /// What the app and the phone are; the module fills it from the bundle and `uname`.
    public struct Environment: Sendable {
        public var app: String
        public var phone: String

        public init(app: String, phone: String) {
            self.app = app
            self.phone = phone
        }
    }

    private static let macPattern = try! NSRegularExpression(pattern: "\\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\\b", options: [.caseInsensitive])
    private static let serialPattern = try! NSRegularExpression(pattern: "serial=\\S+", options: [.caseInsensitive])

    /// Bluetooth addresses, CoreBluetooth peripheral identifiers (`identifiers`) and the serial number are left out: the report is shared with
    /// people outside the app.
    public static func redact(_ text: String, serial: String?, identifiers: [String] = []) -> String {
        var out = text
        out = macPattern.stringByReplacingMatches(in: out, range: NSRange(out.startIndex..., in: out), withTemplate: "XX:XX:XX:XX:XX:XX")
        out = serialPattern.stringByReplacingMatches(in: out, range: NSRange(out.startIndex..., in: out), withTemplate: "serial=(left out)")
        if let serial, !serial.trimmingCharacters(in: .whitespaces).isEmpty, serial.count >= 4 {
            out = out.replacingOccurrences(of: serial, with: "(serial left out)")
        }
        for identifier in identifiers where identifier.count >= 8 {
            out = out.replacingOccurrences(of: identifier, with: "(device id left out)", options: .caseInsensitive)
        }
        return out
    }

    /// `SupportReport` in HuaweiWear.types.ts: the summary (fits a GitHub issue link) apart from the long log.
    public static func build(
        environment: Environment,
        watchName: String?,
        device: WatchDeviceInfo?,
        linkState: String,
        log: [SupportLog.Line],
        caps: DeviceCaps?,
        transport: ModelTransport? = .le,
        identifiers: [String] = [],
        nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        extraSummary: [String] = []
    ) -> [String: Any] {
        let serial = device?.serialNumber
        let name = device?.name ?? watchName
        let match = WatchModels.match(name)
        let stamp = DateFormatter()
        stamp.locale = Locale(identifier: "en_US_POSIX")
        stamp.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
        let clock = DateFormatter()
        clock.locale = Locale(identifier: "en_US_POSIX")
        clock.dateFormat = "HH:mm:ss.SSS"

        var summary = [String]()
        summary.append("JoyoFit support report")
        summary.append("Created: \(stamp.string(from: Date(timeIntervalSince1970: Double(nowMs) / 1000)))")
        summary.append("App: \(environment.app)")
        summary.append("Phone: \(environment.phone)")
        summary.append("Watch: \(name ?? "none yet")")
        summary.append("Model: \(match.model?.name ?? "not in the list") (\(match.support.rawValue))")
        if let device {
            summary.append(
                "Product: \(device.productModel ?? "?"), software \(device.softwareVersion ?? "?"), " +
                    "hardware \(device.hardwareVersion ?? "?"), auth \(device.authMode.rawValue)"
            )
        }
        summary.append("Transport: \(transport?.label ?? "none yet")")
        summary.append("Link: \(linkState)")
        if let commands = caps?.supportedCommands, !commands.isEmpty {
            summary.append("Supported commands (last connect, service: commands):")
            for service in commands.keys.sorted() {
                let list = commands[service]!.map { SupportReport.hex2(Int($0)) }.joined(separator: " ")
                summary.append("  \(SupportReport.hex2(service)): \(list)")
            }
        }
        summary.append("ExpandCapability: \(caps?.expandCapabilities?.hexUpper ?? "none")")
        summary.append(contentsOf: extraSummary)
        // The last line has no trailing newline in the Kotlin builder.
        let summaryText = summary.joined(separator: "\n") + "\nBluetooth addresses and the serial number are left out."

        var text = ["Log, oldest first (\(log.count) lines):"]
        var previous: Int?
        for line in log {
            if let previous, line.seq > previous + 1 { text.append("... \(line.seq - previous - 1) lines left out ...") }
            text.append("\(clock.string(from: Date(timeIntervalSince1970: Double(line.atMs) / 1000))) \(line.text)")
            previous = line.seq
        }
        let logText = text.joined(separator: "\n") + "\n"

        return [
            "summary": redact(summaryText, serial: serial, identifiers: identifiers),
            "log": redact(logText, serial: serial, identifiers: identifiers),
            "watch": name ?? NSNull(),
            "model": match.model?.name ?? NSNull(),
            "support": match.support.rawValue,
        ]
    }

    /// The night HRV summary line. The iOS port has no night HRV sync, so the report says so and quotes what the app does know: whether the
    /// watch listed automatic stress (20/09) the last time it connected, and the switch. `listed` is nil before any connect.
    public static func nightHrvLine(listed: Bool?, enabled: Bool) -> String {
        let known = listed.map { $0 ? "yes" : "no" } ?? "unknown"
        return "Night HRV: not read on iPhone (the iOS port has no night HRV sync); automatic stress 20/09 listed=\(known) (last connect), switch=\(enabled ? "on" : "off")"
    }

    /// `%02x` without `String(format:)`, which this file avoids because `%@` is not portable to Linux.
    static func hex2(_ value: Int) -> String {
        let digits = String(value, radix: 16)
        return digits.count < 2 ? "0" + digits : digits
    }
}

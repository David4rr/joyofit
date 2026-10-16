// Sink for everything the native layer reports; fans out to JS (when running) and the support log. Port of the Kotlin WearEvents.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif
#if canImport(os)
import os
#endif

public protocol WearEvents: AnyObject, Sendable {
    func state(_ state: LinkState, error: String?)
    func battery(_ level: Int)
    /// A sync finished and its rows are committed to the database.
    func syncComplete(_ summary: SyncSummary)
    func log(_ entry: LogEntry)
    /// File upload progress (`onUploadProgress`): `bytes` acknowledged by the watch of `total`.
    func uploadProgress(bytes: Int, total: Int)
    /// A watch face install finished (`onUploadResult`); `code` is the watch's status when it gave one.
    func uploadResult(ok: Bool, fileName: String, code: Int?, message: String)
}

extension WearEvents {
    public func uploadProgress(bytes: Int, total: Int) {}
    public func uploadResult(ok: Bool, fileName: String, code: Int?, message: String) {}

    public func info(_ message: String) { log(LogEntry(.info, message)) }
    public func error(_ message: String) { log(LogEntry(.error, message)) }

    /// The `LogSink` the protocol layers take.
    public var sink: LogSink { { [weak self] entry in self?.log(entry) } }
}

/// The `JoyoFitBle` / `JoyoFit` console log (Android's logcat tags): unified logging on Apple platforms, stderr elsewhere. Visible with
/// `idevicesyslog` or Console.app; the support report keeps its own copy.
public enum WearConsole {
    #if canImport(os)
    private static let bleLogger = Logger(subsystem: "com.joyodigitama.joyofit", category: "JoyoFitBle")
    private static let generalLogger = Logger(subsystem: "com.joyodigitama.joyofit", category: "JoyoFit")
    #endif

    public static func ble(_ message: String) {
        #if canImport(os)
        bleLogger.notice("\(message, privacy: .public)")
        #else
        FileHandle.standardError.write(Data("JoyoFitBle: \(message)\n".utf8))
        #endif
    }

    public static func general(_ message: String, error: Bool = false) {
        #if canImport(os)
        if error { generalLogger.error("\(message, privacy: .public)") } else { generalLogger.notice("\(message, privacy: .public)") }
        #else
        FileHandle.standardError.write(Data("JoyoFit: \(message)\n".utf8))
        #endif
    }
}

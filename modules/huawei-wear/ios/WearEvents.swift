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
    /// A live heart-rate reading the watch pushed (`onHeartRate`); `tsMs` is the phone's receive time.
    func heartRate(bpm: Int, tsMs: Int64)
    /// `onHrvProgress`: the minute counts down while the watch sends intervals; `beats` are the ones with a usable signal.
    func hrvProgress(secondsLeft: Int, beats: Int)
}

extension WearEvents {
    public func heartRate(bpm: Int, tsMs: Int64) {}
    public func hrvProgress(secondsLeft: Int, beats: Int) {}

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

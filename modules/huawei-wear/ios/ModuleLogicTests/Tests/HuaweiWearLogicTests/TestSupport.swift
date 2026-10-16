import Foundation
import XCTest
@testable import HuaweiWearLogic

/// Records everything a WearEvents sink receives.
final class RecordingEvents: WearEvents, @unchecked Sendable {
    private let lock = NSLock()
    private var _states: [(LinkState, String?)] = []
    private var _logs: [LogEntry] = []
    private var _batteries: [Int] = []
    private var _syncs: [SyncSummary] = []
    private var _heartRates: [(bpm: Int, tsMs: Int64)] = []
    private var _hrvProgress: [(secondsLeft: Int, beats: Int)] = []

    var states: [(LinkState, String?)] { lock.locked { _states } }
    var stateNames: [String] { states.map { $0.0.rawValue } }
    var logs: [LogEntry] { lock.locked { _logs } }
    var batteries: [Int] { lock.locked { _batteries } }
    var syncs: [SyncSummary] { lock.locked { _syncs } }
    var heartRates: [(bpm: Int, tsMs: Int64)] { lock.locked { _heartRates } }
    var hrvProgress: [(secondsLeft: Int, beats: Int)] { lock.locked { _hrvProgress } }

    func state(_ state: LinkState, error: String?) { lock.locked { _states.append((state, error)) } }
    func battery(_ level: Int) { lock.locked { _batteries.append(level) } }
    func syncComplete(_ summary: SyncSummary) { lock.locked { _syncs.append(summary) } }
    func log(_ entry: LogEntry) { lock.locked { _logs.append(entry) } }
    func heartRate(bpm: Int, tsMs: Int64) { lock.locked { _heartRates.append((bpm, tsMs)) } }
    func hrvProgress(secondsLeft: Int, beats: Int) { lock.locked { _hrvProgress.append((secondsLeft, beats)) } }

    func messages(_ direction: LogDirection? = nil) -> [String] {
        logs.filter { direction == nil || $0.direction == direction }.map(\.message)
    }
}

/// A UserDefaults that exists only for one test.
func ephemeralDefaults(_ name: String = #function) -> UserDefaults {
    let suite = "joyofit-test-\(name)-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

func temporaryDatabaseURL() -> URL {
    FileManager.default.temporaryDirectory
        .appendingPathComponent("joyofit-tests-\(UUID().uuidString)", isDirectory: true)
        .appendingPathComponent("SQLite", isDirectory: true)
        .appendingPathComponent("joyofit.db")
}

/// The repository root: this file is modules/huawei-wear/ios/ModuleLogicTests/Tests/HuaweiWearLogicTests/TestSupport.swift.
let repoRoot: URL = {
    if let override = ProcessInfo.processInfo.environment["JOYOFIT_REPO_ROOT"] { return URL(fileURLWithPath: override) }
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<7 { url.deleteLastPathComponent() }
    return url
}()

func sleepMs(_ ms: Int) async { try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000) }

/// Polls until `condition` holds (or fails the test after `timeoutMs`).
func eventually(timeoutMs: Int = 2_000, _ message: String = "condition", file: StaticString = #filePath, line: UInt = #line, _ condition: () -> Bool) async {
    var waited = 0
    while !condition() && waited < timeoutMs {
        await sleepMs(10)
        waited += 10
    }
    XCTAssertTrue(condition(), "timed out waiting for \(message)", file: file, line: line)
}

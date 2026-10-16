// Port of HuaweiExportImporter.kt: reads a Huawei Privacy Centre health export and writes it through a `HuaweiImportStore`.
import Foundation

/// Why an import could not start; the module turns `kind` into an error code for JS.
public struct HuaweiImportException: Error, CustomStringConvertible {
    public enum Kind: Equatable, Sendable { case badPassword, notAZip, notAnExport, storage }

    public let kind: Kind
    public let message: String
    public let underlying: Error?

    public init(_ kind: Kind, _ message: String, underlying: Error? = nil) {
        self.kind = kind
        self.message = message
        self.underlying = underlying
    }

    public var description: String { message }
}

/// One file inside the export archive.
public struct HuaweiExportEntry: Equatable {
    public let name: String
    public let size: Int64

    public init(name: String, size: Int64) {
        self.name = name
        self.size = size
    }
}

/// A member that could not be delivered (damaged data, a failed CRC): costs that file only, the import goes on. The Kotlin `IOException`.
public struct HuaweiExportReadError: Error, CustomStringConvertible {
    public let message: String

    public init(_ message: String) { self.message = message }

    public var description: String { message }
}

/// The archive of an export: its files and a way to stream one. Implemented over `ZipArchive` by `ZipExportSource`. Errors thrown by `sink` must
/// come out of `read` unchanged; the source's own failures are `HuaweiExportReadError`.
public protocol HuaweiExportSource {
    func entries() -> [HuaweiExportEntry]
    func read(_ entry: HuaweiExportEntry, into sink: (Bytes) throws -> Void) throws
}

/// Which kind of data a file holds, decided by the folder it sits in.
public enum HuaweiExportKind: Int, CaseIterable, Sendable {
    /// `Health detail data & description`: heart rate, SpO2, sleep, stress.
    case healthDetail
    /// `Sport per minute merged data & description`: steps and distance per minute.
    case sportPerMinute
    /// `Motion path detail data & description`: one object per tracked workout.
    case motionPath

    /// The kind of the archive member `name`, or nil for anything that is not one of the JSON data files.
    public static func of(_ name: String) -> HuaweiExportKind? {
        let path = name.replacingOccurrences(of: "\\", with: "/").lowercased()
        guard path.hasSuffix(".json") else { return nil }
        if path.contains("health detail data") { return .healthDetail }
        if path.contains("sport per minute") { return .sportPerMinute }
        if path.contains("motion path detail") { return .motionPath }
        return nil
    }
}

/// What an import found and wrote. Counted while it runs; `HuaweiImportProgress` hands out the live numbers.
public struct HuaweiImportSummary: Equatable {
    public var filesRead = 0
    public var filesFailed = 0
    public var filesIgnored = 0
    /// Records that were not usable JSON and could not be repaired, plus oversize ones.
    public var badRecords = 0
    /// Sample points of a known kind whose value was missing or implausible.
    public var rejectedSamples = 0
    /// Sample points of kinds the importer does not use (weight, exercise intensity ...).
    public var unmappedSamples = 0
    public var heartRateReadings = 0
    public var restingHeartRateReadings = 0
    public var spo2Readings = 0
    public var stressReadings = 0
    public var sleepSegmentsFound = 0
    /// `step_samples` rows inserted or filled in.
    public var minutesWritten = 0
    public var sleepSegmentsAdded = 0
    public var stressAdded = 0
    public var workoutsFound = 0
    public var workoutsAdded = 0
    public var workoutPointsAdded = 0
    /// Earliest and latest time (unix seconds) of anything read, for "your history reaches back to ...".
    public var oldestSec: Int64?
    public var newestSec: Int64?
    public var cancelled = false

    public init() {}

    mutating func seen(_ tsSec: Int64) {
        if oldestSec.map({ tsSec < $0 }) ?? true { oldestSec = tsSec }
        if newestSec.map({ tsSec > $0 }) ?? true { newestSec = tsSec }
    }

    /// `HuaweiImportSummary` of HuaweiWearImport.types.ts.
    public func toJS() -> [String: Any] {
        [
            "filesRead": filesRead,
            "filesFailed": filesFailed,
            "filesIgnored": filesIgnored,
            "badRecords": badRecords,
            "rejectedSamples": rejectedSamples,
            "unmappedSamples": unmappedSamples,
            "heartRateReadings": heartRateReadings,
            "restingHeartRateReadings": restingHeartRateReadings,
            "spo2Readings": spo2Readings,
            "stressReadings": stressReadings,
            "sleepSegmentsFound": sleepSegmentsFound,
            "minutesWritten": minutesWritten,
            "sleepSegmentsAdded": sleepSegmentsAdded,
            "stressAdded": stressAdded,
            "workoutsFound": workoutsFound,
            "workoutsAdded": workoutsAdded,
            "workoutPointsAdded": workoutPointsAdded,
            "oldestSec": oldestSec.map { $0 as Any } ?? NSNull(),
            "newestSec": newestSec.map { $0 as Any } ?? NSNull(),
            "cancelled": cancelled,
        ]
    }
}

/// A progress report: `phase` is `reading` while files are processed and `done` at the end.
public struct HuaweiImportProgress {
    public let phase: String
    public let fileName: String?
    public let fileIndex: Int
    public let fileCount: Int
    /// 0..1 over the uncompressed bytes of all data files.
    public let fraction: Double
    public let summary: HuaweiImportSummary

    /// `HuaweiImportProgressEvent` of HuaweiWearImport.types.ts.
    public func toJS() -> [String: Any] {
        [
            "phase": phase,
            "fileName": fileName.map { $0 as Any } ?? NSNull(),
            "fileIndex": fileIndex,
            "fileCount": fileCount,
            "fraction": fraction,
            "summary": summary.toJS(),
        ]
    }
}

/// Every file is streamed: `HuaweiExportJson.RecordScanner` cuts it into records, each record is parsed on its own and a record that fails is
/// counted in `badRecords` and skipped. Minutes, sleep segments and stress readings are buffered and flushed between records in transactions of at
/// most `flushMinutes` rows; workouts are written one by one. Cancelling stops between records; what was written stays, and running the same
/// export again only adds what is still missing.
public final class HuaweiExportImporter: HuaweiImportCollector {
    public static let flushMinutes = 20_000
    public static let flushRows = 5_000
    public static let progressIntervalMs: Int64 = 250

    private struct Cancelled: Error {}

    private let store: HuaweiImportStore
    private let onProgress: (HuaweiImportProgress) -> Void
    private let isCancelled: () -> Bool
    private let nowMs: () -> Int64

    private var summary = HuaweiImportSummary()
    private var minutes = [Int64: ImportedMinute]()
    private var sleepRows = [ImportedSleep]()
    private var stressRows = [ImportedStress]()

    private var fileIndex = 0
    private var fileCount = 0
    private var fileName: String?
    private var totalBytes: Int64 = 0
    private var doneBytes: Int64 = 0
    private var lastProgressMs: Int64 = 0

    public init(
        store: HuaweiImportStore, onProgress: @escaping (HuaweiImportProgress) -> Void, isCancelled: @escaping () -> Bool = { false },
        nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.store = store
        self.onProgress = onProgress
        self.isCancelled = isCancelled
        self.nowMs = nowMs
    }

    // MARK: collector

    private func minute(_ tsSec: Int64) -> ImportedMinute {
        summary.seen(tsSec)
        let key = tsSec / 60 * 60
        if let m = minutes[key] { return m }
        let m = ImportedMinute(key)
        minutes[key] = m
        return m
    }

    public func heartRate(tsSec: Int64, bpm: Int) {
        summary.heartRateReadings += 1
        let m = minute(tsSec)
        if m.heartRate == nil { m.heartRate = bpm }
    }

    public func restingHeartRate(tsSec: Int64, bpm: Int) {
        summary.restingHeartRateReadings += 1
        let m = minute(tsSec)
        if m.restingHeartRate == nil { m.restingHeartRate = bpm }
    }

    public func spo2(tsSec: Int64, percent: Int) {
        summary.spo2Readings += 1
        let m = minute(tsSec)
        if m.spo2 == nil { m.spo2 = percent }
    }

    public func sleep(_ segment: ImportedSleep) {
        summary.sleepSegmentsFound += 1
        summary.seen(segment.start)
        summary.seen(segment.end)
        sleepRows.append(segment)
    }

    public func stress(_ point: ImportedStress) {
        summary.stressReadings += 1
        summary.seen(point.ts)
        stressRows.append(point)
    }

    public func steps(minuteSec: Int64, steps: Int, distance: Int) {
        let m = minute(minuteSec)
        if steps > m.steps { m.steps = steps }
        if distance > m.distance { m.distance = distance }
    }

    public func unmapped(key: String) { summary.unmappedSamples += 1 }

    public func rejected() { summary.rejectedSamples += 1 }

    // MARK: run

    public func run(_ source: HuaweiExportSource) throws -> HuaweiImportSummary {
        let entries = source.entries()
        let files = entries.enumerated()
            .compactMap { index, entry in HuaweiExportKind.of(entry.name).map { (kind: $0, entry: entry, index: index) } }
            .sorted { $0.kind.rawValue != $1.kind.rawValue ? $0.kind.rawValue < $1.kind.rawValue : $0.index < $1.index }
        summary.filesIgnored = entries.count - files.count
        if files.isEmpty {
            throw HuaweiImportException(
                .notAnExport,
                "No Health data folders found in this file (expected \"Health detail data\", \"Sport per minute\" or \"Motion path detail\")"
            )
        }
        fileCount = files.count
        totalBytes = max(1, files.reduce(Int64(0)) { $0 + max(0, $1.entry.size) })
        do {
            for (index, file) in files.enumerated() {
                fileIndex = index + 1
                let name = file.entry.name
                fileName = String(name[(name.lastIndex(where: { $0 == "/" || $0 == "\\" }).map { name.index(after: $0) } ?? name.startIndex)...])
                let before = doneBytes
                do {
                    try readFile(file.kind, file.entry, source)
                    summary.filesRead += 1
                } catch is HuaweiExportReadError {
                    // A damaged or unreadable member costs that file only. Database errors are not caught: they end the import.
                    summary.filesFailed += 1
                }
                try flush()
                doneBytes = before + max(0, file.entry.size)
                report("reading", force: true)
            }
        } catch is Cancelled {
            summary.cancelled = true
            try flush()
        }
        fileName = nil
        doneBytes = totalBytes
        report("done", force: true)
        return summary
    }

    private func readFile(_ kind: HuaweiExportKind, _ entry: HuaweiExportEntry, _ source: HuaweiExportSource) throws {
        let scanner = HuaweiExportJson.RecordScanner(
            onRecord: { [unowned self] text in try handleRecord(kind, text) },
            onUnterminated: { [unowned self] text in try recover(kind, text) },
            onOversized: { [unowned self] in summary.badRecords += 1 }
        )
        try source.read(entry) { [unowned self] chunk in
            doneBytes += Int64(chunk.count)
            try scanner.feed(chunk)
        }
        try scanner.finish()
    }

    private func handleRecord(_ kind: HuaweiExportKind, _ text: Bytes) throws {
        if isCancelled() { throw Cancelled() }
        if let record = HuaweiExportJson.parseObject(text) {
            switch kind {
            case .healthDetail: HuaweiHealthDetailParser.parse(record, into: self)
            case .sportPerMinute: HuaweiSportPerMinuteParser.parse(record, into: self)
            case .motionPath:
                if let workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(record)) {
                    try writeWorkout(workout)
                } else {
                    summary.badRecords += 1
                }
            }
        } else {
            try recover(kind, text)
        }
        if minutes.count >= HuaweiExportImporter.flushMinutes || sleepRows.count >= HuaweiExportImporter.flushRows
            || stressRows.count >= HuaweiExportImporter.flushRows
        {
            try flush()
        }
        report("reading", force: false)
    }

    /// A record that is not valid JSON. Motion paths are read off the raw text (the line records inside do not need the JSON around them), and
    /// when a stray quote merged several workouts into one text it is cut at the next workout's first key. Other kinds have nothing to salvage.
    private func recover(_ kind: HuaweiExportKind, _ text: Bytes) throws {
        guard kind == .motionPath else {
            summary.badRecords += 1
            return
        }
        let marker = Array(HuaweiMotionPathParser.recordMarker.utf8)
        var starts = [Int]()
        if text.count >= marker.count {
            var i = 0
            while i <= text.count - marker.count {
                if text[i] == marker[0] && text[i..<(i + marker.count)].elementsEqual(marker) { starts.append(i) }
                i += 1
            }
        }
        var pieces = [Bytes]()
        if starts.count <= 1 {
            pieces = [text]
        } else {
            for (i, from) in starts.enumerated() { pieces.append(Array(text[from..<(i + 1 < starts.count ? starts[i + 1] : text.count)])) }
        }
        for piece in pieces {
            let workout = HuaweiMotionPathParser.fromBrokenText(String(decoding: piece, as: UTF8.self)).flatMap { HuaweiMotionPathParser.build($0) }
            if let workout { try writeWorkout(workout) } else { summary.badRecords += 1 }
        }
    }

    private func writeWorkout(_ workout: ImportedWorkout) throws {
        summary.workoutsFound += 1
        summary.seen(workout.start)
        summary.seen(workout.end)
        let result = try store.writeWorkout(workout)
        if result.added {
            summary.workoutsAdded += 1
            summary.workoutPointsAdded += result.points
        }
    }

    private func flush() throws {
        if !minutes.isEmpty {
            let rows = minutes.values.sorted { $0.ts < $1.ts }
            minutes.removeAll(keepingCapacity: true)
            summary.minutesWritten += try store.writeMinutes(rows)
        }
        if !sleepRows.isEmpty {
            let rows = sleepRows
            sleepRows.removeAll(keepingCapacity: true)
            summary.sleepSegmentsAdded += try store.writeSleep(rows)
        }
        if !stressRows.isEmpty {
            let rows = stressRows
            stressRows.removeAll(keepingCapacity: true)
            summary.stressAdded += try store.writeStress(rows)
        }
    }

    private func report(_ phase: String, force: Bool) {
        let now = nowMs()
        if !force && now - lastProgressMs < HuaweiExportImporter.progressIntervalMs { return }
        lastProgressMs = now
        onProgress(
            HuaweiImportProgress(
                phase: phase, fileName: fileName, fileIndex: fileIndex, fileCount: fileCount,
                fraction: min(1.0, max(0.0, Double(doneBytes) / Double(totalBytes))), summary: summary
            )
        )
    }
}

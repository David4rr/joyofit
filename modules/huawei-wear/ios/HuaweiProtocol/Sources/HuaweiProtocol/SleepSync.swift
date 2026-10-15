// Port of the Kotlin SleepSync.kt (Derived from Gadgetbridge, AGPL-3.0-or-later): HuaweiSupportProvider.downloadTruSleepData /
// downloadDictTrueSleepData, HuaweiSampleProvider (RawTypes, toActivityKind, normalizeType).
import Foundation

/// Sleep from the files newer watches use instead of the old FitnessData sleep frames, gated and ordered exactly like GB's
/// `downloadTruSleepData(start, end)`:
///
///  1. Nothing unless FitnessData command 0x16 is supported (`HuaweiState.supportsTruSleep`).
///  2. ExpandCapability bit 143 (`supportsDictSleepSync`): a `sequence_data` file of dictionary class
///     `HuaweiDictTypes.sleepDetailsClass` over service 0x2C, parsed into per-minute stages. GB does not fall back to the
///     state/data files when this download fails.
///  3. Otherwise `sleep_state.bin` then `sleep_data.bin` (service 0x2C when SettingRelated said `truSleepNewSync`, else 0x0A). GB
///     stores one marker per `TruSleepStatus` range and does not use the sleep_data content (its analysis call is commented out),
///     so the data file is only parsed for the log.
///
/// GB's P2P data-dictionary sync is a different mechanism (skin temperature, HRV, emotion, sleep apnea and similar, never sleep
/// stages); the sleep detail class 700013 stays here as a file download.
public final class SleepSync: @unchecked Sendable {
    private let caps: DeviceCaps
    private let log: LogSink
    private let downloader: FileDownloader

    /// Minimum span of the sleep window; matches the 36 h the Today screen looks back for last night.
    private static let sleepLookbackSec = 36 * 3600

    // HuaweiSampleProvider.RawTypes
    private static let rawUnknown = 1
    private static let rawDeepSleep = 0x07
    private static let rawLightSleep = 0x06
    private static let rawTruSleepREM = 0x5656
    private static let rawTruSleepAwake = 0x5658
    private static let rawTruSleepNap = 0x5659

    public init(session: HuaweiSession, caps: DeviceCaps, log: @escaping LogSink) {
        self.caps = caps
        self.log = log
        self.downloader = FileDownloader(session: session, log: log)
    }

    /// Returns the sleep segments and scores, or `.empty` when GB would not download sleep for this watch or the download failed
    /// (logged). Only a lost link (`WearError` `.disconnected`) or cancellation aborts the caller.
    public func sync(sinceSec: Int, end: Int) async throws -> SleepDownload {
        // GB starts at the last stored sleep. Here `sinceSec` is the previous sync, and a night that began before it (synced
        // mid-sleep, or the file not yet written then) would fall outside the window, so the sleep window reaches back at least
        // `sleepLookbackSec`. The database upserts segments by (start, type), so re-downloading a night is harmless.
        let start = min(sinceSec, end - Self.sleepLookbackSec)
        if start != sinceSec { info("TruSleep: sleep window widened from \(sinceSec) to \(start)") }
        let supportsTruSleep = caps.supportsTruSleep
        let supportsDict = caps.supportsDictSleepSync
        let supportsBedTime = caps.supportsBedTime
        let newSync = caps.truSleepNewSync
        let commands07 = caps.supportedCommands[0x07].map { $0.map { $0.hex2 }.joined(separator: " ") } ?? "none"
        let expandCapability = caps.expandCapabilities?.hexUpper ?? "none"
        info(
            "TruSleep gates: supportsTruSleep(07/16)=\(supportsTruSleep) supportsDictSleepSync(ExpandCapability 143)=\(supportsDict) "
                + "supportsBedTime(199)=\(supportsBedTime) truSleepNewSync(SettingRelated)=\(newSync) "
                + "commands07=[\(commands07)] expandCapability=\(expandCapability)"
        )
        if !supportsTruSleep {
            info("TruSleep: FitnessData command 0x16 not supported, sleep files skipped (as GB)")
            return .empty
        }
        do {
            return supportsDict
                ? try await dictionarySleep(start: start, end: end, supportsBedTime: supportsBedTime)
                : try await truSleep(start: start, end: end, newSync: newSync)
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as WearError {
            if e.code == .disconnected { throw e }
            logError("TruSleep: sleep download failed: \(e.message)")
            return .empty
        } catch {
            logError("TruSleep: sleep download failed: \(error)")
            return .empty
        }
    }

    // GB downloadDictTrueSleepData

    private func dictionarySleep(start: Int, end: Int, supportsBedTime: Bool) async throws -> SleepDownload {
        info("TruSleep: dictionary sleep sync (dict class \(HuaweiDictTypes.sleepDetailsClass)), start=\(start) end=\(end)")
        let data = try await downloader.download(.sequenceData(start: start, end: end, dictId: HuaweiDictTypes.sleepDetailsClass))
        let result = try Self.parseSequenceFile(data, supportsBedTime: supportsBedTime) { self.info($0) }
        info("TruSleep: dictionary sleep sync produced \(result.segments.count) segments, \(result.scores.count) scores")
        return result
    }

    // GB downloadTruSleepData, state + data files

    private func truSleep(start: Int, end: Int, newSync: Bool) async throws -> SleepDownload {
        info("TruSleep: sleep_state/sleep_data download (\(newSync ? "service 2C" : "service 0A")), start=\(start) end=\(end)")
        // GB's SleepFileDownloadCallback: each file is independent; a failed one just stays nil.
        let state = try await downloadOrLog(.sleepState(newSync: newSync, start: start, end: end))
        let sleepData = try await downloadOrLog(.sleepData(newSync: newSync, start: start, end: end))

        if let sleepData, !sleepData.isEmpty {
            let parsed = try TruSleepParser.parseData(sleepData)
            info("TruSleep: sleep_data parsed, \(parsed.dataACCs.count) ACC and \(parsed.dataPPGs.count) PPG samples (not mapped, as GB)")
        }
        guard let state, !state.isEmpty else {
            info("TruSleep: sleep state file empty")
            return .empty
        }
        let segments = Self.segmentsFromState(TruSleepParser.parseState(state))
        if segments.isEmpty { info("TruSleep: no sleep results") }
        for s in segments { info("TruSleep: sleep range \(s.start)..\(s.end) type=\(s.type) stage=\(s.stage ?? "null")") }
        return SleepDownload(segments: segments, scores: [])
    }

    private func downloadOrLog(_ request: FileRequest) async throws -> Bytes? {
        do {
            return try await downloader.download(request)
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as WearError {
            if e.code == .disconnected { throw e }
            logError("Error downloading file: \(request.filename): \(e.message)")
            return nil
        }
    }

    private func info(_ message: String) { log(LogEntry(.info, message)) }
    private func logError(_ message: String) { log(LogEntry(.error, message)) }

    // MARK: pure mapping

    /// GB addSleepActivities(data, 0x0a) stores every TruSleep state range with raw kind 0x06.
    public static func segmentsFromState(_ statuses: [TruSleepParser.TruSleepStatus]) -> [SleepSegment] {
        statuses.map {
            SleepSegment(start: Int64($0.startTime), end: Int64($0.endTime), type: rawLightSleep, stage: stageForRawKind(rawLightSleep))
        }
    }

    /// HuaweiSampleProvider.toActivityKind(HuaweiSleepStageSample): the raw sample kind for a watch sleep-stage number
    /// (1 light, 2 REM, 3 deep, 4 awake, 5 nap, else unknown).
    public static func rawKindForStage(_ huaweiStage: Int) -> Int {
        switch huaweiStage {
        case 1: return rawLightSleep
        case 2: return rawTruSleepREM
        case 3: return rawDeepSleep
        case 4: return rawTruSleepAwake
        case 5: return rawTruSleepNap
        default: return rawUnknown
        }
    }

    /// HuaweiSampleProvider.normalizeType: ActivityKind of a raw kind. NAP is LIGHT_SLEEP in GB ("TODO"); anything else GB does
    /// not know is UNKNOWN, which has no stage here.
    public static func stageForRawKind(_ rawKind: Int) -> String? {
        switch rawKind {
        case rawDeepSleep: return "deep"
        case rawLightSleep, rawTruSleepNap: return "light"
        case rawTruSleepREM: return "rem"
        case rawTruSleepAwake: return "awake"
        default: return nil
        }
    }

    /// GB downloadDictTrueSleepData callback: per SequenceData the summary is parsed and corrected, the start time chosen with
    /// `TrueSleepSequenceDataParser.getTime` and the per-minute details turned into stages. Consecutive minutes with the same stage
    /// are merged into one segment. Throws where the Java parsers throw (a truncated record, a negative summary length).
    public static func parseSequenceFile(_ data: Bytes, supportsBedTime: Bool, log: (String) -> Void) throws -> SleepDownload {
        guard let file = try SequenceDataFileParser.parseSequenceFileData(data) else {
            log("TruSleep: sequence file empty or invalid (\(data.count) bytes)")
            return .empty
        }
        log("TruSleep: sequence file \(file)")

        var segments = [SleepSegment]()
        var scores = [SleepScore]()
        for sd in file.sequenceDataList {
            log("TruSleep: SequenceData start=\(sd.startTime) end=\(sd.endTime) version=\(sd.dataVersion) summaryType=\(sd.summaryType)")
            guard var summary = try TrueSleepSequenceDataParser().parseData(file: file, data: sd) else {
                log("TruSleep: DataSummary is null, skipped")
                continue
            }
            // GB: "some watches return incorrect(random) data for some fields. We need to correct this data."
            TrueSleepSequenceDataParser.correctSummary(&summary)
            log("TruSleep: \(summary)")

            let time = TrueSleepSequenceDataParser.getTime(
                fallAsleepTime: summary.fallAsleepTime, bedTime: summary.bedTime, validData: summary.validData, supportsBedTime: supportsBedTime
            )
            guard let details = sd.details else {
                log("TruSleep: SequenceData has no details, skipped")
                continue
            }
            guard let stages = try TrueSleepSequenceDataParser.parseSleepDetails(details, time: time) else {
                log("TruSleep: sleep details of \(details.count) bytes could not be parsed, skipped")
                continue
            }
            log("TruSleep: \(stages.count) one-minute stages from \(time)")

            var runStart: Int64 = 0
            var runEnd: Int64 = 0
            var runStage = 0
            var open = false
            for stage in stages {
                if open && stage.stage == runStage && stage.time == runEnd {
                    runEnd += 60
                    continue
                }
                if open { segments.append(segment(runStart, runEnd, runStage)) }
                runStart = stage.time
                runEnd = stage.time + 60
                runStage = stage.stage
                open = true
            }
            if open { segments.append(segment(runStart, runEnd, runStage)) }
            // correctSummary has already blanked the score of a summary the watch marked invalid.
            if (0...100).contains(summary.sleepScore) && open {
                let wake = summary.wakeupTime > time ? summary.wakeupTime : runEnd
                let efficiency = (0...100).contains(summary.sleepEfficiency) ? Int(summary.sleepEfficiency) : nil
                scores.append(SleepScore(start: time, end: wake, score: Int(summary.sleepScore), efficiency: efficiency))
            }
        }
        return SleepDownload(segments: segments, scores: scores)
    }

    private static func segment(_ start: Int64, _ end: Int64, _ huaweiStage: Int) -> SleepSegment {
        let raw = rawKindForStage(huaweiStage)
        return SleepSegment(start: start, end: end, type: raw, stage: stageForRawKind(raw))
    }
}

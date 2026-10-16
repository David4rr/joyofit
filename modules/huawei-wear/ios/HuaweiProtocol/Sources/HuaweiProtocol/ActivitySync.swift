// Port of ActivitySync.kt (GB HuaweiSupportProvider.fetchActivityData, sleep/step/totals part): sleep count and data, step count and data,
// then the totals, then the TruSleep / dictionary sleep download (SleepSync, injected). Results are returned instead of being stored.
import Foundation

public final class ActivitySync {
    private let session: HuaweiSession
    private let caps: DeviceCaps
    private let log: LogSink
    private let trueSleep: @Sendable (_ since: Int, _ end: Int) async throws -> SleepDownload

    /// Replaced by tests: the paging timeouts.
    var timeouts = LinkTimeouts()

    private var params: ParamsProvider { session.params }

    /// - Parameter trueSleep: GB `downloadTruSleepData(start, end)`, the Kotlin `SleepSync.sync(since, end)`: it returns the sleep segments
    ///   and scores, or nothing when the watch has no sleep files or the download failed (logged). A thrown error other than a lost link
    ///   is logged here and leaves the step data intact, as the Kotlin `SleepSync` guarantees.
    public init(
        session: HuaweiSession, caps: DeviceCaps, log: @escaping LogSink,
        trueSleep: @escaping @Sendable (_ since: Int, _ end: Int) async throws -> SleepDownload
    ) {
        self.session = session
        self.caps = caps
        self.log = log
        self.trueSleep = trueSleep
    }

    private func info(_ message: String) {
        log(LogEntry(.info, message))
    }

    /// "Some bands don't work with zero timestamp, so starting later" (GB: 01/01/2000).
    private static let minStartSec: Int64 = 946_684_800

    /// `toSec` ends the window early (one slice of a long pull); nil or later than now means now.
    public func sync(fromSec: Int64, toSec: Int64? = nil, now: Date = Date(), calendar: Calendar = .current) async throws -> SyncResult {
        let start = fromSec <= 0 ? ActivitySync.minStartSec : min(fromSec, Int64(Int32.max))
        let nowSec = Int(Int32(truncatingIfNeeded: Int64(now.timeIntervalSince1970)))
        let end = toSec.map { Int(min($0, Int64(nowSec))) } ?? nowSec
        info("Sync: from=\(start) to=\(end)")

        let frameSleep = try await fetchSleep(start: Int(start), end: end)
        let samples = try await fetchSteps(start: Int(start), end: end)

        // GetFitnessTotalsRequest. The Fit 4 can answer without the 0x81 container; then today's totals are summed from the synced
        // per-minute samples since local midnight. Only the window that reaches today needs the watch's totals; older slices of a history
        // pull skip the request.
        let midnight = Int64(calendar.startOfDay(for: now).timeIntervalSince1970)
        var totals: FitnessData.FitnessTotals.Response?
        if Int64(end) >= midnight {
            totals = try await skippable("FitnessTotals") {
                try await session.request(
                    FitnessData.FitnessTotals.request(), as: FitnessData.FitnessTotals.Response.self,
                    timeoutMs: timeouts.syncCountMs, label: "FitnessTotals"
                )
            }
        }
        let today = samples.filter { $0.timestamp >= midnight }
        let totalSteps = totals.map { Int($0.totalSteps) } ?? today.reduce(0) { $0 + $1.steps }
        let totalCalories = totals.map { Int($0.totalCalories) } ?? (today.reduce(0) { $0 + $1.calories } / 1000)
        let totalDistance = totals.map { Int($0.totalDistance) } ?? today.reduce(0) { $0 + $1.distance }

        // GB fetchActivityData: once the totals are in, downloadTruSleepData(start, end) fetches the TruSleep / dictionary sleep files
        // newer watches use. A failure there is logged and leaves the step data intact.
        let download: SleepDownload
        do {
            download = try await trueSleep(Int(start), end)
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as WearError {
            if e.code == .disconnected { throw e }
            log(LogEntry(.error, "TruSleep: sleep download failed: \(e.message)"))
            download = .empty
        } catch {
            log(LogEntry(.error, "TruSleep: sleep download failed: \(error)"))
            download = .empty
        }
        let sleep = ActivitySync.mergedSleep(frameSleep + download.segments)

        info(
            "Sync: \(samples.count) step samples, \(sleep.count) sleep segments, totals steps=\(totalSteps) calories=\(totalCalories) distance=\(totalDistance)"
                + (totals == nil ? " (summed from samples)" : "")
        )
        return SyncResult(
            from: start, to: Int64(end), samples: samples, sleep: sleep, totalSteps: totalSteps, totalCalories: totalCalories,
            totalDistance: totalDistance, sleepScores: download.scores
        )
    }

    /// `distinctBy { (start, end, type) }.sortedBy { start }`: the first of equal segments wins, equal starts keep their order.
    static func mergedSleep(_ all: [SleepSegment]) -> [SleepSegment] {
        struct Key: Hashable { let start: Int64; let end: Int64; let type: Int }
        var seen = Set<Key>()
        var distinct = [(offset: Int, segment: SleepSegment)]()
        for (offset, segment) in all.enumerated() where seen.insert(Key(start: segment.start, end: segment.end, type: segment.type)).inserted {
            distinct.append((offset, segment))
        }
        return distinct.sorted { a, b in a.segment.start != b.segment.start ? a.segment.start < b.segment.start : a.offset < b.offset }.map { $0.segment }
    }

    // MARK: GetSleepDataCountRequest -> GetSleepDataRequest chain

    private func fetchSleep(start: Int, end: Int) async throws -> [SleepSegment] {
        var segments = [SleepSegment]()
        let maxCount = try await messageCount(FitnessData.MessageCount.sleepId, start: start, end: end, label: "SleepDataCount")
        if maxCount <= 0 { return segments }

        var count = 0
        while true {
            let label = "SleepData \(count + 1)/\(maxCount)"
            let response = try await skippable(label) {
                try await session.request(
                    FitnessData.MessageData.request(commandId: FitnessData.MessageData.sleepId, count: Int16(truncatingIfNeeded: count)),
                    as: FitnessData.MessageData.SleepResponse.self, timeoutMs: timeouts.syncDataMs, label: label
                )
            }
            guard let response else {
                if count + 1 < maxCount { count += 1; continue } else { break }
            }

            if Int(response.number) != count {
                info("\(label): counts do not match (received \(response.number))")
            }

            for container in response.containers {
                let raw = container.timestamp
                if raw.count < 6 {
                    log(LogEntry(.error, "\(label): sleep timestamp has \(raw.count) bytes, expected 6"))
                    continue
                }
                // GB GetSleepDataRequest: bytes 0-3 start (big-endian seconds), bytes 4-5 duration in minutes.
                let b = raw.prefix(6).map { Int($0) }
                let startSec = (Int64(b[0]) << 24) | (Int64(b[1]) << 16) | (Int64(b[2]) << 8) | Int64(b[3])
                let durationMin = (b[4] << 8) | b[5]
                let type = Int(UInt8(bitPattern: container.type))
                segments.append(SleepSegment(start: startSec, end: startSec + Int64(durationMin) * 60, type: type, stage: ActivitySync.stageForRawKind(type)))
            }

            if count + 1 < maxCount { count += 1 } else { break }
        }
        return segments
    }

    // MARK: GetStepDataCountRequest -> GetStepDataRequest chain

    private func fetchSteps(start: Int, end: Int) async throws -> [StepSample] {
        var samples = [StepSample]()
        let maxCount = try await messageCount(FitnessData.MessageCount.stepId, start: start, end: end, label: "StepDataCount")
        if maxCount <= 0 {
            info("Sync HR: no step frames to count")
            return samples
        }
        var stats = StepFrameSummary()

        var count = 0
        var requests = 0
        while true {
            let label = "StepData \(count + 1)/\(maxCount)"
            let response = try await skippable(label) {
                try await session.request(
                    FitnessData.MessageData.request(commandId: FitnessData.MessageData.stepId, count: Int16(truncatingIfNeeded: count)),
                    as: FitnessData.MessageData.StepResponse.self, timeoutMs: timeouts.syncDataMs, label: label
                )
            }
            guard let response else {
                if count + 1 < maxCount { count += 1; continue } else { break }
            }

            if Int(response.number) != count {
                info("\(label): counts do not match (received \(response.number), expected \(count))")
                count = Int(response.number) // GB: "This stops it from going into a loop"
            }

            for container in response.containers {
                stats.add(container)
                guard container.parsedData != nil else {
                    log(LogEntry(.error, "\(label): \(container.parsedDataError)"))
                    continue
                }
                samples.append(StepSample(
                    timestamp: Int64(container.timestamp),
                    steps: ActivitySync.nonNegative(Int(container.steps)),
                    calories: ActivitySync.nonNegative(Int(container.calories)),
                    distance: ActivitySync.nonNegative(Int(container.distance)),
                    heartRate: ActivitySync.measured(Int(container.heartrate)),
                    spo2: ActivitySync.measured(Int(container.spo)),
                    restingHeartRate: ActivitySync.measured(Int(container.restingHeartRate))
                ))
            }

            if count + 1 < maxCount { count += 1 } else { break }
            // GB trusts the watch's counter; bound the loop in case it never settles.
            requests += 1
            if requests > maxCount * 2 + 16 {
                throw WearError(.protocolError, "StepData paging did not converge after \(requests) requests (count=\(maxCount))")
            }
        }
        info("Sync HR: \(stats.summary)")
        return samples
    }

    /// Returns 0 when the watch answers without the 0x81 count container. Newer watches (Fit 4, fw 6.1.0.117) do this for the old-style
    /// sleep frames, which they replace with TruSleep files. GB aborts the whole sync there; we skip only that data type.
    private func messageCount(_ commandId: UInt8, start: Int, end: Int, label: String) async throws -> Int {
        let response = try await skippable(label) {
            try await session.request(
                FitnessData.MessageCount.request(commandId: commandId, start: Int32(truncatingIfNeeded: start), end: Int32(truncatingIfNeeded: end)),
                as: FitnessData.MessageCount.Response.self, timeoutMs: timeouts.syncCountMs, label: label
            )
        }
        guard let response else { return 0 }
        let count = Int(response.count)
        info("\(label): \(count)")
        return count
    }

    /// Runs `block`; a response the watch sent without the expected TLV (a Java ParseException, seen on the Fit 4 as frames lacking tag 0x81)
    /// is logged and yields nil so the sync continues. Transport errors, timeouts and unreadable (non-parse) failures still abort.
    private func skippable<T>(_ label: String, _ block: () async throws -> T) async throws -> T? {
        do {
            return try await block()
        } catch let e as WearError {
            guard e.code == .protocolError, e.isParseFailure else { throw e }
            info("\(label): no data in response (\(e.underlying.map { "\($0)" } ?? e.message)); skipping")
            return nil
        }
    }

    /// GB casts to short and maps -1 (field absent / 0xFFFF) to 0.
    static func nonNegative(_ value: Int) -> Int {
        let asShort = Int(Int16(truncatingIfNeeded: value))
        return asShort == -1 ? 0 : asShort
    }

    /// `value & 0xFF`, with the watch's "not measured" markers (absent -1, 0, 0xFF) as nil.
    static func measured(_ value: Int) -> Int? {
        let byte = value & 0xFF
        return byte == 0 || byte == 0xFF ? nil : byte
    }

    /// SleepSync.stageForRawKind: GB `HuaweiSampleProvider.normalizeType` of a raw kind (NAP is light sleep); nil for the rest.
    static func stageForRawKind(_ rawKind: Int) -> String? {
        switch rawKind {
        case 0x07: return "deep"
        case 0x06, 0x5659: return "light"
        case 0x5656: return "rem"
        case 0x5658: return "awake"
        default: return nil
        }
    }
}

/// What one sync's step frames carried besides steps (the Kotlin `StepFrameStats`, reduced to its one-line summary): how many subcontainers
/// have the heart-rate TV (bitmap 1, bit 0x40), SpO2 (bitmap 2, bit 0x01) and resting heart rate (bitmap 2, bit 0x02), and how many the
/// bitmap walk could not read. Tells "the watch records nothing" from "the app drops it".
struct StepFrameSummary {
    private var containers = 0
    private var unparsed = 0
    private var heartRate = 0
    private var heartRateMeasured = 0
    private var spo2 = 0
    private var spo2Measured = 0
    private var resting = 0
    private var restingMeasured = 0

    mutating func add(_ container: FitnessData.MessageData.StepResponse.SubContainer) {
        containers += 1
        guard let tvs = container.parsedData else {
            unparsed += 1
            return
        }
        for tv in tvs {
            let measured = ActivitySync.measured(Int(tv.value)) != nil
            switch (tv.bitmap, UInt8(bitPattern: tv.tag)) {
            case (1, 0x40):
                heartRate += 1
                if measured { heartRateMeasured += 1 }
            case (2, 0x01):
                spo2 += 1
                if measured { spo2Measured += 1 }
            case (2, 0x02):
                resting += 1
                if measured { restingMeasured += 1 }
            default: break
            }
        }
    }

    var summary: String {
        "\(containers) step subcontainers (\(unparsed) unparsed): heartRate TV in \(heartRate) (measured \(heartRateMeasured)), "
            + "SpO2 TV in \(spo2) (measured \(spo2Measured)), resting HR TV in \(resting) (measured \(restingMeasured))"
    }
}

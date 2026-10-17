import XCTest
@testable import HuaweiProtocol

/// `SleepSync` end to end: a real `HuaweiSession` over the fake watch, files served for the 0x2C and 0x0A protocols, the segments and
/// scores compared with what the Java parsers produce for the same bytes (sleep_parsers.json `pipelines`). The merge of per-minute
/// stages into segments is Kotlin only: its expectations follow SleepSync.kt and the Kotlin FileDownloadTest.
final class SleepSyncTests: XCTestCase {
    private let g = try! Golden.load("sleep_parsers")

    // MARK: fixtures

    /// ExpandCapability with bit 143 (dictionary sleep) and optionally bit 199 (bed time).
    private func caps(truSleep: Bool = true, dict: Bool, bedTime: Bool = false, newSync: Bool = true) -> DeviceCaps {
        let caps = DeviceCaps()
        caps.supportedCommands = truSleep ? [0x07: [0x16]] : [0x07: [0x0a, 0x0b]]
        var cap = Bytes(repeating: 0, count: 32)
        if dict { cap[143 / 8] |= UInt8(1 << (143 % 8)) }
        if bedTime { cap[199 / 8] |= UInt8(1 << (199 % 8)) }
        caps.expandCapabilities = cap
        caps.truSleepNewSync = newSync
        return caps
    }

    private func be(_ v: Int, _ n: Int) -> Bytes { (0..<n).map { UInt8(truncatingIfNeeded: v >> (8 * (n - 1 - $0))) } }
    private func le(_ v: Int, _ n: Int) -> Bytes { (0..<n).map { UInt8(truncatingIfNeeded: v >> (8 * $0)) } }

    /// The sequence file of the Kotlin FileDownloadTest: one record, summary (fall asleep 1_700_000_130, valid, score 85), details
    /// light 2 min, [invalid], deep 1 + 1 min, [invalid], awake 3 min, unknown stage 9 for 1 min.
    private func kotlinSequenceFile() -> Bytes {
        func value(_ dictId: Int, _ type: Int, _ bytes: Bytes) -> HuaweiTLV {
            var t = HuaweiTLV()
            t.put(0x03, int: Int32(dictId))
            t.put(0x04, byte: UInt8(type))
            t.put(0x05, bytes: bytes)
            return t
        }
        var mid = HuaweiTLV()
        mid.put(0x82, tlv: value(700013686, 3, be(1_700_000_130, 8)))
        mid.put(0x82, tlv: value(700013786, 1, [0, 0, 0, 1]))
        mid.put(0x82, tlv: value(700013245, 1, [0, 0, 0, 85]))
        var top = HuaweiTLV()
        top.put(0x81, tlv: mid)
        let summary = top.serialize()

        func record(_ durationSec: Int, _ status: Int) -> Bytes { le(durationSec, 4) + [UInt8(status), 0, 0, 0] }
        let details = [record(120, 1), record(0, 1), record(60, 3), record(60, 3), record(90, 2), record(180, 4), record(60, 9)].flatMap { $0 }

        let sequence = be(1_700_000_000, 4) + be(1_700_005_000, 4) + [1, 2] + be(summary.count, 2) + be(details.count, 4) + Bytes(repeating: 0, count: 16) + summary + details
        return be(sequence.count, 4) + be(700013, 4) + be(1, 2) + be(1, 2) + Bytes(repeating: 0, count: 20) + sequence
    }

    private struct Seg: Equatable {
        let start: Int64, end: Int64, type: Int
        let stage: String?
        init(_ s: SleepSegment) { start = s.start; end = s.end; type = s.type; stage = s.stage }
        init(_ start: Int64, _ end: Int64, _ type: Int, _ stage: String?) { self.start = start; self.end = end; self.type = type; self.stage = stage }
    }

    private func serveSequenceFile(_ h: SleepFilesHarness, _ file: Bytes, burst: Int = 200, maxBlockSize: Int = 4096) -> SleepFilesFakeWatch.NewSyncServer {
        let server = h.newSyncServer([.init(name: "sequence_data", typeByte: 0x16, fileId: 3, content: file)])
        server.burst = burst
        server.maxBlockSize = maxBlockSize
        server.noEncrypt = true
        return server
    }

    // MARK: Kotlin FileDownloadTest: sequence file parsing and stage mapping

    /// Kotlin `sequenceFileBecomesStagedSegments`.
    func testSequenceFileBecomesStagedSegments() throws {
        var logs = [String]()
        let result = try SleepSync.parseSequenceFile(kotlinSequenceFile(), supportsBedTime: false) { logs.append($0) }
        // fallAsleepTime 1_700_000_130 is cut to the minute: 1_700_000_100.
        let t: Int64 = 1_700_000_100
        XCTAssertEqual(result.segments.map(Seg.init), [
            Seg(t, t + 120, 0x06, "light"),
            Seg(t + 120, t + 240, 0x07, "deep"),
            Seg(t + 240, t + 420, 0x5658, "awake"),
            Seg(t + 420, t + 480, 1, nil),
        ])
        XCTAssertTrue(logs.contains { $0.contains("sleepScore=85") })
        // The watch's score is kept for the night the stages start.
        XCTAssertEqual(result.scores, [SleepScore(start: t, end: t + 480, score: 85, efficiency: nil)])
        XCTAssertEqual(logs.filter { $0.hasPrefix("TruSleep: ") && $0.contains("one-minute stages") }.count, 1)
        XCTAssertTrue(logs.contains("TruSleep: 8 one-minute stages from \(t)"))
    }

    /// Kotlin `invalidSequenceFileGivesNoSegments`.
    func testInvalidSequenceFileGivesNoSegments() throws {
        var logs = [String]()
        XCTAssertEqual(try SleepSync.parseSequenceFile(Bytes(repeating: 0, count: 10), supportsBedTime: false) { logs.append($0) }, .empty)
        XCTAssertEqual(logs, ["TruSleep: sequence file empty or invalid (10 bytes)"])
    }

    /// Kotlin `stageMappingFollowsGbSampleProvider`.
    func testStageMappingFollowsGbSampleProvider() {
        XCTAssertEqual([1, 2, 3, 4, 5, 0, 9].map(SleepSync.rawKindForStage), [0x06, 0x5656, 0x07, 0x5658, 0x5659, 1, 1])
        XCTAssertEqual([0x06, 0x5656, 0x07, 0x5658, 0x5659, 1].map(SleepSync.stageForRawKind), ["light", "rem", "deep", "awake", "light", nil])
        XCTAssertNil(SleepSync.stageForRawKind(0x0a))
        XCTAssertEqual(SleepSync.rawKindForStage(-1), 1)
        XCTAssertEqual(SleepSync.rawKindForStage(6), 1)
        XCTAssertNil(SleepSync.stageForRawKind(0))
    }

    /// GB stores a state range as raw kind 0x06 and reads it back as light sleep (its docs: all TruSleep sleep shows as light). A range only
    /// says the watch judged you asleep, so it keeps the key (start, 0x06), which rewrites a row an earlier build stored as light, but no stage.
    func testSegmentsFromStateKeepRawKindLightButHaveNoStage() {
        let segments = SleepSync.segmentsFromState([
            TruSleepParser.TruSleepStatus(startTime: 1000, endTime: 5000),
            TruSleepParser.TruSleepStatus(startTime: -5, endTime: Int32.max),
        ])
        XCTAssertEqual(segments.map(Seg.init), [Seg(1000, 5000, 0x06, nil), Seg(-5, Int64(Int32.max), 0x06, nil)])
        XCTAssertEqual(SleepSync.segmentsFromState([]), [])
    }

    /// Consecutive minutes of one stage merge; a different stage or a new record starts a new segment, and the
    /// score of a night is kept only when the watch's score is within 0...100, with the efficiency within 0...100.
    func testSegmentMergingScoreAndWakeTime() throws {
        let t0 = 1_700_000_040 // a whole minute
        let night = details([(10, 1), (5, 1), (5, 3), (2, 3), (1, 4)]) // light 15 min, deep 7 min, awake 1 min
        let result = try SleepSync.parseSequenceFile(sequenceFile([
            // no valid data: correctSummary blanks the score
            sequenceRecord(summaryTLV(fall: t0 + 7, bed: 0, wake: t0 + 5000, valid: nil, score: 80, efficiency: 70), night),
            // score out of range: stages but no score
            sequenceRecord(summaryTLV(fall: t0 + 10_000, bed: 0, wake: t0 + 10_000 + 600, valid: 1, score: 101, efficiency: 50), details([(3, 2)])),
            // efficiency out of range: score without it; stage 0 is an invalid record and is skipped; the watch's wake-up time ends the night
            sequenceRecord(summaryTLV(fall: t0 + 20_000, bed: 0, wake: t0 + 20_000 + 600, valid: 1, score: 100, efficiency: 101), details([(3, 5), (1, 0)])),
            // score 0 and efficiency 0 are in range
            sequenceRecord(summaryTLV(fall: t0 + 30_000, bed: 0, wake: t0 + 30_000 + 600, valid: 1, score: 0, efficiency: 0), details([(3, 1)])),
            // wake-up time before the start: the night ends where its stages end
            sequenceRecord(summaryTLV(fall: t0 + 40_000, bed: 0, wake: t0 + 40_000 - 60, valid: 1, score: 55, efficiency: 55), details([(3, 1)])),
            // no valid stage: neither segment nor score
            sequenceRecord(summaryTLV(fall: t0 + 50_000, bed: 0, wake: 0, valid: 1, score: 55, efficiency: 55), details([(0, 1), (7, 0)])),
        ]), supportsBedTime: false) { _ in }
        func minute(_ x: Int) -> Int64 { Int64(x / 60 * 60) }
        let (s2, s3, s4, s5) = (minute(t0 + 10_000), minute(t0 + 20_000), minute(t0 + 30_000), minute(t0 + 40_000))
        let s1 = Int64(t0)
        XCTAssertEqual(result.segments.map(Seg.init), [
            Seg(s1, s1 + 900, 0x06, "light"),
            Seg(s1 + 900, s1 + 1320, 0x07, "deep"),
            Seg(s1 + 1320, s1 + 1380, 0x5658, "awake"),
            Seg(s2, s2 + 180, 0x5656, "rem"),
            Seg(s3, s3 + 180, 0x5659, "light"),
            Seg(s4, s4 + 180, 0x06, "light"),
            Seg(s5, s5 + 180, 0x06, "light"),
        ])
        XCTAssertEqual(result.scores, [
            SleepScore(start: s3, end: Int64(t0 + 20_000 + 600), score: 100, efficiency: nil),
            SleepScore(start: s4, end: Int64(t0 + 30_000 + 600), score: 0, efficiency: 0),
            SleepScore(start: s5, end: s5 + 180, score: 55, efficiency: 55),
        ])
    }

    /// With ExpandCapability 199 and valid data the night starts at the bed time instead of the fall asleep time.
    func testBedTimeStartsTheNightWhenSupported() throws {
        let t0 = 1_700_000_040
        let file = sequenceFile([sequenceRecord(summaryTLV(fall: t0 + 9_999, bed: t0 + 100, wake: 0, valid: 1, score: nil, efficiency: nil), details([(2, 3)]))])
        let with = try SleepSync.parseSequenceFile(file, supportsBedTime: true) { _ in }
        let without = try SleepSync.parseSequenceFile(file, supportsBedTime: false) { _ in }
        XCTAssertEqual(with.segments.map(Seg.init), [Seg(Int64((t0 + 100) / 60 * 60), Int64((t0 + 100) / 60 * 60 + 120), 0x07, "deep")])
        XCTAssertEqual(without.segments.map(Seg.init), [Seg(Int64((t0 + 9_999) / 60 * 60), Int64((t0 + 9_999) / 60 * 60 + 120), 0x07, "deep")])
        // without valid data the bed time is ignored whatever the capability says
        let invalid = sequenceFile([sequenceRecord(summaryTLV(fall: t0 + 9_999, bed: t0 + 100, wake: 0, valid: nil, score: nil, efficiency: nil), details([(2, 3)]))])
        XCTAssertEqual(try SleepSync.parseSequenceFile(invalid, supportsBedTime: true) { _ in }.segments.map { $0.start }, [Int64((t0 + 9_999) / 60 * 60)])
    }

    private func details(_ runs: [(minutes: Int, stage: Int)]) -> Bytes {
        runs.flatMap { le($0.minutes * 60, 4) + [UInt8($0.stage), 0, 0, 0] }
    }

    private func summaryTLV(fall: Int, bed: Int, wake: Int, valid: Int?, score: Int?, efficiency: Int?) -> Bytes {
        func triplet(_ dict: Int, _ type: Int, _ value: Bytes) -> HuaweiTLV {
            var t = HuaweiTLV()
            t.put(0x03, int: Int32(dict))
            t.put(0x04, byte: UInt8(type))
            t.put(0x05, bytes: value)
            return t
        }
        var mid = HuaweiTLV()
        mid.put(0x82, tlv: triplet(700013686, 3, be(fall, 8)))
        mid.put(0x82, tlv: triplet(700013298, 3, be(bed, 8)))
        mid.put(0x82, tlv: triplet(700013156, 3, be(wake, 8)))
        if let valid { mid.put(0x82, tlv: triplet(700013786, 1, be(valid, 4))) }
        if let score { mid.put(0x82, tlv: triplet(700013245, 1, be(score, 4))) }
        if let efficiency { mid.put(0x82, tlv: triplet(700013232, 1, be(efficiency, 4))) }
        var top = HuaweiTLV()
        top.put(0x81, tlv: mid)
        return top.serialize()
    }

    private func sequenceRecord(_ summary: Bytes, _ details: Bytes) -> Bytes {
        be(1, 4) + be(2, 4) + [1, 2] + be(summary.count, 2) + be(details.count, 4) + Bytes(repeating: 0, count: 16) + summary + details
    }

    private func sequenceFile(_ records: [Bytes]) -> Bytes {
        let body = records.flatMap { $0 }
        return be(body.count, 4) + be(700013, 4) + be(1, 2) + be(1, 2) + Bytes(repeating: 0, count: 20) + body
    }

    // MARK: Java goldens through the pure parse and through the whole stack

    private struct Expected: Equatable {
        var segments: [Seg]
        var scores: [SleepScore]
    }

    /// The Kotlin merge, from the per-record data Java's parsers produced.
    private func expected(_ records: [[String: Any]]) -> Expected {
        var out = Expected(segments: [], scores: [])
        for r in records {
            if r.keys.contains("summary") { continue } // null summary: skipped
            guard let runs = r["stages"] as? [[Int]] else { continue } // no details, or details that could not be parsed
            let time = (r["stagesFrom"] as? NSNumber)?.int64Value ?? (r["time"] as? NSNumber)?.int64Value ?? 0
            var at = time
            var any = false
            for run in runs {
                let raw = SleepSync.rawKindForStage(run[0])
                out.segments.append(Seg(at, at + 60 * Int64(run[1]), raw, SleepSync.stageForRawKind(raw)))
                at += 60 * Int64(run[1])
                any = true
            }
            let score = r.int("sleepScore")
            if (0...100).contains(score) && any {
                let wake = (r["wakeupTime"] as? NSNumber)?.int64Value ?? -1
                let efficiency = r.int("sleepEfficiency")
                out.scores.append(SleepScore(start: time, end: wake > time ? wake : at, score: score, efficiency: (0...100).contains(efficiency) ? efficiency : nil))
            }
        }
        return out
    }

    func testPipelinesMatchJavaThroughParseSequenceFile() throws {
        let cases = g.list("pipelines")
        XCTAssertGreaterThan(cases.count, 15)
        var withSegments = 0
        var withScores = 0
        var errors = 0
        for c in cases {
            let name = c.str("name")
            for (key, bedTime) in [("withoutBedTime", false), ("withBedTime", true)] {
                let java = c[key] as? [String: Any] ?? [:]
                var logs = [String]()
                if java["error"] != nil {
                    errors += 1
                    XCTAssertThrowsError(try SleepSync.parseSequenceFile(c.bytes("file"), supportsBedTime: bedTime) { logs.append($0) }, "\(name) \(key): Java throws \(java["error"] ?? "")")
                    continue
                }
                let result = try SleepSync.parseSequenceFile(c.bytes("file"), supportsBedTime: bedTime) { logs.append($0) }
                if java["file"] != nil {
                    XCTAssertEqual(result, .empty, "\(name) \(key)")
                    XCTAssertTrue(logs.contains { $0.hasPrefix("TruSleep: sequence file empty or invalid") }, "\(name) \(key)")
                    continue
                }
                let want = expected(java.list("records"))
                XCTAssertEqual(result.segments.map(Seg.init), want.segments, "\(name) \(key): segments")
                XCTAssertEqual(result.scores, want.scores, "\(name) \(key): scores")
                if !want.segments.isEmpty { withSegments += 1 }
                if !want.scores.isEmpty { withScores += 1 }
            }
        }
        XCTAssertGreaterThan(withSegments, 15)
        XCTAssertGreaterThan(withScores, 8)
        XCTAssertGreaterThan(errors, 2)
    }

    /// The same files through HuaweiSession, FileDownloader and SleepSync: dictionary sleep over service 0x2C.
    func testPipelinesMatchJavaThroughTheWholeStack() async throws {
        for c in g.list("pipelines") {
            let name = c.str("name")
            for (key, bedTime) in [("withoutBedTime", false), ("withBedTime", true)] {
                let java = c[key] as? [String: Any] ?? [:]
                let h = SleepFilesHarness()
                let file = c.bytes("file")
                _ = serveSequenceFile(h, file, burst: 211, maxBlockSize: 1500)
                let sync = SleepSync(session: h.session, caps: caps(dict: true, bedTime: bedTime), log: h.log.sink)

                let result = try await sync.sync(sinceSec: 946_684_800, end: 1_700_100_000)

                if java["error"] != nil {
                    XCTAssertEqual(result, .empty, "\(name) \(key)")
                    XCTAssertTrue(h.log.containsError("TruSleep: sleep download failed"), "\(name) \(key): \(h.log.messages.suffix(3))")
                } else if java["file"] != nil {
                    XCTAssertEqual(result, .empty, "\(name) \(key)")
                    XCTAssertTrue(h.log.contains("TruSleep: sequence file empty or invalid (\(file.count) bytes)"), name)
                } else {
                    let want = expected(java.list("records"))
                    XCTAssertEqual(result.segments.map(Seg.init), want.segments, "\(name) \(key)")
                    XCTAssertEqual(result.scores, want.scores, "\(name) \(key)")
                }
                // the whole file was downloaded and completed in every case
                XCTAssertEqual(h.watch.count(0x2c, 0x06), 1, "\(name) \(key)")
                XCTAssertEqual(h.watch.count(0x0a, 0x01), 0)
            }
        }
    }

    /// Kotlin `dictionarySleepIsDownloadedWhenGbWouldUseIt`.
    func testDictionarySleepIsDownloadedWhenGbWouldUseIt() async throws {
        let h = SleepFilesHarness()
        let file = kotlinSequenceFile()
        let server = h.newSyncServer([.init(name: "sequence_data", typeByte: 0x16, fileId: 3, content: file)])
        server.noEncrypt = true
        server.maxBlockSize = 4096
        server.burst = 200
        let sync = SleepSync(session: h.session, caps: caps(dict: true), log: h.log.sink)

        let result = try await sync.sync(sinceSec: 946_684_800, end: 1_700_100_000)

        XCTAssertEqual(result.segments.map { $0.stage }, ["light", "deep", "awake", nil])
        XCTAssertEqual(try XCTUnwrap(h.watch.requests.first { $0.command == 0x01 }).tlv.int(0x0c), 700013)
        XCTAssertTrue(h.log.contains("supportsDictSleepSync(ExpandCapability 143)=true"))
        XCTAssertTrue(h.log.contains("TruSleep: dictionary sleep sync produced 4 segments, 1 scores"))
        XCTAssertEqual(h.watch.count(0x2c, 0x01), 1, "no state/data files in the dictionary path")
    }

    /// Kotlin `sleepFilesAreSkippedWithoutTruSleepSupport`.
    func testSleepFilesAreSkippedWithoutTruSleepSupport() async throws {
        let h = SleepFilesHarness()
        let sync = SleepSync(session: h.session, caps: caps(truSleep: false, dict: true), log: h.log.sink)
        let result = try await sync.sync(sinceSec: 1, end: 2)
        XCTAssertEqual(result, .empty)
        XCTAssertTrue(h.watch.requests.isEmpty)
        XCTAssertTrue(h.log.contains("command 0x16 not supported"))
        XCTAssertTrue(h.log.contains("commands07=[0x0a 0x0b]"))
    }

    /// Kotlin `truSleepStateRangesBecomeSegmentsWhenDictionaryIsNotSupported`.
    func testTruSleepStateRangesBecomeSegments() async throws {
        let state = le(1000, 4) + le(5000, 4) + Bytes(repeating: 0, count: 8) + le(7000, 4) + le(9000, 4) + Bytes(repeating: 0, count: 8)
        let h = SleepFilesHarness()
        _ = h.newSyncServer([
            .init(name: "sleep_state.bin", typeByte: 0x0e, fileId: 0x0e, content: state),
            .init(name: "sleep_data.bin", typeByte: 0x0f, fileId: 0x0f, content: []),
        ])
        let sync = SleepSync(session: h.session, caps: caps(dict: false), log: h.log.sink)

        let result = try await sync.sync(sinceSec: 1, end: 2)

        XCTAssertEqual(result.segments.map(Seg.init), [Seg(1000, 5000, 0x06, nil), Seg(7000, 9000, 0x06, nil)])
        XCTAssertEqual(result.scores, [])
        XCTAssertEqual(h.watch.count(0x2c, 0x01), 2) // sleep_state.bin and sleep_data.bin
        XCTAssertEqual(h.watch.requests.filter { $0.command == 0x01 }.compactMap { try? $0.tlv.string(0x01) }, ["sleep_state.bin", "sleep_data.bin"], "state first, then data")
        XCTAssertTrue(h.log.contains("TruSleep: sleep range 1000..5000 type=6 stage=null"))
        XCTAssertTrue(h.log.contains("TruSleep: sleep_state.bin 32 bytes: E8030000"))
    }

    /// The same over the old service 0x0A when SettingRelated did not announce the new sync.
    func testTruSleepOverTheOldService() async throws {
        let state = le(1_700_000_000, 4) + le(1_700_030_000, 4) + Bytes(repeating: 0, count: 8)
        let h = SleepFilesHarness()
        let server = h.oldSyncServer(["sleep_state.bin": state, "sleep_data.bin": [0, 0, 0]], listing: ["sleep_state.bin", "sleep_data.bin"])
        server.maxBlockSize = 16
        server.burst = 5
        let sync = SleepSync(session: h.session, caps: caps(dict: false, newSync: false), log: h.log.sink)

        let result = try await sync.sync(sinceSec: 1, end: 2)

        XCTAssertEqual(result.segments.map(Seg.init), [Seg(1_700_000_000, 1_700_030_000, 0x06, nil)])
        XCTAssertEqual(h.watch.count(0x0a, 0x01), 1)
        XCTAssertEqual(h.watch.count(0x2c, 0x01), 0)
        XCTAssertTrue(h.log.contains("sleep_state/sleep_data download (service 0A)"))
    }

    /// `sleep_data.bin` is parsed only for the log (GB does not use it): real watch bytes of TestHuaweiTruSleepParser.
    func testSleepDataIsParsedForTheLogOnly() async throws {
        let acc = Bytes(hex: "0107F02A0B670000B6")!
        let t1 = Bytes(hex: "02B000403B0B672AAADA13C109A915E707BE130C06E3112104F80F84182F0888109900390805121004850E4317EC07C911D4037610C701580E2A02310F6B022B100E0448119B075B154F099916390A07191A0E9B00D10E2D02A7105405AAE8FDE8FDBDDA92B767943B71104EE52AB907EE06AC08BD06BE067C07DB06CC05E2079B06C206E906920639063807E0056406D905E2067807870660074D03720A8406AA0624064005CA07DF062D088706D2084B0A00")!
        let t3 = Bytes(hex: "025A00B2180B671BBB410174706A726F6D6D747B757B776E6E6D6E6F777D77777670757570AA543D0E52276956406837B63C103EB22C6929C7265326EA2FCC2F743CC9380239673B9739EA2FC92CC526BB2E652D6433DD3506397E2F00")!
        let state = Bytes(hex: "0100000002000000000000000000000003000000050000000000000000000000")!
        let h = SleepFilesHarness()
        _ = h.newSyncServer([
            .init(name: "sleep_state.bin", typeByte: 0x0e, fileId: 1, content: state),
            .init(name: "sleep_data.bin", typeByte: 0x0f, fileId: 2, content: acc + t1 + t3),
        ])
        let result = try await SleepSync(session: h.session, caps: caps(dict: false), log: h.log.sink).sync(sinceSec: 1, end: 2)
        XCTAssertEqual(result.segments.map(Seg.init), [Seg(1, 2, 0x06, nil), Seg(3, 5, 0x06, nil)])
        XCTAssertTrue(h.log.contains("TruSleep: sleep_data parsed, 1 ACC and 69 PPG samples (not mapped, as GB)"))
    }

    /// GB `new byte[length]` with a negative ACC length throws out of `parseData`: the Kotlin `sync` catches it, so the state
    /// segments are lost too and the failure is logged.
    func testSleepDataThatThrowsLosesTheStateSegmentsAsInKotlin() async throws {
        let state = le(1000, 4) + le(5000, 4) + Bytes(repeating: 0, count: 8)
        let h = SleepFilesHarness()
        _ = h.newSyncServer([
            .init(name: "sleep_state.bin", typeByte: 0x0e, fileId: 1, content: state),
            .init(name: "sleep_data.bin", typeByte: 0x0f, fileId: 2, content: [1, 0x80, 1, 2, 3]),
        ])
        let result = try await SleepSync(session: h.session, caps: caps(dict: false), log: h.log.sink).sync(sinceSec: 1, end: 2)
        XCTAssertEqual(result, .empty)
        XCTAssertTrue(h.log.containsError("TruSleep: sleep download failed: NegativeArraySizeException: -128"), "\(h.log.messages.suffix(3))")
    }

    // MARK: window, gates and failures

    func testSleepWindowIsWidenedToThirtySixHours() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([.init(name: "sequence_data", typeByte: 0x16, fileId: 3, content: [])])
        let sync = SleepSync(session: h.session, caps: caps(dict: true), log: h.log.sink)
        _ = try await sync.sync(sinceSec: 1_700_000_000, end: 1_700_100_000)
        let initRequest = try XCTUnwrap(h.watch.requests.first { $0.command == 0x01 })
        XCTAssertEqual(try initRequest.tlv.int(0x05), 1_700_100_000 - 36 * 3600)
        XCTAssertEqual(try initRequest.tlv.int(0x06), 1_700_100_000)
        XCTAssertTrue(h.log.contains("TruSleep: sleep window widened from 1700000000 to 1699970400"))
    }

    func testSleepWindowIsKeptWhenSinceIsOlderThanThirtySixHours() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([.init(name: "sequence_data", typeByte: 0x16, fileId: 3, content: [])])
        let sync = SleepSync(session: h.session, caps: caps(dict: true), log: h.log.sink)
        _ = try await sync.sync(sinceSec: 1_600_000_000, end: 1_700_100_000)
        XCTAssertEqual(try XCTUnwrap(h.watch.requests.first { $0.command == 0x01 }.map { try? $0.tlv.int(0x05) }), 1_600_000_000)
        XCTAssertFalse(h.log.contains("widened"))
    }

    func testGatesAreLogged() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([.init(name: "sequence_data", typeByte: 0x16, fileId: 3, content: [])])
        let c = caps(dict: true, bedTime: true)
        _ = try await SleepSync(session: h.session, caps: c, log: h.log.sink).sync(sinceSec: 1, end: 2)
        let gates = try XCTUnwrap(h.log.messages.first { $0.hasPrefix("TruSleep gates:") })
        XCTAssertTrue(gates.contains("supportsTruSleep(07/16)=true supportsDictSleepSync(ExpandCapability 143)=true supportsBedTime(199)=true truSleepNewSync(SettingRelated)=true commands07=[0x16] expandCapability=\(c.expandCapabilities!.hexUpper)"), gates)
    }

    func testGatesWithoutCapabilities() async throws {
        let h = SleepFilesHarness()
        let c = DeviceCaps()
        let result = try await SleepSync(session: h.session, caps: c, log: h.log.sink).sync(sinceSec: 1, end: 2)
        XCTAssertEqual(result, .empty)
        XCTAssertTrue(h.log.contains("commands07=[none] expandCapability=none"))
        XCTAssertTrue(h.watch.requests.isEmpty)
    }

    /// GB does not fall back to the state/data files when the dictionary download fails; the failure is logged, not thrown.
    func testDictionaryFailureDoesNotFallBack() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([]) // the watch has no sequence_data: size 0xFFFFFFFF
        let result = try await SleepSync(session: h.session, caps: caps(dict: true), log: h.log.sink).sync(sinceSec: 1, end: 2)
        XCTAssertEqual(result, .empty)
        XCTAssertTrue(h.log.containsError("TruSleep: sleep download failed: sequence_data: invalid file size reported by device: -1"), "\(h.log.entries.suffix(3).map { $0.message })")
        XCTAssertEqual(h.watch.requests.compactMap { try? $0.tlv.string(0x01) }, ["sequence_data"])
    }

    /// A malformed file is a thrown Java exception in GB, caught by the Kotlin `sync`: logged, empty.
    func testBrokenSequenceFileIsLoggedAndEmpty() async throws {
        let h = SleepFilesHarness()
        var file = kotlinSequenceFile()
        file.removeLast(3) // the details run past the end: BufferUnderflowException
        _ = serveSequenceFile(h, file)
        let result = try await SleepSync(session: h.session, caps: caps(dict: true), log: h.log.sink).sync(sinceSec: 1, end: 2)
        XCTAssertEqual(result, .empty)
        XCTAssertTrue(h.log.containsError("TruSleep: sleep download failed: BufferUnderflowException"), "\(h.log.entries.suffix(3).map { $0.message })")
    }

    /// GB's SleepFileDownloadCallback: each file is independent. A failed sleep_data.bin leaves the state segments alone.
    func testFailedDataFileDoesNotStopTheStateFile() async throws {
        let state = le(1000, 4) + le(5000, 4) + Bytes(repeating: 0, count: 8)
        let h = SleepFilesHarness()
        _ = h.newSyncServer([.init(name: "sleep_state.bin", typeByte: 0x0e, fileId: 1, content: state)]) // no sleep_data.bin
        let result = try await SleepSync(session: h.session, caps: caps(dict: false), log: h.log.sink).sync(sinceSec: 1, end: 2)
        XCTAssertEqual(result.segments.map(Seg.init), [Seg(1000, 5000, 0x06, nil)])
        XCTAssertTrue(h.log.containsError("Error downloading file: sleep_data.bin: sleep_data.bin: invalid file size reported by device: -1"), "\(h.log.entries.map { $0.message })")
    }

    func testFailedStateFileGivesNoSegments() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([.init(name: "sleep_data.bin", typeByte: 0x0f, fileId: 2, content: [])])
        let result = try await SleepSync(session: h.session, caps: caps(dict: false), log: h.log.sink).sync(sinceSec: 1, end: 2)
        XCTAssertEqual(result, .empty)
        XCTAssertTrue(h.log.containsError("Error downloading file: sleep_state.bin"))
        XCTAssertTrue(h.log.contains("TruSleep: sleep state file empty"))
    }

    func testEmptyStateFileGivesNoSegments() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([
            .init(name: "sleep_state.bin", typeByte: 0x0e, fileId: 1, content: []),
            .init(name: "sleep_data.bin", typeByte: 0x0f, fileId: 2, content: []),
        ])
        let result = try await SleepSync(session: h.session, caps: caps(dict: false), log: h.log.sink).sync(sinceSec: 1, end: 2)
        XCTAssertEqual(result, .empty)
        XCTAssertTrue(h.log.contains("TruSleep: sleep state file empty"))
    }

    func testStateFileShorterThanARecordGivesNoResults() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([
            .init(name: "sleep_state.bin", typeByte: 0x0e, fileId: 1, content: Bytes(repeating: 1, count: 15)),
            .init(name: "sleep_data.bin", typeByte: 0x0f, fileId: 2, content: []),
        ])
        let result = try await SleepSync(session: h.session, caps: caps(dict: false), log: h.log.sink).sync(sinceSec: 1, end: 2)
        XCTAssertEqual(result, .empty)
        XCTAssertTrue(h.log.contains("TruSleep: no sleep results"))
    }

    /// A lost link aborts the caller (ActivitySync turns it into the sync failure).
    func testDisconnectIsRethrown() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([])
        await h.session.close(WearError(.disconnected, "link lost"))
        for dict in [true, false] {
            do {
                _ = try await SleepSync(session: h.session, caps: caps(dict: dict), log: h.log.sink).sync(sinceSec: 1, end: 2)
                XCTFail("expected the disconnect to propagate (dict \(dict))")
            } catch let e as WearError {
                XCTAssertEqual(e.code, .disconnected)
            }
        }
    }

    /// A timeout is not a disconnect: logged, empty.
    func testTimeoutIsLoggedNotThrown() async throws {
        let h = SleepFilesHarness()
        let server = serveSequenceFile(h, kotlinSequenceFile())
        server.silent = true
        server.timeout = 1
        let result = try await SleepSync(session: h.session, caps: caps(dict: true), log: h.log.sink).sync(sinceSec: 1, end: 2)
        XCTAssertEqual(result, .empty)
        XCTAssertTrue(h.log.containsError("TruSleep: sleep download failed: sequence_data: timeout was hit!"))
    }

    func testCancellationIsRethrown() async throws {
        let h = SleepFilesHarness()
        let server = serveSequenceFile(h, kotlinSequenceFile())
        server.silent = true
        server.timeout = 30
        let sync = SleepSync(session: h.session, caps: caps(dict: true), log: h.log.sink)
        let task = Task { try await sync.sync(sinceSec: 1, end: 2) }
        try await Task.sleep(nanoseconds: 300_000_000)
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("expected a cancellation")
        } catch is CancellationError {
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertFalse(h.log.containsError("sleep download failed"))
    }
}

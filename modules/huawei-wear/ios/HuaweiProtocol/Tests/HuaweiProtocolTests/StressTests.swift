import XCTest
@testable import HuaweiProtocol

/// The stress model, the 20/09 and 19/01 requests against the real Java (Fixtures/stress.json, bit for bit), the translated cases of Kotlin
/// HrvSpotTest, HrvMath, and the automatic stress exchange over a real session to a scripted watch.
final class StressTests: XCTestCase {
    let g = try! Golden.load("stress")

    private func ints(_ list: Any?) -> [Int] { (list as? [NSNumber])?.map(\.intValue) ?? [] }

    private func floats(_ bits: Any?) -> [Float]? { (bits as? [NSNumber])?.map { Float(bitPattern: UInt32(bitPattern: Int32(truncatingIfNeeded: $0.intValue))) } }

    private func bits(_ f: [Float]?) -> [Int]? { f?.map { Int(Int32(bitPattern: $0.bitPattern)) } }

    // MARK: model

    func testHrvFeaturesMatchTheJavaBitForBit() {
        let cases = g.list("calculations")
        XCTAssertGreaterThanOrEqual(cases.count, 100)
        var produced = 0
        for c in cases {
            let name = c.str("name")
            let actual = StressHRVCalculation().calculateStressHRVParameters(rri: ints(c["rri"]), sqi: ints(c["sqi"]), signalTime: c.int("signalTime"))
            let expected = floats(c["features"])
            XCTAssertEqual(bits(actual), bits(expected), name)
            if expected != nil { produced += 1 }
        }
        // The Java must have accepted a good share of them, or the comparison above proves little.
        XCTAssertGreaterThanOrEqual(produced, 20, "only \(produced) of \(cases.count) cases produced features")
    }

    func testScoreFactorScoreAndLevelMatchTheJava() {
        let scores = g.list("scores")
        XCTAssertGreaterThanOrEqual(scores.count, 35)
        for c in scores {
            let name = c.str("name")
            let features = floats(c["features"])!
            let factor = StressScoreCalculation.calculateScoreFactor(features)
            XCTAssertEqual(Int(Int32(bitPattern: factor.bitPattern)), c.int("factor"), name)
            let score = StressScoreCalculation.calculateNormalizedFinalScore(factor)
            XCTAssertEqual(Int(score), c.int("score"), name)
            XCTAssertEqual(Int(StressScoreCalculation.calculateLevel(Int(score))), c.int("level"), name)
        }
        for c in g.list("levels") {
            XCTAssertEqual(Int(StressScoreCalculation.calculateLevel(c.int("score"))), c.int("level"), "score \(c.int("score"))")
        }
    }

    func testRequestsMatchJava() throws {
        let requests = g.list("requests")
        XCTAssertEqual(requests.count, 8)
        for c in requests {
            let name = c.str("name")
            let packet: HuaweiPacket
            if c.int("service") == 0x20 {
                packet = Stress.AutomaticStress.request(
                    status: UInt8(truncatingIfNeeded: c.int("status")), score: UInt8(truncatingIfNeeded: c.int("score")), features: floats(c["features"]),
                    time: Int32(truncatingIfNeeded: c.int("time"))
                )
            } else {
                packet = HrRriTest.OpenOrClose.request(type: UInt8(c.int("type")))
            }
            XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name)
            XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name)
            XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name)
            XCTAssertEqual(packet.isSliced, c.bool("sliced"), name)
            XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), name)
            XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], name)
        }
    }

    // MARK: HrvSpotTest

    private let fixedRri = (0..<70).map { i in 860 + ((i * 37) % 61 - 30) + (i % 9 < 4 ? 20 : -20) }
    private var fixedBeats: [RriBeat] { fixedRri.map { RriBeat(rri: $0, sqi: 100) } }

    private func beat(_ rri: Int, _ sqi: Int) -> HuaweiTLV {
        var t = HuaweiTLV()
        t.put(0x04, short: Int16(truncatingIfNeeded: rri))
        t.put(0x05, byte: UInt8(sqi))
        return t
    }

    private func report(_ beats: HuaweiTLV...) -> HuaweiTLV {
        var container = HuaweiTLV()
        for b in beats { container.put(0x83, tlv: b) }
        var tlv = HuaweiTLV()
        tlv.put(0x82, tlv: container)
        return try! HuaweiTLV(parsing: tlv.serialize())
    }

    func testOpenAndCloseAreTag01WithTheMode() {
        XCTAssertEqual(HrRriTest.OpenOrClose.request(type: HrvSpotCodec.open).tlv!.serialize(), [0x01, 0x01, 0x03])
        XCTAssertEqual(HrRriTest.OpenOrClose.request(type: HrvSpotCodec.close).tlv!.serialize(), [0x01, 0x01, 0x04])
    }

    func testDecodesEveryBeatOfAReport() {
        let beats = HrvSpotCodec.decodeRri(report(beat(812, 100), beat(900, 0), beat(1023, 100)))
        XCTAssertEqual(beats.map(\.rri), [812, 900, 1023])
        XCTAssertEqual(beats.map(\.sqi), [100, 0, 100])
    }

    func testReadsTheIntervalUnsigned() {
        XCTAssertEqual(HrvSpotCodec.decodeRri(report(beat(0xFFFF, 100))).first?.rri, 65535)
    }

    func testSkipsABeatWithoutBothTagsAndIgnoresOtherPackets() throws {
        var half = HuaweiTLV()
        half.put(0x04, short: 800)
        var container = HuaweiTLV()
        container.put(0x83, tlv: half)
        container.put(0x83, tlv: beat(810, 100))
        var tlv = HuaweiTLV()
        tlv.put(0x82, tlv: container)
        XCTAssertEqual(HrvSpotCodec.decodeRri(try HuaweiTLV(parsing: tlv.serialize())).map(\.rri), [810])
        var other = HuaweiTLV()
        other.put(0x01, byte: 1)
        XCTAssertEqual(HrvSpotCodec.decodeRri(other).count, 0)
        XCTAssertEqual(HrvSpotCodec.decodeRri(nil).count, 0)
    }

    func testReadsSeveralContainersInOnePacket() throws {
        var first = HuaweiTLV()
        first.put(0x83, tlv: beat(800, 100))
        var second = HuaweiTLV()
        second.put(0x83, tlv: beat(820, 90))
        var tlv = HuaweiTLV()
        tlv.put(0x82, tlv: first)
        tlv.put(0x82, tlv: second)
        XCTAssertEqual(HrvSpotCodec.decodeRri(try HuaweiTLV(parsing: tlv.serialize())).map(\.rri), [800, 820])
    }

    func testTimelineLandsEachBeatAtTheEndOfItsInterval() {
        let timeline = HrvSpotCodec.rriTimeline(startMs: 1_000_000, beats: [RriBeat(rri: 800, sqi: 100), RriBeat(rri: 850, sqi: 0), RriBeat(rri: 900, sqi: 100)])
        XCTAssertEqual(timeline.map(\.tsMs), [1_000_800, 1_001_650, 1_002_550])
        XCTAssertEqual(timeline.map(\.beat.sqi), [100, 0, 100])
    }

    func testStressCalibrationMatchesGadgetbridgeOnTheKotlinTestInput() throws {
        let data = try XCTUnwrap(HrvSpotCodec.calibrateStress(beats: fixedBeats, startMs: 1_700_000_000_000, endMs: 1_700_000_060_000))
        // Reference: GB's classes run on fixedRri with signalTime 60 (the same numbers the Kotlin HrvSpotTest pins).
        let gbFeatureBits: [Int32] = [1100480512, 1074505231, 1120403456, 1060311596, 1107998886, 1146224640, 1062658984, 1105692218, 1125049433, 1118119659]
        XCTAssertEqual(data.features.count, 12)
        XCTAssertEqual(data.features.prefix(10).map { Int32(bitPattern: $0.bitPattern) }, gbFeatureBits)
        XCTAssertEqual(data.features[10], 0)
        XCTAssertEqual(data.features[11], 0)
        XCTAssertEqual(Int32(bitPattern: data.scoreFactor.bitPattern), 1079062597)
        XCTAssertEqual(data.score, 47)
        XCTAssertEqual(data.level, 2)
        XCTAssertEqual(data.startTime, 1_700_000_000_000)
        XCTAssertEqual(data.endTime, 1_700_000_060_000)
    }

    func testUnusableBeatsAreDroppedBeforeTheModelLikeGadgetbridge() throws {
        var withNoise: [RriBeat] = []
        for b in fixedBeats {
            withNoise.append(b)
            withNoise.append(RriBeat(rri: 2500, sqi: 0))
        }
        let clean = try XCTUnwrap(HrvSpotCodec.calibrateStress(beats: fixedBeats, startMs: 0, endMs: 60_000))
        let noisy = try XCTUnwrap(HrvSpotCodec.calibrateStress(beats: withNoise, startMs: 0, endMs: 60_000))
        XCTAssertEqual(clean.features, noisy.features)
        XCTAssertEqual(clean.score, noisy.score)
    }

    func testTheModelRefusesWhatGadgetbridgeRefuses() {
        XCTAssertNil(HrvSpotCodec.calibrateStress(beats: fixedBeats, startMs: 0, endMs: 45_000))
        XCTAssertNil(HrvSpotCodec.calibrateStress(beats: fixedBeats, startMs: 0, endMs: 75_000))
        XCTAssertNil(HrvSpotCodec.calibrateStress(beats: Array(fixedBeats.prefix(25)), startMs: 0, endMs: 60_000))
        XCTAssertNil(HrvSpotCodec.calibrateStress(beats: fixedRri.map { RriBeat(rri: $0, sqi: 50) }, startMs: 0, endMs: 60_000))
    }

    func testEnableSendsStatusScoreTwelveFloatsAndTheTimeInSeconds() throws {
        let data = try XCTUnwrap(HrvSpotCodec.calibrateStress(beats: fixedBeats, startMs: 1_700_000_000_000, endMs: 1_700_000_060_000))
        let packet = Stress.AutomaticStress.request(status: 1, score: UInt8(bitPattern: data.score), features: data.features, time: Int32(data.endTime / 1000))
        var expected: Bytes = [0x01, 0x01, 0x01, 0x02, 0x01, UInt8(bitPattern: data.score), 0x03, 48]
        for f in data.features { expected += [UInt8(f.bitPattern >> 24), UInt8((f.bitPattern >> 16) & 0xFF), UInt8((f.bitPattern >> 8) & 0xFF), UInt8(f.bitPattern & 0xFF)] }
        expected += [0x04, 0x04, 0x65, 0x53, 0xF1, 0x3C]  // 1_700_000_060
        XCTAssertEqual(packet.tlv!.serialize(), expected)
    }

    func testDisableSendsOnlyStatusTwo() {
        XCTAssertEqual(Stress.AutomaticStress.request(status: 2, score: 0, features: nil, time: 0).tlv!.serialize(), [0x01, 0x01, 0x02])
    }

    func testStoredCalibrationSurvivesItsJsonForm() throws {
        let data = try XCTUnwrap(HrvSpotCodec.calibrateStress(beats: fixedBeats, startMs: 1_700_000_000_000, endMs: 1_700_000_060_000))
        let back = try XCTUnwrap(StressData.fromJsonString(try XCTUnwrap(data.toJsonString())))
        XCTAssertEqual(back, data)
        XCTAssertEqual(back.features.map(\.bitPattern), data.features.map(\.bitPattern))
        XCTAssertEqual(back.scoreFactor.bitPattern, data.scoreFactor.bitPattern)
    }

    func testAnEmptyOrDamagedStoredCalibrationIsNil() throws {
        var data = try XCTUnwrap(HrvSpotCodec.calibrateStress(beats: fixedBeats, startMs: 1_700_000_000_000, endMs: 1_700_000_060_000))
        XCTAssertNil(StressData.fromJsonString("not json"))
        XCTAssertNil(StressData.fromJsonString("{}"))
        var noEnd = data
        noEnd.endTime = 0
        XCTAssertNil(StressData.fromJsonString(try XCTUnwrap(noEnd.toJsonString())))
        var noScore = data
        noScore.score = 0
        XCTAssertNil(StressData.fromJsonString(try XCTUnwrap(noScore.toJsonString())))
        var short = data
        short.features.removeLast()
        XCTAssertNil(StressData.fromJsonString(try XCTUnwrap(short.toJsonString())))
        data.scoreFactor = .nan
        XCTAssertNil(data.toJsonString(), "Java's JSONException on NaN")
    }

    // MARK: HrvMath

    func testHrvMathOnAConstantAlternation() throws {
        // 800, 850, 800, 850 ...: every successive difference is 50 ms, so RMSSD is 50; the mean is 825.
        let rr = (0..<60).map { $0 % 2 == 0 ? 800 : 850 }
        let r = try XCTUnwrap(HrvMath.compute(rr: rr))
        XCTAssertEqual(r.rmssd, 50, accuracy: 1e-9)
        XCTAssertEqual(r.meanRr, 825, accuracy: 1e-9)
        XCTAssertEqual(r.beats, 60)
        XCTAssertEqual(r.sdnn, (60.0 * 625.0 / 59.0).squareRoot(), accuracy: 1e-9)
    }

    func testHrvMathDropsUnusableAndOutOfRangeAndOddBeats() throws {
        var rr = Array(repeating: 800, count: 60)
        rr[10] = 250  // out of range
        rr[20] = 1600  // 20 % above the median of its neighbours
        let sqi = (0..<60).map { $0 == 30 ? 0 : 100 }
        let r = try XCTUnwrap(HrvMath.compute(rr: rr, sqi: sqi))
        XCTAssertEqual(r.beats, 57)
        XCTAssertEqual(r.rmssd, 0, accuracy: 1e-9)
        // A beat without a quality value is kept (Kotlin getOrNull).
        XCTAssertEqual(HrvMath.compute(rr: rr, sqi: [Int](repeating: 100, count: 40))?.beats, 58)
    }

    func testHrvMathNeedsEnoughCleanBeats() {
        XCTAssertNil(HrvMath.compute(rr: Array(repeating: 800, count: 39)))
        XCTAssertNotNil(HrvMath.compute(rr: Array(repeating: 800, count: 40)))
        // Plenty of beats, but alternate ones removed: no two clean beats are neighbours, so no successive differences.
        let sqi = (0..<80).map { $0 % 2 == 0 ? 100 : 0 }
        XCTAssertNil(HrvMath.compute(rr: Array(repeating: 800, count: 80), sqi: sqi))
    }

    // MARK: automatic stress over a session

    private func answer(_ code: Int32?) -> SleepFilesFakeWatch.Responder {
        { r in
            guard r.service == 0x20, r.command == 0x09 else { return [] }
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: 1)
            if let code { tlv.put(0x7f, int: code) }
            return [SleepFilesFakeWatch.tlvFrame(service: 0x20, command: 0x09, tlv)]
        }
    }

    func testTheSwitchOnReachesTheWatchAndTheAcceptedAnswerIsLogged() async throws {
        let h = SleepFilesHarness()
        h.watch.responder = answer(nil)
        let data = try XCTUnwrap(HrvSpotCodec.calibrateStress(beats: fixedBeats, startMs: 1_700_000_000_000, endMs: 1_700_000_060_000))
        try await StressSwitchProtocol.transmit(session: h.session, log: h.log.sink, status: 1, data: data, answerMs: 2000)
        let sent = try XCTUnwrap(h.watch.requests.first)
        XCTAssertEqual(sent.service, 0x20)
        XCTAssertEqual(sent.command, 0x09)
        XCTAssertTrue(sent.encrypted)
        XCTAssertEqual(try sent.tlv.byte(0x01), 1)
        XCTAssertEqual(try sent.tlv.byte(0x02), data.score)
        XCTAssertEqual(try sent.tlv.bytes(0x03).count, 48)
        XCTAssertEqual(try sent.tlv.int(0x04), 1_700_000_060)
        XCTAssertTrue(h.log.contains("AutomaticStress on (20/09): the watch answered"))
    }

    func testTheSwitchOffCarriesOnlyStatusTwo() async throws {
        let h = SleepFilesHarness()
        h.watch.responder = answer(100_000)
        try await StressSwitchProtocol.transmit(session: h.session, log: h.log.sink, status: 2, data: nil, answerMs: 2000)
        XCTAssertEqual(h.watch.requests.first?.tlv.serialize(), [0x01, 0x01, 0x02])
        XCTAssertTrue(h.log.contains("AutomaticStress off (20/09)"))
    }

    func testAWatchThatAnswersWithAnErrorCodeRejects() async {
        let h = SleepFilesHarness()
        h.watch.responder = answer(100_001)
        do {
            try await StressSwitchProtocol.transmit(session: h.session, log: h.log.sink, status: 2, data: nil, answerMs: 2000)
            XCTFail("an error code is a rejection")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .stressRejected)
            XCTAssertTrue(e.message.contains("100001"))
        } catch { XCTFail("\(error)") }
    }

    func testNoAnswerIsNotAnErrorBecauseGbDoesNotWaitEither() async throws {
        let h = SleepFilesHarness()
        try await StressSwitchProtocol.transmit(session: h.session, log: h.log.sink, status: 2, data: nil, answerMs: 100)
        XCTAssertTrue(h.log.contains("the watch did not answer within 0 s"))
        // The subscription is gone: a late answer is not routed anywhere that could fail.
        h.session.onData(SleepFilesFakeWatch.tlvFrame(service: 0x20, command: 0x09, HuaweiTLV()))
    }

    func testStressSupportIsCommand2009() {
        let caps = DeviceCaps()
        XCTAssertFalse(StressSwitchProtocol.supported(caps))
        caps.supportedCommands = [0x20: [0x09]]
        XCTAssertTrue(StressSwitchProtocol.supported(caps))
    }
}

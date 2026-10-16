import XCTest
@testable import HuaweiProtocol

/// Fall detection (DataSync config 900500038) and the morning sleep report (event 80030001): translations of the Kotlin WatchExtrasTest
/// vectors (hand-computed byte examples; nothing here was seen on a watch) plus extra cases.
final class SafetySleepReportTests: XCTestCase {
    private func plain() -> ParamsProvider {
        let p = ParamsProvider()
        p.transactionsCrypted = false
        p.sliceSize = 1022
        return p
    }

    private func text(_ bytes: Bytes?) -> String { String(decoding: bytes ?? [], as: UTF8.self) }

    /// The TLV of an unsliced, unencrypted packet: `5A len(2) 00 service command` then the TLV, then CRC16.
    private func tlv(_ packet: HuaweiPacket) throws -> HuaweiTLV {
        let out = try packet.serialize(params: plain())
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0][4], 0x37)
        return try HuaweiTLV(parsing: out[0], offset: 6, length: out[0].count - 8)
    }

    // MARK: fall detection

    func testFallConfigIsTheJsonHuaweiHealthWrites() {
        XCTAssertEqual(text(SafetyPayloads.fallConfig(enabled: true, timeStampMs: 1_791_979_200_000)), "{\"fallDetectionSwitch\":1,\"timeStamp\":1791979200000}")
        XCTAssertEqual(text(SafetyPayloads.fallConfig(enabled: false, timeStampMs: 5)), "{\"fallDetectionSwitch\":0,\"timeStamp\":5}")
    }

    func testFallConfigGoesOutAsConfigItemWithIdAndAction() throws {
        let item = ConfigItem(configId: SafetyPayloads.fallConfigId, action: 1, data: SafetyPayloads.fallConfig(enabled: true, timeStampMs: 7), modifyMs: nil)
        let t = try tlv(DataSyncWire.config(srcPkg: SafetyPayloads.fallPhonePackage, wearPkg: SafetyPayloads.fallWatchPackage, items: [item]))
        XCTAssertEqual(try t.string(0x01), "hw.unitedevice.sos")
        XCTAssertEqual(try t.string(0x02), "hw.watch.sos.help")
        let entry = try t.object(0x83).objects(0x84)[0]
        XCTAssertEqual(try entry.int(0x05), 900_500_038)
        XCTAssertEqual(try entry.byte(0x06), 1)
        XCTAssertEqual(text(try entry.bytes(0x07)), "{\"fallDetectionSwitch\":1,\"timeStamp\":7}")
    }

    func testFallConfigWireBytesAreExact() throws {
        let item = ConfigItem(configId: SafetyPayloads.fallConfigId, action: 1, data: SafetyPayloads.fallConfig(enabled: false, timeStampMs: 5), modifyMs: 6)
        let packet = DataSyncWire.config(srcPkg: SafetyPayloads.fallPhonePackage, wearPkg: SafetyPayloads.fallWatchPackage, items: [item])
        let body = (try packet.serialize(params: plain()))[0]
        // 01 "hw.unitedevice.sos" 02 "hw.watch.sos.help" 83{84{05 id 06 action 07 json 08 modify}}
        let json = Bytes("{\"fallDetectionSwitch\":0,\"timeStamp\":5}".utf8)
        let entry = Bytes([0x05, 0x04, 0x35, 0xAC, 0x8A, 0x46, 0x06, 0x01, 0x01, 0x07, UInt8(json.count)]) + json + [0x08, 0x08, 0, 0, 0, 0, 0, 0, 0, 6]
        let list = Bytes([0x84, UInt8(entry.count)]) + entry
        let expected = Bytes([0x01, 0x12]) + Bytes("hw.unitedevice.sos".utf8) + [0x02, 0x11] + Bytes("hw.watch.sos.help".utf8) + [0x83, UInt8(list.count)] + list
        XCTAssertEqual(Array(body[6..<(body.count - 2)]), expected)
        XCTAssertEqual(900_500_038, 0x35AC8A46)
    }

    func testFallQueryIsActionTwoWithoutData() throws {
        let item = ConfigItem(configId: SafetyPayloads.fallConfigId, action: 2, data: nil, modifyMs: nil)
        let t = try tlv(DataSyncWire.config(srcPkg: SafetyPayloads.fallPhonePackage, wearPkg: SafetyPayloads.fallWatchPackage, items: [item]))
        let entry = try t.object(0x83).objects(0x84)[0]
        XCTAssertEqual(try entry.byte(0x06), 2)
        XCTAssertFalse(entry.contains(0x07))
    }

    func testFallStateFromTheWatch() {
        let state = SafetyPayloads.parseFallConfig(Bytes("{\"fallDetectionSwitch\":1,\"timeStamp\":123}".utf8))
        XCTAssertEqual(state, SafetyPayloads.FallState(switchState: 1, timeStampMs: 123))
        XCTAssertNil(SafetyPayloads.parseFallConfig(Bytes("{\"fallDetectionSwitch\":7}".utf8)))
        XCTAssertNil(SafetyPayloads.parseFallConfig(Bytes("{\"other\":1}".utf8)))
        XCTAssertNil(SafetyPayloads.parseFallConfig(nil))
        XCTAssertNil(SafetyPayloads.parseFallConfig([]))
        XCTAssertNil(SafetyPayloads.parseFallConfig(Bytes("nope".utf8)))
        // Beyond the Kotlin cases: no timeStamp reads as 0; a bool or an array is not a switch; a string "0" coerces like optInt.
        XCTAssertEqual(SafetyPayloads.parseFallConfig(Bytes("{\"fallDetectionSwitch\":0}".utf8)), SafetyPayloads.FallState(switchState: 0, timeStampMs: 0))
        XCTAssertNil(SafetyPayloads.parseFallConfig(Bytes("{\"fallDetectionSwitch\":true}".utf8)))
        XCTAssertNil(SafetyPayloads.parseFallConfig(Bytes("[1]".utf8)))
        XCTAssertEqual(SafetyPayloads.parseFallConfig(Bytes("{\"fallDetectionSwitch\":\"0\",\"timeStamp\":1791979200000}".utf8))?.timeStampMs, 1_791_979_200_000)
    }

    // MARK: sleep report

    private let jakarta = TimeZone(identifier: "Asia/Jakarta")!

    // 2026-10-13T17:00Z is 2026-10-14 00:00 in Jakarta (UTC+7), so hour 0.0 below is local midnight.
    private func seg(_ startHour: Double, _ endHour: Double, _ stage: String?, baseDay: Int64 = 1_791_936_000 - 7 * 3600) -> SleepSegment {
        SleepSegment(start: baseDay + Int64(startHour * 3600), end: baseDay + Int64(endHour * 3600), type: 6, stage: stage)
    }

    private var night: [SleepSegment] {
        [seg(-1.0, 0.5, "light"), seg(0.5, 1.5, "deep"), seg(1.5, 3.0, "rem"), seg(3.0, 6.25, "light"), seg(6.25, 6.5, "awake")]
    }

    func testLastNightChainsSegmentsAndSumsStages() throws {
        let old = SleepSegment(start: night.first!.start - 30 * 3600, end: night.first!.start - 26 * 3600, type: 6, stage: "light")
        let summary = try XCTUnwrap(SleepReport.lastNight([old] + night))
        XCTAssertEqual(summary.start, night.first!.start)
        XCTAssertEqual(summary.end, night.last!.end)
        XCTAssertEqual(Double(summary.totalSec), 7.5 * 3600, accuracy: 0.5)
        XCTAssertEqual(summary.deepSec, 3600)
        XCTAssertEqual(summary.remSec, 5400)
        XCTAssertEqual(summary.awakeSec, 900)
        XCTAssertEqual(Double(summary.lightSec), (1.5 + 3.25) * 3600, accuracy: 0.5)
        XCTAssertTrue(summary.hasStages)
        XCTAssertNil(SleepReport.lastNight([]))
    }

    func testStrayUnstagedSegmentsNextToStagedOnesAreDropped() throws {
        let stray = SleepSegment(start: night.first!.start - 2 * 3600, end: night.first!.start - 3600, type: 6, stage: nil)
        let napFar = SleepSegment(start: night.first!.start - 30 * 3600, end: night.first!.start - 28 * 3600, type: 6, stage: nil)
        XCTAssertEqual(SleepReport.withoutStrayUnstaged([stray] + night), night)
        XCTAssertEqual(SleepReport.withoutStrayUnstaged([napFar] + night), [napFar] + night)
        XCTAssertEqual(try XCTUnwrap(SleepReport.lastNight([stray] + night)).start, night.first!.start)
        // Only unstaged: no stages, still a night.
        let unstaged = try XCTUnwrap(SleepReport.lastNight([napFar]))
        XCTAssertFalse(unstaged.hasStages)
        XCTAssertEqual(unstaged.totalSec, 7200)
    }

    func testReportTextCarriesDurationClockTimesAndStages() throws {
        let summary = try XCTUnwrap(SleepReport.lastNight(night))
        let message = SleepReport.message(summary, zone: jakarta, language: "id", country: "ID")
        XCTAssertEqual(message.title, "Sleep report")
        XCTAssertEqual(message.description, "7 h 30 min asleep, 23:00 to 06:30. Deep 1 h 00 min, REM 1 h 30 min, Light 4 h 45 min.")
        XCTAssertEqual(message.locale, "id-ID")
        XCTAssertEqual(message.openLabel, "Open app")
        XCTAssertEqual(message.ignoreLabel, "Ignore")
        XCTAssertEqual(message.openUri, "joyofit://today")
        XCTAssertEqual(message.ignoreUri, "joyofit://today")
        XCTAssertEqual(SleepReport.localeTag(language: nil, country: nil), "en-US")
        XCTAssertEqual(SleepReport.localeTag(language: "", country: ""), "en-US")
        XCTAssertEqual(SleepReport.localeTag(language: "de", country: nil), "de-US")
    }

    func testReportTextWithoutStagesHasOnlyTheDuration() {
        let n = SleepNight(start: 1_791_936_000 - 7 * 3600, end: 1_791_936_000 - 7 * 3600 + 5 * 3600, totalSec: 5 * 3600, lightSec: 0, deepSec: 0, remSec: 0, awakeSec: 0)
        XCTAssertEqual(SleepReport.message(n, zone: jakarta, language: "en", country: "US").description, "5 h 00 min asleep, 00:00 to 05:00.")
    }

    func testReportPayloadIsTagsSixToTwelveAsUtf8Strings() throws {
        let message = SleepReport.Message(title: "T", description: "D", openLabel: "O", ignoreLabel: "I", locale: "en-US", openUri: "joyofit://a", ignoreUri: "joyofit://b")
        let payload = SleepReport.payload(message)
        let t = try HuaweiTLV(parsing: payload)
        XCTAssertEqual(try t.string(0x06), "T")
        XCTAssertEqual(try t.string(0x07), "D")
        XCTAssertEqual(try t.string(0x08), "O")
        XCTAssertEqual(try t.string(0x09), "I")
        XCTAssertEqual(try t.string(0x0A), "en-US")
        XCTAssertEqual(try t.string(0x0B), "joyofit://a")
        XCTAssertEqual(try t.string(0x0C), "joyofit://b")
        XCTAssertEqual(Array(payload[0..<6]), [0x06, 0x01, 0x54, 0x07, 0x01, 0x44])
        XCTAssertEqual(payload.count, 45)
    }

    func testReportGoesOutAsEvent80030001() throws {
        let t = try tlv(DataSyncWire.event(srcPkg: SleepReport.phonePackage, wearPkg: SleepReport.watchPackage, eventId: SleepReport.eventId, level: 0, data: [0x06, 0x01, 0x54]))
        XCTAssertEqual(try t.string(0x01), "hw.unitedevice.sleepnotification")
        XCTAssertEqual(try t.string(0x02), "hw.watch.health.sleep")
        XCTAssertEqual(try t.bytes(0x03), [0x04, 0xC5, 0x29, 0x31])
        XCTAssertEqual(try t.bytes(0x04), [0x00])
        XCTAssertEqual(try t.bytes(0x05), [0x06, 0x01, 0x54])
    }

    func testReportIsPushedOnceInTheMorning() throws {
        let summary = try XCTUnwrap(SleepReport.lastNight(night))
        let wake = summary.end
        XCTAssertNil(SleepReport.shouldPush(summary, nowSec: wake + 1800, zone: jakarta, lastReportedEnd: 0))
        XCTAssertNotNil(SleepReport.shouldPush(summary, nowSec: wake + 1800, zone: jakarta, lastReportedEnd: wake), "pushed already")
        XCTAssertNotNil(SleepReport.shouldPush(summary, nowSec: wake + 9 * 3600, zone: jakarta, lastReportedEnd: 0), "too late")
        let nap = try XCTUnwrap(SleepReport.lastNight([SleepSegment(start: wake + 4 * 3600, end: wake + 5 * 3600, type: 6, stage: "light")]))
        XCTAssertNotNil(SleepReport.shouldPush(nap, nowSec: wake + 5 * 3600 + 60, zone: jakarta, lastReportedEnd: 0), "a nap")
        // Woke at 23:30 yesterday, synced at 04:30: ended on another local day, not this morning.
        let lateEnd = wake - 7 * 3600
        let lateNight = SleepNight(start: lateEnd - 4 * 3600, end: lateEnd, totalSec: 4 * 3600, lightSec: 0, deepSec: 0, remSec: 0, awakeSec: 0)
        XCTAssertNotNil(SleepReport.shouldPush(lateNight, nowSec: lateEnd + 5 * 3600, zone: jakarta, lastReportedEnd: 0), "ended yesterday")
    }

    func testPushReasonsAreTheAndroidTexts() throws {
        let summary = try XCTUnwrap(SleepReport.lastNight(night))
        let wake = summary.end
        XCTAssertEqual(SleepReport.shouldPush(summary, nowSec: wake, zone: jakarta, lastReportedEnd: wake), "already reported (session end \(wake) <= \(wake))")
        XCTAssertEqual(SleepReport.shouldPush(summary, nowSec: wake + 9 * 3600, zone: jakarta, lastReportedEnd: 0), "ended 9 h ago, too late for a morning report")
        let short = SleepNight(start: wake - 3600, end: wake, totalSec: 3600, lightSec: 0, deepSec: 0, remSec: 0, awakeSec: 0)
        XCTAssertEqual(SleepReport.shouldPush(short, nowSec: wake, zone: jakarta, lastReportedEnd: 0), "only 60 min of sleep, a nap")
        let lateEnd = wake - 7 * 3600
        let late = SleepNight(start: lateEnd - 4 * 3600, end: lateEnd, totalSec: 4 * 3600, lightSec: 0, deepSec: 0, remSec: 0, awakeSec: 0)
        XCTAssertEqual(SleepReport.shouldPush(late, nowSec: lateEnd + 5 * 3600, zone: jakarta, lastReportedEnd: 0), "the session ended on 2026-10-13, not today (2026-10-14)")
    }

    func testWatchAckIsTheNumberOne() {
        XCTAssertTrue(SleepReport.acknowledged([0x01]))
        XCTAssertTrue(SleepReport.acknowledged([0, 0, 0, 1]))
        XCTAssertFalse(SleepReport.acknowledged([0x02]))
        XCTAssertFalse(SleepReport.acknowledged([0, 0, 0, 0, 1]))
        XCTAssertFalse(SleepReport.acknowledged(nil))
        XCTAssertFalse(SleepReport.acknowledged([]))
    }

    func testDurationRoundsToMinutes() {
        XCTAssertEqual(SleepReport.duration(45 * 60), "45 min")
        XCTAssertEqual(SleepReport.duration(65 * 60 + 20), "1 h 05 min")
        XCTAssertEqual(SleepReport.duration(8 * 3600), "8 h 00 min")
        XCTAssertEqual(SleepReport.duration(29), "0 min")
        XCTAssertEqual(SleepReport.duration(30), "1 min")
    }
}

/// The SOS request parse and answer: translations of the Kotlin WatchExtrasTest vectors plus the org.json formatting the answer echoes.
final class SafetySosPayloadTests: XCTestCase {
    private func text(_ bytes: Bytes) -> String { String(decoding: bytes, as: UTF8.self) }

    func testSosRequestIsParsedAndAnsweredWithStatus() throws {
        let raw = "{\"phoneNumber\":\"+6281234567890\",\"content\":\"Help, I fell.\",\"extra\":3}"
        guard case .ok(let request) = SafetyPayloads.parseSos(Bytes(raw.utf8)) else { return XCTFail("not parsed") }
        XCTAssertEqual(request.phoneNumber, "+6281234567890")
        XCTAssertEqual(request.content, "Help, I fell.")
        XCTAssertEqual(request.raw, raw)
        XCTAssertEqual(text(SafetyPayloads.sosAnswer(raw: request.raw, sent: true)), "{\"phoneNumber\":\"+6281234567890\",\"content\":\"Help, I fell.\",\"extra\":3,\"status\":\"0\"}")
        XCTAssertEqual(text(SafetyPayloads.sosAnswer(raw: request.raw, sent: false)), "{\"phoneNumber\":\"+6281234567890\",\"content\":\"Help, I fell.\",\"extra\":3,\"status\":\"1\"}")
    }

    func testBadSosRequestsAreRefused() {
        for data in [nil, [], Bytes("not json".utf8), Bytes("[1]".utf8), Bytes("{\"phoneNumber\":".utf8)] as [Bytes?] {
            guard case .bad(_, let raw) = SafetyPayloads.parseSos(data) else { return XCTFail("parsed \(String(describing: data))") }
            XCTAssertNil(raw)
        }
        guard case .bad(let reason, let raw) = SafetyPayloads.parseSos(Bytes("{\"phoneNumber\":\"123\",\"content\":\"\"}".utf8)) else { return XCTFail() }
        XCTAssertEqual(reason, "phoneNumber or content is missing or empty")
        XCTAssertNotNil(raw)
        guard case .bad = SafetyPayloads.parseSos(Bytes("{\"phoneNumber\":\" \",\"content\":\"x\"}".utf8)) else { return XCTFail() }
        XCTAssertEqual(text(SafetyPayloads.sosAnswer(raw: nil, sent: false)), "{\"status\":\"1\"}")
        XCTAssertEqual(text(SafetyPayloads.sosAnswer(raw: "garbage", sent: false)), "{\"status\":\"1\"}")
    }

    func testTheAnswerKeepsOrderEscapesLikeOrgJsonAndReplacesAStatus() {
        let raw = "{\"phoneNumber\":\"1\",\"content\":\"a/b \\\"q\\\" \\u00e9\\n\",\"status\":\"9\",\"n\":[1,2.5,{\"k\":null}],\"t\":true}"
        XCTAssertEqual(
            text(SafetyPayloads.sosAnswer(raw: raw, sent: true)),
            "{\"phoneNumber\":\"1\",\"content\":\"a\\/b \\\"q\\\" \u{e9}\\n\",\"status\":\"0\",\"n\":[1,2.5,{\"k\":null}],\"t\":true}"
        )
        XCTAssertEqual(text(SafetyPayloads.sosAnswer(raw: "{\"a\":1,\"a\":2}", sent: false)), "{\"a\":2,\"status\":\"1\"}")
        XCTAssertEqual(text(SafetyPayloads.sosAnswer(raw: "{\"c\":\"\\u0001\"}", sent: false)), "{\"c\":\"\\u0001\",\"status\":\"1\"}")
    }

    func testAnswerGoesOutAsEventEightHundredMillionFortyAtLevelZero() throws {
        let p = ParamsProvider()
        p.transactionsCrypted = false
        p.sliceSize = 1022
        let packet = DataSyncWire.event(
            srcPkg: SafetyPayloads.sosPhonePackage, wearPkg: SafetyPayloads.sosWatchPackage, eventId: SafetyPayloads.sosEventId, level: 0,
            data: SafetyPayloads.sosAnswer(raw: "{\"phoneNumber\":\"1\",\"content\":\"x\"}", sent: true)
        )
        let out = try packet.serialize(params: p)[0]
        let t = try HuaweiTLV(parsing: out, offset: 6, length: out.count - 8)
        XCTAssertEqual(try t.string(0x01), "hw.unitedevice.safetyguard")
        XCTAssertEqual(try t.string(0x02), "hw.watch.safetyguard")
        XCTAssertEqual(try t.bytes(0x03), [0x2F, 0xB0, 0x8E, 0xC8])
        XCTAssertEqual(try t.bytes(0x04), [0x00])
        XCTAssertEqual(text(try t.bytes(0x05)), "{\"phoneNumber\":\"1\",\"content\":\"x\",\"status\":\"0\"}")
    }

    func testNumbersAreMaskedInLogs() {
        XCTAssertEqual(SafetyPayloads.maskNumber("+6281234567890"), String(repeating: "*", count: 11) + "90")
        XCTAssertEqual(SafetyPayloads.maskNumber("(021) 555 01 21"), String(repeating: "*", count: 8) + "21")
        XCTAssertEqual(SafetyPayloads.maskNumber("7"), "**")
    }
}

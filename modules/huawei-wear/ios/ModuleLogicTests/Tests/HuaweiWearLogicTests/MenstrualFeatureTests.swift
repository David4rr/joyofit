import XCTest
@testable import HuaweiWearLogic

/// The cycle calendar end to end without Bluetooth: the SQLite log, the settings, a real `HuaweiSession` over the DataSync rig's recording watch.
/// Expectations are those of MenstrualFeature.kt.
final class MenstrualFeatureTests: XCTestCase {
    private let utc = TimeZone(secondsFromGMT: 0)!
    /// 2026-10-14 10:00 UTC.
    private let nowDate = Date(timeIntervalSince1970: 1_791_972_000)

    private func day(_ text: String) -> CivilDate { CivilDate(text)! }

    private struct Rig {
        let feature: MenstrualFeature
        let store: CycleStore
        let settings: CycleSettings
        let watch: DataSyncRig
    }

    /// 0x32 listed (command 01), ExpandCapability 83, 173, 174 and 265 set unless `bits` says otherwise.
    private func makeRig(enabled: Bool = true, connected: Bool = true, commands: [Int: Bytes] = [0x32: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]], bits: [Int] = [83, 173, 174, 265]) -> Rig {
        let watch = DataSyncRig(bits: [83], connected: connected)
        var bitmap = Bytes(repeating: 0, count: 40)
        for bit in bits { bitmap[bit / 8] |= UInt8(1 << (bit % 8)) }
        watch.caps.expandCapabilities = bitmap
        watch.caps.supportedCommands = commands
        let settings = CycleSettings(defaults: ephemeralDefaults())
        settings.enabled = enabled
        let store = CycleStore(store: SyncStore(url: temporaryDatabaseURL()))
        let now = nowDate
        let utc = self.utc
        let feature = MenstrualFeature(settings: settings, store: store, link: watch.source, events: watch.events, now: { now }, zone: { utc })
        watch.service.register(feature)
        return Rig(feature: feature, store: store, settings: settings, watch: watch)
    }

    private func seed(_ rig: Rig) throws {
        for (start, end) in [("2026-07-01", "2026-07-05"), ("2026-07-29", "2026-08-02"), ("2026-08-26", "2026-08-30"), ("2026-09-23", "2026-09-27")] {
            try rig.store.addPeriod(start: day(start), end: day(end), nowSec: 1_790_000_000)
        }
    }

    private func keys(_ rig: Rig, after: Int = 0) -> [String] { rig.watch.watch.sent.dropFirst(after).map { String(format: "%02x/%02x", $0.service, $0.command) } }

    private func watchAsks(_ rig: Rig, _ command: UInt8, _ tlv: HuaweiTLV) async {
        rig.watch.session.onData(WeatherScriptedWatch.tlvFrame(service: 0x32, command: command, tlv))
        try? await Task.sleep(nanoseconds: 150_000_000)
        await rig.feature.settle()
    }

    private func connect(_ rig: Rig) async {
        await rig.feature.linkConnected(rig.watch.source.current!)
    }

    // MARK: store

    func testTheStoreKeepsPeriodsDaysAndTheNewestChange() throws {
        let store = CycleStore(store: SyncStore(url: temporaryDatabaseURL()))
        XCTAssertEqual(try store.periods(), [])
        XCTAssertNil(try store.lastModified())
        try store.startPeriod(day("2026-09-23"), nowSec: 100)
        XCTAssertEqual(try store.periods(), [LoggedPeriod(start: day("2026-09-23"), end: nil)])
        try store.endPeriod(day("2026-09-27"), nowSec: 200)
        try store.addPeriod(start: day("2026-08-26"), end: day("2026-08-30"), nowSec: 150)
        XCTAssertEqual(try store.periods().map { "\($0.start)..\($0.end!)" }, ["2026-08-26..2026-08-30", "2026-09-23..2026-09-27"])
        XCTAssertEqual(try store.lastModified(), 200)
        try store.logDay(day("2026-09-24"), flow: 2, cramps: 1, nowSec: 300)
        try store.logDay(day("2026-09-24"), flow: 0, cramps: 0, nowSec: 400)
        try store.logDay(day("2026-09-20"), flow: 1, cramps: 0, nowSec: 250)
        XCTAssertEqual(try store.days(since: day("2026-09-01")), [
            LoggedDay(day: day("2026-09-20"), flow: 1, cramps: 0, modifiedSec: 250), LoggedDay(day: day("2026-09-24"), flow: 0, cramps: 0, modifiedSec: 400),
        ])
        XCTAssertEqual(try store.days(since: day("2026-09-21")).count, 1)
        XCTAssertEqual(try store.lastModified(), 400)
        try store.deletePeriod(day("2026-08-26"))
        XCTAssertEqual(try store.periods().count, 1)
    }

    func testTheSettingsDefaultToOffWithTheAndroidSwitches() {
        let settings = CycleSettings(defaults: ephemeralDefaults())
        XCTAssertFalse(settings.enabled)
        XCTAssertEqual(settings.switches, MenstrualCodec.Switches())
        XCTAssertFalse(settings.switches.master)
        settings.enabled = true
        settings.switches = MenstrualCodec.Switches(master: true, periodStart: false, periodEnd: true, fertileStart: false, fertileEnd: true, easyPregnancy: true)
        XCTAssertTrue(settings.enabled)
        XCTAssertEqual(settings.switches.bitfield(includeEasyPregnancy: true), 0b110101)
    }

    // MARK: log through the feature

    func testLoggingIsValidatedStoredAndRefusedLikeOnAndroid() throws {
        let rig = makeRig(enabled: false, connected: false)
        try rig.feature.startPeriod("2026-10-10")
        XCTAssertThrowsError(try rig.feature.startPeriod("2026-10-12")) { XCTAssertEqual(($0 as? WearError)?.message, "A period started on 2026-10-10 is still open; end it first") }
        XCTAssertThrowsError(try rig.feature.endPeriod("2026-10-15")) { XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument) }
        try rig.feature.endPeriod("2026-10-13")
        XCTAssertThrowsError(try rig.feature.addPeriod(start: "2026-10-12", end: "2026-10-14"))
        try rig.feature.addPeriod(start: "2026-09-10", end: "2026-09-14")
        XCTAssertThrowsError(try rig.feature.logDay("2026-10-15", flow: 1, cramps: 1))
        XCTAssertThrowsError(try rig.feature.logDay("2026-10-14", flow: 4, cramps: 1))
        XCTAssertThrowsError(try rig.feature.logDay("14-10-2026", flow: 1, cramps: 1)) { XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument) }
        try rig.feature.logDay("2026-10-12", flow: 3, cramps: 2)
        try rig.feature.deletePeriod("2026-09-10")
        let overview = try rig.feature.overview()
        XCTAssertEqual((overview["periods"] as? [[String: Any]])?.count, 1)
        XCTAssertEqual((overview["days"] as? [[String: Any]])?.first?["flow"] as? Int, 3)
        XCTAssertTrue(rig.watch.watch.sent.isEmpty, "off in settings and no watch: nothing goes out")
        XCTAssertTrue(rig.watch.events.contains("Cycle log: period started 2026-10-10"))
    }

    // MARK: overview

    func testTheOverviewMatchesTheTypeScriptShapeAndTheModel() throws {
        let rig = makeRig()
        try seed(rig)
        try rig.store.logDay(day("2026-09-24"), flow: 2, cramps: 1, nowSec: 1_790_000_100)
        try rig.store.logDay(day("2025-01-01"), flow: 2, cramps: 1, nowSec: 1_790_000_100)
        let o = try rig.feature.overview()
        XCTAssertEqual(Set(o.keys), ["today", "enabled", "periods", "days", "predictions", "averageCycleDays", "averagePeriodDays", "periodOngoing", "daysLate", "switches", "watchConnected", "watchSupported", "watchNote", "easyPregnancySwitch"])
        XCTAssertEqual(o["today"] as? String, "2026-10-14")
        XCTAssertEqual(o["enabled"] as? Bool, true)
        XCTAssertEqual(o["averageCycleDays"] as? Int, 28)
        XCTAssertEqual(o["averagePeriodDays"] as? Int, 5)
        XCTAssertEqual(o["periodOngoing"] as? Bool, false)
        XCTAssertEqual(o["daysLate"] as? Int, 0)
        XCTAssertEqual((o["periods"] as? [[String: Any]])?.last?["end"] as? String, "2026-09-27")
        XCTAssertEqual((o["days"] as? [[String: Any]])?.count, 1, "only the last 120 days")
        let predictions = try XCTUnwrap(o["predictions"] as? [[String: Any]])
        XCTAssertEqual(predictions.count, 3)
        XCTAssertEqual(predictions[0]["start"] as? String, "2026-10-21")
        XCTAssertEqual(predictions[0]["end"] as? String, "2026-10-25")
        XCTAssertEqual(predictions[0]["ovulation"] as? String, "2026-10-07")
        XCTAssertEqual(predictions[0]["fertileStart"] as? String, "2026-10-02")
        XCTAssertEqual(predictions[0]["fertileEnd"] as? String, "2026-10-08")
        XCTAssertEqual(Set((o["switches"] as? [String: Any] ?? [:]).keys), ["master", "periodStart", "periodEnd", "fertileStart", "fertileEnd", "easyPregnancy"])
        XCTAssertEqual(o["watchConnected"] as? Bool, true)
        XCTAssertEqual(o["watchSupported"] as? Bool, true)
        XCTAssertEqual(o["watchNote"] as? String, "the watch lists the menstrual service and flow dictionary")
        XCTAssertEqual(o["easyPregnancySwitch"] as? Bool, true)
    }

    func testTheOverviewWithoutAWatchOrLogSaysWhy() throws {
        let rig = makeRig(enabled: false, connected: false)
        let o = try rig.feature.overview()
        XCTAssertEqual(o["watchConnected"] as? Bool, false)
        XCTAssertEqual(o["watchSupported"] as? Bool, false)
        XCTAssertEqual(o["watchNote"] as? String, "no watch connected")
        XCTAssertEqual((o["periods"] as? [Any])?.count, 0)
        XCTAssertEqual((o["predictions"] as? [Any])?.count, 0)
        XCTAssertEqual(o["averageCycleDays"] as? Int, 28)
        let unlisted = makeRig(commands: [0x0F: [0x01]])
        let unlistedOverview = try unlisted.feature.overview()
        XCTAssertEqual(unlistedOverview["watchSupported"] as? Bool, false)
        XCTAssertEqual(unlistedOverview["watchNote"] as? String, "the watch does not list the menstrual service (0x32 command 01)")
    }

    func testAnOpenPeriodShowsInTheOverviewWithANullEnd() throws {
        let rig = makeRig()
        try rig.feature.startPeriod("2026-10-12")
        let periods = try XCTUnwrap(try rig.feature.overview()["periods"] as? [[String: Any]])
        XCTAssertTrue(periods[0]["end"] is NSNull)
        XCTAssertEqual(try rig.feature.overview()["periodOngoing"] as? Bool, true)
        // The JSON the JS side receives must serialize.
        XCTAssertNoThrow(try JSONSerialization.data(withJSONObject: try rig.feature.overview()))
    }

    // MARK: phone -> watch

    func testSyncSendsCapabilitySwitchesUpdateNoticeAndTheDictionary() async throws {
        let rig = makeRig()
        try seed(rig)
        try rig.store.logDay(day("2026-10-10"), flow: 2, cramps: 1, nowSec: 1_791_000_000)
        rig.settings.switches = MenstrualCodec.Switches(master: true, periodStart: true, periodEnd: false, fertileStart: false, fertileEnd: false, easyPregnancy: true)
        await rig.feature.syncToWatch("test")
        XCTAssertEqual(keys(rig), ["32/05", "32/01", "32/04", "37/04"])
        let sent = rig.watch.watch.sent
        XCTAssertEqual(try sent[0].tlv.bytes(0x01), [3], "ExpandCapability 174 and 173: dictionary")
        XCTAssertEqual(try sent[1].tlv.bytes(0x01), [0b100011], "easy pregnancy goes along with ExpandCapability 265")
        XCTAssertTrue(sent[2].tlv.serialize().isEmpty)
        let dict = try DataSyncWire.parseDictionary(sent[3].tlv)
        XCTAssertEqual(dict.dictId, 400_018)
        XCTAssertEqual(dict.rows.count, 2)
        XCTAssertEqual(dict.rows[0].values[0].key, 400_018_149)
        XCTAssertEqual(dict.rows[0].values[0].value, [0, 0, 0, 2])
        XCTAssertEqual(dict.rows[1].values[0].value, [0, 0, 0, 1])
    }

    func testWithoutExpandCapabilitiesTheCapabilityIsTwoAndEasyPregnancyStaysOut() async throws {
        let rig = makeRig(bits: [])
        rig.settings.switches = MenstrualCodec.Switches(master: true, easyPregnancy: true)
        await rig.feature.syncToWatch("test")
        XCTAssertEqual(keys(rig), ["32/05", "32/01", "32/04"])
        XCTAssertEqual(try rig.watch.watch.sent[0].tlv.bytes(0x01), [2])
        XCTAssertEqual(try rig.watch.watch.sent[1].tlv.bytes(0x01), [0b001111])
    }

    func testNothingIsSentWhileOffWithoutAWatchOrWithoutTheServiceListed() async {
        let off = makeRig(enabled: false)
        await off.feature.syncToWatch("test")
        XCTAssertTrue(off.watch.watch.sent.isEmpty)
        XCTAssertTrue(off.watch.events.contains("skipped, off in settings"))
        let none = makeRig(connected: false)
        await none.feature.syncToWatch("test")
        XCTAssertTrue(none.watch.events.contains("skipped, no watch connected"))
        let unlisted = makeRig(commands: [0x0F: [0x01]])
        await unlisted.feature.syncToWatch("test")
        XCTAssertTrue(unlisted.watch.watch.sent.isEmpty)
        XCTAssertTrue(unlisted.watch.events.contains("does not list the menstrual service"))
    }

    func testConnectSyncsWhenOnAndStaysQuietWhenOff() async throws {
        let on = makeRig()
        await on.watch.attach()
        XCTAssertEqual(keys(on).prefix(3), ["32/05", "32/01", "32/04"])
        let off = makeRig(enabled: false)
        await off.watch.attach()
        XCTAssertTrue(off.watch.watch.sent.isEmpty)
        XCTAssertTrue(off.watch.events.contains("Menstrual: off in settings, nothing sent"))
    }

    func testSwitchingOffClearsTheMasterSwitchOnTheWatch() async throws {
        let rig = makeRig()
        rig.settings.switches = MenstrualCodec.Switches(master: true, periodStart: true, periodEnd: true, fertileStart: true, fertileEnd: false)
        rig.feature.setEnabled(false)
        await rig.feature.settle()
        XCTAssertFalse(rig.settings.enabled)
        XCTAssertEqual(keys(rig), ["32/01"])
        XCTAssertEqual(try rig.watch.watch.sent[0].tlv.bytes(0x01), [0b001110], "the stored switches stay, only the master bit is off")
        XCTAssertTrue(rig.settings.switches.master)
    }

    func testSwitchingOnAndChangingSwitchesSyncs() async throws {
        let rig = makeRig(enabled: false)
        rig.feature.setEnabled(true)
        await rig.feature.settle()
        XCTAssertEqual(keys(rig).prefix(3), ["32/05", "32/01", "32/04"])
        let before = rig.watch.watch.sent.count
        rig.feature.setSwitches(MenstrualCodec.Switches(master: true, periodStart: false, periodEnd: false, fertileStart: true, fertileEnd: true))
        await rig.feature.settle()
        XCTAssertEqual(try rig.watch.watch.sent[before + 1].tlv.bytes(0x01), [0b011001])
        XCTAssertTrue(rig.settings.switches.master)
    }

    func testEveryLogChangeIsFollowedByASyncWhenOn() async throws {
        let rig = makeRig()
        try rig.feature.startPeriod("2026-10-12")
        await rig.feature.settle()
        XCTAssertEqual(keys(rig).prefix(3), ["32/05", "32/01", "32/04"])
        let before = rig.watch.watch.sent.count
        try rig.feature.logDay("2026-10-13", flow: 1, cramps: 0)
        await rig.feature.settle()
        XCTAssertEqual(keys(rig, after: before).prefix(3), ["32/05", "32/01", "32/04"])
        XCTAssertTrue(keys(rig, after: before).contains("37/04"), "the new day goes out as dictionary rows")
    }

    // MARK: watch -> phone

    func testTheWatchAsksForTheModifyTime() async throws {
        let rig = makeRig()
        await connect(rig)
        await watchAsks(rig, 0x02, HuaweiTLV())
        XCTAssertEqual(keys(rig), ["32/02"])
        XCTAssertEqual(rig.watch.watch.sent[0].tlv.serialize(), MenstrualCodec.noData().serialize(), "nothing logged: no data")
        try seed(rig)
        await watchAsks(rig, 0x02, HuaweiTLV())
        XCTAssertEqual(try rig.watch.watch.sent[1].tlv.int(0x01), 1_790_000_000)
    }

    func testTheWatchAsksForTheCycleList() async throws {
        let rig = makeRig()
        try seed(rig)
        await connect(rig)
        var ask = HuaweiTLV()
        ask.put(0x01, bytes: [1, 1])
        ask.put(0x0A)
        ask.put(0x0B)
        ask.put(0x0C)
        await watchAsks(rig, 0x03, ask)
        XCTAssertEqual(keys(rig), ["32/03"])
        let answer = rig.watch.watch.sent[0].tlv
        // The same bytes the codec builds for this model at this instant.
        let model = CycleModel(periods: try rig.store.periods(), today: day("2026-10-14"))
        let expected = MenstrualCodec.cycleList(
            entries: model.entries(history: 1, future: 1), request: MenstrualCodec.CycleRequest(historyCycles: 1, futureCycles: 1, tag0a: true, tag0b: true, tag0c: true),
            nowSec: Int64(nowDate.timeIntervalSince1970), modifiedSec: 1_790_000_000, averageCycleDays: 28, averagePeriodDays: 5, zone: utc
        )
        XCTAssertEqual(answer.serialize(), expected.serialize())
        XCTAssertEqual(try answer.object(0x82).objects(0x83).count, 3)
        // An error packet or an empty request is not answered.
        var error = HuaweiTLV()
        error.put(0x7F, int: 150_001)
        await watchAsks(rig, 0x03, error)
        await watchAsks(rig, 0x03, HuaweiTLV())
        XCTAssertEqual(keys(rig), ["32/03"])
    }

    func testTheWatchPagesTheDailyFrames() async throws {
        let rig = makeRig()
        try seed(rig)
        await connect(rig)
        var ask = HuaweiTLV()
        ask.put(0x01, byte: 30)
        ask.put(0x02, byte: 30)
        ask.put(0x03, byte: 3)
        await watchAsks(rig, 0x06, ask)
        XCTAssertEqual(try rig.watch.watch.sent[0].tlv.bytes(0x04), [4])
        var frame = HuaweiTLV()
        frame.put(0x01, byte: 3)
        await watchAsks(rig, 0x07, frame)
        let answer = rig.watch.watch.sent[1].tlv
        XCTAssertEqual(try answer.bytes(0x02), [1])
        XCTAssertEqual(try answer.object(0x83).objects(0x84)[0].short(0x06), 402)
        // A frame past the end is not answered.
        var past = HuaweiTLV()
        past.put(0x01, byte: 9)
        await watchAsks(rig, 0x07, past)
        XCTAssertEqual(keys(rig), ["32/06", "32/07"])
        XCTAssertTrue(rig.watch.events.contains("Menstrual 0x32/07: no frame 9"))
    }

    func testAFrameRequestWithoutACountAnswersNoData() async throws {
        let rig = makeRig()
        await connect(rig)
        var ask = HuaweiTLV()
        ask.put(0x03, byte: 3)
        await watchAsks(rig, 0x06, ask)
        XCTAssertEqual(rig.watch.watch.sent[0].tlv.serialize(), MenstrualCodec.noData().serialize())
    }

    func testWhileOffEveryWatchRequestIsAnsweredWithNoData() async throws {
        let rig = makeRig(enabled: false)
        try seed(rig)
        await connect(rig)
        for command: UInt8 in [0x02, 0x03, 0x06, 0x07] { await watchAsks(rig, command, HuaweiTLV()) }
        XCTAssertEqual(keys(rig), ["32/02", "32/03", "32/06", "32/07"])
        for sent in rig.watch.watch.sent { XCTAssertEqual(sent.tlv.serialize(), MenstrualCodec.noData().serialize()) }
    }

    // MARK: dictionary 400018

    private func dictionaryQuery(startMs: Int64, endMs: Int64, modifyMs: Int64) -> Bytes {
        var tlv = HuaweiTLV()
        tlv.put(0x01, string: "hw.watch.health.physiological")
        tlv.put(0x02, string: "hw.unitedevice.physiological")
        tlv.put(0x03, int: 400_018)
        tlv.put(0x06, long: startMs)
        tlv.put(0x07, long: endMs)
        tlv.put(0x08, long: modifyMs)
        return DataSyncRig.frame(0x04, tlv)
    }

    func testTheWatchAsksForFlowAndCrampsOfAWindow() async throws {
        let rig = makeRig()
        try rig.store.logDay(day("2026-10-10"), flow: 2, cramps: 3, nowSec: 1_791_000_000)
        try rig.store.logDay(day("2026-10-12"), flow: 1, cramps: 0, nowSec: 1_791_000_500)
        await rig.watch.attach()
        let before = rig.watch.watch.sent.count
        let from = Int64(day("2026-10-11").startOfDaySeconds(in: utc)) * 1000
        rig.watch.session.onData(dictionaryQuery(startMs: from, endMs: 0, modifyMs: 0))
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(keys(rig, after: before), ["37/04"])
        let answer = try DataSyncWire.parseDictionary(rig.watch.watch.sent[before].tlv)
        XCTAssertEqual(answer.rows.count, 2, "only 2026-10-12: flow and cramps")
        XCTAssertEqual(answer.rows[0].values[0].value, [0, 0, 0, 1])
        XCTAssertEqual(answer.rows[0].startMs, Int64(day("2026-10-12").startOfDaySeconds(in: utc)) * 1000)
        XCTAssertEqual(answer.srcPkg, "hw.unitedevice.physiological")
        XCTAssertEqual(answer.wearPkg, "hw.watch.health.physiological")
        // Nothing changed after the watch's modify time: no answer.
        rig.watch.session.onData(dictionaryQuery(startMs: from, endMs: 0, modifyMs: 1_791_000_500_000))
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(rig.watch.watch.sent.count, before + 1)
    }

    func testADictionaryQueryWhileOffIsIgnored() async throws {
        let rig = makeRig(enabled: false)
        try rig.store.logDay(day("2026-10-12"), flow: 1, cramps: 0, nowSec: 1_791_000_500)
        await rig.watch.attach()
        rig.watch.session.onData(dictionaryQuery(startMs: 0, endMs: 0, modifyMs: 0))
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertTrue(rig.watch.watch.sent.isEmpty)
        XCTAssertTrue(rig.watch.events.contains("query ignored, off in settings"))
    }
}

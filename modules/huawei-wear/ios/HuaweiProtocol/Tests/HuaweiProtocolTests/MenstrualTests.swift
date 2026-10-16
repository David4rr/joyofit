import XCTest
@testable import HuaweiProtocol

/// MenstrualTest.kt translated (same vectors, same assertions), plus CivilDate, the zone handling and the Java golden of the 0x32 packets.
final class MenstrualTests: XCTestCase {
    private let utc = TimeZone(secondsFromGMT: 0)!

    private func day(_ text: String) -> CivilDate { CivilDate(text)! }
    private func secs(_ text: String) -> Int64 { CycleModel.daySeconds(day(text), utc) }
    private func period(_ start: String, _ end: String?) -> LoggedPeriod { LoggedPeriod(start: day(start), end: end.map { day($0) }) }

    /// Four finished 28-day cycles, the last period started 2026-09-23.
    private var periods: [LoggedPeriod] {
        [period("2026-07-01", "2026-07-05"), period("2026-07-29", "2026-08-02"), period("2026-08-26", "2026-08-30"), period("2026-09-23", "2026-09-27")]
    }

    private let today = CivilDate("2026-10-14")!

    // MARK: CivilDate

    func testCivilDateParsesAndPrintsIsoDays() {
        XCTAssertEqual(CivilDate("1970-01-01")?.epochDay, 0)
        XCTAssertEqual(CivilDate("2026-10-14")?.epochDay, 20_740)
        XCTAssertEqual(CivilDate(epochDay: 20_740).description, "2026-10-14")
        XCTAssertEqual(CivilDate("2024-02-29")?.description, "2024-02-29")
        XCTAssertEqual(CivilDate("0001-01-01")?.description, "0001-01-01")
        XCTAssertEqual(day("2026-12-31").plusDays(1).description, "2027-01-01")
        XCTAssertEqual(day("2026-03-01").minusDays(1).description, "2026-02-28")
        for bad in ["", "2026-13-01", "2026-02-29", "2026-04-31", "2026-1-01", "26-10-14", "2026/10/14", "2026-10-1x", "2026-10-140", "+2026-10-14"] {
            XCTAssertNil(CivilDate(bad), bad)
        }
    }

    func testEveryDayRoundTripsThroughItsText() {
        var d = CivilDate("1999-12-25")!
        for _ in 0..<2000 {
            XCTAssertEqual(CivilDate(d.description), d)
            d = d.plusDays(1)
        }
    }

    func testStartOfDayFollowsTheZone() {
        XCTAssertEqual(secs("1970-01-02"), 86_400)
        let jakarta = TimeZone(identifier: "Asia/Jakarta")!
        XCTAssertEqual(CivilDate("2026-10-14")!.startOfDaySeconds(in: jakarta), secs("2026-10-14") - 7 * 3600)
        // Local day of an instant: 2026-10-14 20:00 UTC is already the 15th in Jakarta.
        let instant = Date(timeIntervalSince1970: Double(secs("2026-10-14") + 20 * 3600))
        XCTAssertEqual(CivilDate.day(of: instant, in: utc).description, "2026-10-14")
        XCTAssertEqual(CivilDate.day(of: instant, in: jakarta).description, "2026-10-15")
    }

    func testAMidnightThatDoesNotExistStartsTheDayAtTheFirstValidInstant() {
        // Sao Paulo skipped 2018-11-04 00:00 -> 01:00 (DST); Java's atStartOfDay gives 01:00 local (= 03:00 UTC).
        let sp = TimeZone(identifier: "America/Sao_Paulo")!
        XCTAssertEqual(CivilDate("2018-11-04")!.startOfDaySeconds(in: sp), secs("2018-11-04") + 3 * 3600)
    }

    // MARK: model

    func testAveragesAndPredictions() {
        let model = CycleModel(periods: periods, today: today)
        XCTAssertEqual(model.averageCycleDays, 28)
        XCTAssertEqual(model.averagePeriodDays, 5)
        XCTAssertEqual(model.predictedStarts(2), [day("2026-10-21"), day("2026-11-18")])
        XCTAssertEqual(model.daysLate(), 0)
        XCTAssertFalse(model.periodOngoing)
    }

    func testDefaultsWithoutHistoryAndNoPredictionsWithoutAPeriod() {
        let none = CycleModel(periods: [], today: today)
        XCTAssertEqual(none.averageCycleDays, 28)
        XCTAssertEqual(none.averagePeriodDays, 5)
        XCTAssertTrue(none.predictedStarts(3).isEmpty)
        XCTAssertTrue(none.entries(history: 2, future: 2).isEmpty)
        XCTAssertEqual(none.daysLate(), 0)
        let one = CycleModel(periods: [period("2026-10-10", nil)], today: today)
        XCTAssertTrue(one.periodOngoing)
        XCTAssertEqual(one.predictedStarts(1), [day("2026-11-07")])
    }

    func testIrregularIntervalsAreAveragedAndOutliersIgnored() {
        let model = CycleModel(
            periods: [period("2026-01-01", "2026-01-04"), period("2026-01-31", "2026-02-03"), period("2026-03-04", nil), period("2026-09-01", nil)],
            today: day("2026-09-10")
        )
        // 30 and 32 days count, the 181-day gap does not: mean 31.
        XCTAssertEqual(model.averageCycleDays, 31)
        XCTAssertEqual(model.averagePeriodDays, 4)
    }

    func testMeansRoundHalfUpAndTheLastSixCount() {
        // Intervals 28 and 29: mean 28.5 rounds to 29 like Math.round.
        let model = CycleModel(periods: [period("2026-01-01", nil), period("2026-01-29", nil), period("2026-02-27", nil)], today: day("2026-03-01"))
        XCTAssertEqual(model.averageCycleDays, 29)
        // Ten 20-day intervals then six 30-day ones: only the last six count.
        var list = [LoggedPeriod]()
        var d = day("2025-01-01")
        for i in 0..<17 {
            list.append(LoggedPeriod(start: d, end: nil))
            d = d.plusDays(i < 10 ? 20 : 30)
        }
        XCTAssertEqual(CycleModel(periods: list, today: d).averageCycleDays, 30)
        // Period lengths 3 and 4: 3.5 rounds to 4; lengths over 14 days are ignored.
        let lengths = CycleModel(periods: [period("2026-01-01", "2026-01-03"), period("2026-02-01", "2026-02-04"), period("2026-03-01", "2026-03-20")], today: day("2026-03-25"))
        XCTAssertEqual(lengths.averagePeriodDays, 4)
    }

    func testPeriodsComeSortedWhateverTheOrderGiven() {
        let model = CycleModel(periods: periods.reversed(), today: today)
        XCTAssertEqual(model.periods.map(\.start), periods.map(\.start))
        XCTAssertEqual(model.predictedStarts(1), [day("2026-10-21")])
    }

    func testALatePeriodIsExpectedTodayAndALongMissedOneRollsForward() {
        let late = CycleModel(periods: periods, today: day("2026-10-24"))
        XCTAssertEqual(late.daysLate(), 3)
        XCTAssertEqual(late.predictedStarts(1), [day("2026-10-24")])
        let missed = CycleModel(periods: periods, today: day("2026-12-31"))
        XCTAssertEqual(missed.predictedStarts(1), [day("2027-01-13")])
    }

    func testAnOngoingPeriodIsNeverLate() {
        let model = CycleModel(periods: [period("2026-09-01", nil)], today: day("2026-10-30"))
        XCTAssertEqual(model.daysLate(), 0)
    }

    func testEntriesAreOldestFirstWithTheCurrentCycleThenPredictedOnes() {
        let entries = CycleModel(periods: periods, today: today).entries(history: 2, future: 2)
        XCTAssertEqual(entries.map { $0.start.description }, ["2026-07-29", "2026-08-26", "2026-09-23", "2026-10-21", "2026-11-18"])
        XCTAssertEqual(entries.map(\.logged), [true, true, true, false, false])
        XCTAssertEqual(entries.map(\.lengthDays), [28, 28, 28, 28, 28])
        let current = entries[2]
        // The fertile window of the current cycle sits before the next period: ovulation 14 days before 2026-10-21.
        XCTAssertEqual(current.ovulation, day("2026-10-07"))
        XCTAssertEqual(current.fertileStart, day("2026-10-02"))
        XCTAssertEqual(current.fertileEnd, day("2026-10-08"))
        XCTAssertNil(entries[0].ovulation)
        XCTAssertEqual(entries[3].end, day("2026-10-25"))
    }

    func testEntriesClampTheHistoryAndTheSentLength() {
        let model = CycleModel(periods: periods, today: today)
        XCTAssertEqual(model.entries(history: 99, future: 0).count, 4)
        XCTAssertEqual(model.entries(history: -3, future: -1).count, 1)
        // A 200 day gap between two periods is capped at 180 in the list although it is ignored by the average.
        let gap = CycleModel(periods: [period("2026-01-01", nil), period("2026-07-20", nil)], today: day("2026-07-21"))
        XCTAssertEqual(gap.entries(history: 1, future: 0).map(\.lengthDays), [180, 28])
    }

    func testKeyDaysCarryStatusCodesInsideTheWindow() {
        let days = CycleModel(periods: periods, today: today).keyDays(historyDays: 30, futureDays: 30)
        let expected: [(String, Int)] = [
            ("2026-09-23", 101), ("2026-09-27", 102), ("2026-10-02", 401), ("2026-10-07", 403), ("2026-10-08", 402),
            ("2026-10-21", 301), ("2026-10-25", 302),
            // The fertile window of the cycle after next starts before the window's end.
            ("2026-10-30", 401), ("2026-11-04", 403), ("2026-11-05", 402),
        ]
        XCTAssertEqual(days.map { "\($0.day) \($0.status)" }, expected.map { "\(day($0.0)) \($0.1)" })
    }

    // MARK: log rules

    func testPeriodsAreValidatedBeforeTheyAreStored() {
        let ended = periods
        XCTAssertNil(CycleLogRules.checkStart(ended, day("2026-10-14"), today))
        XCTAssertNotNil(CycleLogRules.checkStart(ended, day("2026-10-15"), today))
        XCTAssertNotNil(CycleLogRules.checkStart(ended, day("2026-09-25"), today))
        XCTAssertNotNil(CycleLogRules.checkStart(ended, day("2026-08-01"), today))
        let open = ended + [period("2026-10-10", nil)]
        XCTAssertNotNil(CycleLogRules.checkStart(open, day("2026-10-14"), today))
        XCTAssertNil(CycleLogRules.checkEnd(open, day("2026-10-13"), today))
        XCTAssertNotNil(CycleLogRules.checkEnd(open, day("2026-10-09"), today))
        XCTAssertNotNil(CycleLogRules.checkEnd(ended, day("2026-10-13"), today))
        XCTAssertNil(CycleLogRules.checkRange(ended, day("2026-06-01"), day("2026-06-05"), today))
        XCTAssertNotNil(CycleLogRules.checkRange(ended, day("2026-07-04"), day("2026-07-09"), today))
        XCTAssertNotNil(CycleLogRules.checkRange(ended, day("2026-10-01"), day("2026-10-20"), today))
        XCTAssertNil(CycleLogRules.checkLevels(day("2026-10-14"), today, flow: 3, cramps: 0))
        XCTAssertNotNil(CycleLogRules.checkLevels(day("2026-10-14"), today, flow: 4, cramps: 0))
        XCTAssertNotNil(CycleLogRules.checkLevels(day("2026-10-15"), today, flow: 1, cramps: 1))
    }

    func testTheRefusalReasonsAreTheAndroidSentences() {
        let open = periods + [period("2026-10-10", nil)]
        XCTAssertEqual(CycleLogRules.checkStart(periods, day("2026-10-15"), today), "A period cannot start in the future")
        XCTAssertEqual(CycleLogRules.checkStart(open, day("2026-10-14"), today), "A period started on 2026-10-10 is still open; end it first")
        XCTAssertEqual(CycleLogRules.checkStart(periods, day("2026-09-25"), today), "That day is already inside the period from 2026-09-23")
        XCTAssertEqual(CycleLogRules.checkStart(periods, day("2026-06-10"), today), "A later period (2026-07-01) is already logged; add an earlier one with both dates")
        XCTAssertEqual(CycleLogRules.checkEnd(periods, day("2026-10-13"), today), "There is no open period to end")
        XCTAssertEqual(CycleLogRules.checkEnd(open, day("2026-10-09"), today), "A period cannot end before it started (2026-10-10)")
        XCTAssertEqual(CycleLogRules.checkRange(periods, day("2026-07-04"), day("2026-07-09"), today), "That overlaps the period from 2026-07-01")
        XCTAssertEqual(CycleLogRules.checkRange(periods, day("2026-06-05"), day("2026-06-01"), today), "A period cannot end before it started")
        XCTAssertEqual(CycleLogRules.checkLevels(day("2026-10-14"), today, flow: 4, cramps: 0), "Flow must be 0 to 3")
        XCTAssertEqual(CycleLogRules.checkLevels(day("2026-10-14"), today, flow: 0, cramps: -1), "Cramps must be 0 to 3")
        XCTAssertThrowsError(try CycleLogRules.parseDay("14.10.2026")) { error in
            XCTAssertEqual((error as? WearError)?.message, "'14.10.2026' is not a date (expected YYYY-MM-DD)")
            XCTAssertEqual((error as? WearError)?.code, .invalidArgument)
        }
    }

    // MARK: service 0x32

    func testSwitchesAreABitfieldInTagOne() throws {
        let all = MenstrualCodec.Switches(master: true, periodStart: true, periodEnd: true, fertileStart: true, fertileEnd: true, easyPregnancy: true)
        XCTAssertEqual(all.bitfield(includeEasyPregnancy: true), 0b111111)
        XCTAssertEqual(all.bitfield(includeEasyPregnancy: false), 0b011111)
        XCTAssertEqual(MenstrualCodec.Switches(master: true, periodStart: true, periodEnd: false, fertileStart: false, fertileEnd: false).bitfield(includeEasyPregnancy: true), 0b000011)
        XCTAssertEqual(MenstrualCodec.Switches(bitfield: 63), all)
        XCTAssertEqual(MenstrualCodec.Switches().bitfield(includeEasyPregnancy: true), 0b001110)
        let out = try Menstrual.message(commandId: 0x01, body: MenstrualCodec.switches(0b00001011)).serialize(params: plainParams())[0]
        XCTAssertEqual(Bytes(out[6..<9]).hexUpper, "01010B")
        XCTAssertEqual(out[4], 0x32)
        XCTAssertEqual(out[5], 0x01)
    }

    func testTheSwitchesComeFromTheJsObjectWithAndroidDefaults() throws {
        XCTAssertEqual(try MenstrualCodec.Switches(js: [:]), MenstrualCodec.Switches())
        let all = try MenstrualCodec.Switches(js: ["master": true, "periodStart": false, "periodEnd": false, "fertileStart": false, "fertileEnd": true, "easyPregnancy": true])
        XCTAssertEqual(all, MenstrualCodec.Switches(master: true, periodStart: false, periodEnd: false, fertileStart: false, fertileEnd: true, easyPregnancy: true))
        XCTAssertThrowsError(try MenstrualCodec.Switches(js: ["master": "yes"]))
    }

    func testCapabilityIsThreeWithDictionaryElseTwo() {
        XCTAssertEqual(MenstrualCodec.capability(dictionarySupported: true).serialize().hexUpper, "010103")
        XCTAssertEqual(MenstrualCodec.capability(dictionarySupported: false).serialize().hexUpper, "010102")
        XCTAssertEqual(Menstrual.CapabilityRequest.request().tlv!.serialize().hexUpper, "010102")
    }

    func testModifyTimeIsFourBytesOrTheErrorTag() {
        XCTAssertEqual(MenstrualCodec.modifyTime(0x69C6_C0C0).serialize().hexUpper, "010469C6C0C0")
        // 7F, length 4, 150001 = 0x000249F1
        XCTAssertEqual(MenstrualCodec.modifyTime(nil).serialize().hexUpper, "7F04000249F1")
        XCTAssertEqual(MenstrualCodec.modifyTime(nil).serialize(), MenstrualCodec.noData().serialize())
    }

    func testTheWatchsCycleRequestIsRead() {
        var tlv = HuaweiTLV()
        tlv.put(0x01, bytes: [0x02, 0x03])
        tlv.put(0x0B)
        tlv.put(0x0C)
        let request = MenstrualCodec.parseCycleRequest(tlv)
        XCTAssertEqual(request, MenstrualCodec.CycleRequest(historyCycles: 2, futureCycles: 3, tag0a: false, tag0b: true, tag0c: true))
        var error = HuaweiTLV()
        error.put(0x7F, int: 150_001)
        XCTAssertNil(MenstrualCodec.parseCycleRequest(error))
        XCTAssertNil(MenstrualCodec.parseCycleRequest(HuaweiTLV()))
        var short = HuaweiTLV()
        short.put(0x01, bytes: [0x02])
        XCTAssertNil(MenstrualCodec.parseCycleRequest(short))
        var big = HuaweiTLV()
        big.put(0x01, bytes: [0xFF, 0x80])
        XCTAssertEqual(MenstrualCodec.parseCycleRequest(big)?.historyCycles, 255)
        XCTAssertEqual(MenstrualCodec.parseCycleRequest(big)?.futureCycles, 128)
    }

    func testCycleListLayoutMatchesNeh() throws {
        let entries = CycleModel(periods: periods, today: today).entries(history: 1, future: 1)
        let request = MenstrualCodec.CycleRequest(historyCycles: 1, futureCycles: 1, tag0a: true, tag0b: true, tag0c: true)
        let tlv = MenstrualCodec.cycleList(
            entries: entries, request: request, nowSec: secs("2026-10-14"), modifiedSec: 1_791_936_000, averageCycleDays: 28, averagePeriodDays: 5, zone: utc
        )
        // Finished: 2026-08-26 (28 d ends 09-23 < now); 2026-09-23 ends 10-21, not finished -> 1; future: 2026-10-21 -> 1.
        XCTAssertEqual(try tlv.bytes(0x01), [1, 1])
        let items = try tlv.object(0x82).objects(0x83)
        XCTAssertEqual(items.count, 3)
        let current = items[1]
        XCTAssertEqual(try current.int(0x04), Int32(secs("2026-09-23")))
        XCTAssertEqual(try current.int(0x05), Int32(secs("2026-09-27")))
        XCTAssertEqual(try current.int(0x06), Int32(secs("2026-10-02")))
        XCTAssertEqual(try current.int(0x07), Int32(secs("2026-10-08")))
        XCTAssertEqual(try current.byte(0x08), 28)
        XCTAssertEqual(try current.byte(0x12), 1)
        XCTAssertEqual(try items[2].byte(0x12), 0)
        XCTAssertEqual(try items[0].int(0x06), 0)
        XCTAssertEqual(try tlv.int(0x09), 1_791_936_000)
        // The watch asked 0b, so 0a carries the cycle length; it asked 0a, so 0b carries the period length (Huawei Health crosses them).
        XCTAssertEqual(try tlv.bytes(0x0A), [28])
        XCTAssertEqual(try tlv.bytes(0x0B), [5])
    }

    func testCycleListWithoutFlagsLeavesOutTheOptionalTags() throws {
        let entries = CycleModel(periods: periods, today: today).entries(history: 0, future: 0)
        let request = MenstrualCodec.CycleRequest(historyCycles: 0, futureCycles: 0, tag0a: false, tag0b: false, tag0c: false)
        let tlv = MenstrualCodec.cycleList(entries: entries, request: request, nowSec: secs("2026-10-14"), modifiedSec: 5, averageCycleDays: 28, averagePeriodDays: 5, zone: utc)
        XCTAssertFalse(tlv.contains(0x0A))
        XCTAssertFalse(tlv.contains(0x0B))
        XCTAssertFalse(try tlv.object(0x82).objects(0x83)[0].contains(0x12))
        XCTAssertTrue(MenstrualCodec.cycleList(entries: [], request: request, nowSec: 0, modifiedSec: 0, averageCycleDays: 28, averagePeriodDays: 5, zone: utc).contains(0x7F))
    }

    func testDailyStatusFramesPageTheKeyDays() throws {
        let days = CycleModel(periods: periods, today: today).keyDays(historyDays: 30, futureDays: 30)
        XCTAssertEqual(days.count, 10)
        XCTAssertEqual(MenstrualCodec.frameCount(days.count, frameSize: 3), 4)
        XCTAssertEqual(MenstrualCodec.frameCount(0, frameSize: 3), 0)
        XCTAssertEqual(MenstrualCodec.frameCount(5, frameSize: 0), 0)
        XCTAssertEqual(MenstrualCodec.frameCountAnswer(3).serialize().hexUpper, "040103")
        XCTAssertTrue(MenstrualCodec.frameCountAnswer(0).contains(0x7F))
        XCTAssertEqual(MenstrualCodec.frameCountAnswer(999).serialize().hexUpper, "0401FF")

        let frame = try XCTUnwrap(MenstrualCodec.bodyStatusFrame(index: 3, days: days, frameSize: 3, zone: utc))
        XCTAssertEqual(try frame.bytes(0x01), [3])
        XCTAssertEqual(try frame.bytes(0x02), [1])
        let items = try frame.object(0x83).objects(0x84)
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(try items[0].int(0x05), Int32(secs("2026-11-05")))
        XCTAssertEqual(try items[0].short(0x06), 402)
        XCTAssertEqual(try items[0].short(0x08), 0)
        XCTAssertEqual(try items[0].short(0x09), 0)
        XCTAssertNil(MenstrualCodec.bodyStatusFrame(index: 4, days: days, frameSize: 3, zone: utc))
        XCTAssertNil(MenstrualCodec.bodyStatusFrame(index: 0, days: days, frameSize: 0, zone: utc))
        XCTAssertNil(MenstrualCodec.bodyStatusFrame(index: -1, days: days, frameSize: 3, zone: utc))

        var index = HuaweiTLV()
        index.put(0x01, byte: 2)
        XCTAssertEqual(MenstrualCodec.parseBodyStatusRequest(index), 2)
        XCTAssertNil(MenstrualCodec.parseBodyStatusRequest(HuaweiTLV()))
        var ask = HuaweiTLV()
        ask.put(0x01, byte: 30)
        ask.put(0x02, byte: 60)
        ask.put(0x03, byte: 10)
        XCTAssertEqual(MenstrualCodec.parseFrameRequest(ask), MenstrualCodec.FrameRequest(historyDays: 30, futureDays: 60, frameSize: 10))
        var error = HuaweiTLV()
        error.put(0x7F, int: 150_001)
        XCTAssertNil(MenstrualCodec.parseFrameRequest(error))
        // An empty request asks for nothing: all zero, no frames.
        XCTAssertEqual(MenstrualCodec.parseFrameRequest(HuaweiTLV()), MenstrualCodec.FrameRequest(historyDays: 0, futureDays: 0, frameSize: 0))
    }

    // MARK: dictionary 400018

    func testDictionaryFieldIdsAreTheOnesFromDictConfig() {
        XCTAssertEqual(MenstrualCodec.dictId, 400_018)
        XCTAssertEqual(String(format: "%08X", MenstrualCodec.fieldFlow), "17D7CAE5")
        XCTAssertEqual(String(format: "%08X", MenstrualCodec.fieldCramps), "17D7CD53")
        XCTAssertEqual(MenstrualCodec.dictValue(3).hexUpper, "00000003")
        XCTAssertEqual(MenstrualCodec.dictValue(-1).hexUpper, "FFFFFFFF")
    }

    func testDictionaryRowsAreSplitPerFieldFilteredByTimeAndCappedAtTen() {
        let days = (1...8).map { LoggedDay(day: day("2026-10-0\($0)"), flow: $0 % 4, cramps: 1, modifiedSec: 1000 + Int64($0)) }
        let rows = MenstrualCodec.dictionaryRows(days: days, startMs: 0, endMs: 0, modifyMs: 0, zone: utc)
        XCTAssertEqual(rows.count, 10)
        let first = rows[0]
        XCTAssertEqual(first.startMs, secs("2026-10-01") * 1000)
        XCTAssertEqual(first.endMs, secs("2026-10-01") * 1000 + 86_399_999)
        XCTAssertEqual(first.modifyMs, 1_001_000)
        XCTAssertEqual(first.values.count, 1)
        XCTAssertEqual(first.values[0].key, 400_018_149)
        XCTAssertEqual(first.values[0].value?.hexUpper, "00000001")
        XCTAssertEqual(rows[1].values[0].key, 400_018_771)
        // Only days changed after the watch's modify time (1004 s) and inside its window.
        let newer = MenstrualCodec.dictionaryRows(days: days, startMs: 0, endMs: 0, modifyMs: 1_004_000, zone: utc)
        XCTAssertEqual(newer.map(\.startMs), ["2026-10-05", "2026-10-05", "2026-10-06", "2026-10-06", "2026-10-07", "2026-10-07", "2026-10-08", "2026-10-08"].map { secs($0) * 1000 })
        let window = MenstrualCodec.dictionaryRows(days: days, startMs: secs("2026-10-02") * 1000, endMs: secs("2026-10-02") * 1000 + 1000, modifyMs: 0, zone: utc)
        XCTAssertEqual(window.count, 2)
    }

    func testDictionaryRowsComeOldestFirstWhateverTheOrderGiven() {
        let days = [LoggedDay(day: day("2026-10-03"), flow: 1, cramps: 0, modifiedSec: 10), LoggedDay(day: day("2026-10-01"), flow: 2, cramps: 0, modifiedSec: 10)]
        let rows = MenstrualCodec.dictionaryRows(days: days, startMs: 0, endMs: 0, modifyMs: 0, zone: utc)
        XCTAssertEqual(rows.map(\.startMs), [secs("2026-10-01") * 1000, secs("2026-10-01") * 1000, secs("2026-10-03") * 1000, secs("2026-10-03") * 1000])
        // A day of 0 / 0 still goes out, so the watch learns of a reset.
        let reset = MenstrualCodec.dictionaryRows(days: [LoggedDay(day: day("2026-10-01"), flow: 0, cramps: 0, modifiedSec: 10)], startMs: 0, endMs: 0, modifyMs: 0, zone: utc)
        XCTAssertEqual(reset.count, 2)
        XCTAssertEqual(reset[0].values[0].value?.hexUpper, "00000000")
    }

    func testDictionaryAnswerGoesOutAsDataSyncDictionary() throws {
        let rows = MenstrualCodec.dictionaryRows(days: [LoggedDay(day: day("2026-10-01"), flow: 2, cramps: 0, modifiedSec: 1000)], startMs: 0, endMs: 0, modifyMs: 0, zone: utc)
        let packet = DataSyncWire.dictionary(srcPkg: "hw.unitedevice.physiological", wearPkg: "hw.watch.health.physiological", dictType: 400_018, rows: rows)
        let tlv = try XCTUnwrap(packet.tlv)
        XCTAssertEqual(try tlv.string(0x01), "hw.unitedevice.physiological")
        XCTAssertEqual(try tlv.string(0x02), "hw.watch.health.physiological")
        XCTAssertEqual(try tlv.int(0x03), 400_018)
        XCTAssertEqual(try tlv.object(0x84).objects(0x85).count, 2)
    }

    // MARK: Java golden

    private func plainParams() -> ParamsProvider {
        let params = ParamsProvider()
        params.transactionsCrypted = false
        return params
    }

    private func assertFrames(_ packet: HuaweiPacket, _ c: [String: Any]) throws {
        let name = c.str("name")
        XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name)
        XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name)
        XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name)
        XCTAssertEqual(packet.isSliced, c.bool("sliced"), name)
        XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), name)
        XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], name)
    }

    func testThePacketsMatchWhatTheJavaMessageSerializes() throws {
        let g = try Golden.load("menstrual")
        let cases = g.list("messages")
        XCTAssertEqual(cases.count, 13)
        // The golden entries and key days are the ones of the MenstrualTest model on 2026-10-14.
        let model = CycleModel(periods: periods, today: today)
        let entries = model.entries(history: 1, future: 1)
        let keyDays = model.keyDays(historyDays: 30, futureDays: 30)
        for c in cases {
            let body: HuaweiTLV
            switch c.str("kind") {
            case "switches": body = MenstrualCodec.switches(c.int("bitfield"))
            case "capability": body = MenstrualCodec.capability(dictionarySupported: c.bool("dictionary"))
            case "updateNotice": body = MenstrualCodec.updateNotice()
            case "noData": body = MenstrualCodec.noData()
            case "modifyTime": body = MenstrualCodec.modifyTime(Int64(c.int("modified")))
            case "cycleList":
                let request = MenstrualCodec.CycleRequest(historyCycles: 1, futureCycles: 1, tag0a: c.bool("tag0a"), tag0b: c.bool("tag0b"), tag0c: c.bool("tag0c"))
                body = MenstrualCodec.cycleList(
                    entries: entries, request: request, nowSec: secs("2026-10-14"), modifiedSec: Int64(c.int("modified")), averageCycleDays: 28, averagePeriodDays: 5, zone: utc
                )
            case "frameCount": body = MenstrualCodec.frameCountAnswer(c.int("count"))
            case "bodyStatus":
                body = try XCTUnwrap(MenstrualCodec.bodyStatusFrame(index: c.int("index"), days: keyDays, frameSize: c.int("size"), zone: utc), c.str("name"))
            default: return XCTFail("unknown kind \(c.str("kind"))")
            }
            try assertFrames(Menstrual.message(commandId: UInt8(c.int("command")), body: body), c)
        }
    }

    func testTheCapabilityRequestMatchesJava() throws {
        try assertFrames(Menstrual.CapabilityRequest.request(), try Golden.load("menstrual")["capabilityRequest"] as! [String: Any])
    }
}

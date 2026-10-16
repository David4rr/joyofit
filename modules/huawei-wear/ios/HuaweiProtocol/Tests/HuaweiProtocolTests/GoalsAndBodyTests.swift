import XCTest
@testable import HuaweiProtocol

/// Translation of the Kotlin BodyAndGoalsTest (same vectors, same assertions), plus the Java golden of the goal TLVs, the GB config frames and
/// the double / int encodings of the body dictionaries (`Fixtures/goals.json`, from GoldenGoals.java).
final class GoalsAndBodyTests: XCTestCase {
    let g = try! Golden.load("goals")

    func hex(_ s: String) -> Bytes { Bytes(hex: s)! }

    func plain() -> ParamsProvider {
        let p = ParamsProvider()
        p.transactionsCrypted = false
        p.sliceSize = 1022
        return p
    }

    func glanceJson(_ fields: [GlanceField]) -> String { BodyMetricsCodec.glanceJSON(fields) }

    // MARK: body metrics

    func testWeightRowCarriesLittleEndianDoublesUnderTheDictionaryKeys() {
        let row = BodyMetricsCodec.weightRow(weightKg: 70.5, tsMs: 1_760_400_000_000, bodyFatPct: 22.5, basalKcal: nil, modifyMs: 1_760_400_001_000)
        XCTAssertEqual(row.startMs, 1_760_400_000_000)
        XCTAssertEqual(row.endMs, 1_760_400_000_000)
        XCTAssertEqual(row.modifyMs, 1_760_400_001_000)
        XCTAssertEqual(row.values.map(\.key), [2004, 2001])
        XCTAssertEqual(row.values[0].value, hex("0000000000a05140"))
        XCTAssertEqual(row.values[1].value, BodyMetricsCodec.doubleLe(22.5))
        // Unknown fields are left out: no body fat, no BMR.
        XCTAssertEqual(BodyMetricsCodec.weightRow(weightKg: 70.5, tsMs: 1, bodyFatPct: nil, basalKcal: nil, modifyMs: 2).values.map(\.key), [2004])
        XCTAssertEqual(BodyMetricsCodec.weightRow(weightKg: 70.5, tsMs: 1, bodyFatPct: 20.0, basalKcal: 1650.0, modifyMs: 2).values.map(\.key), [2004, 2001, 2024])
    }

    func testWeightDictionaryPacketUses10006() throws {
        let row = BodyMetricsCodec.weightRow(weightKg: 70.5, tsMs: 1, bodyFatPct: nil, basalKcal: nil, modifyMs: 2)
        let packet = DataSyncWire.dictionary(srcPkg: BodyMetricsCodec.phonePkg, wearPkg: BodyMetricsCodec.watchPkg, dictType: BodyMetricsCodec.dictWeight, rows: [row])
        let out = try packet.serialize(params: plain())
        XCTAssertEqual(out.count, 1)
        let query = try DataSyncWire.parseDictionary(packet.tlv!)
        XCTAssertEqual(query.dictId, 10006)
        XCTAssertEqual(query.startMs, 1)
        XCTAssertEqual(query.modifyMs, 2)
        XCTAssertEqual(query.rows.first?.values.first?.value, BodyMetricsCodec.doubleLe(70.5))
        XCTAssertGreaterThan(out[0].count, 40)
    }

    func testRestingMetabolismIsAFourByteBigEndianIntUnder500018055() {
        let row = BodyMetricsCodec.restingRow(kcal: 1650, startMs: 10, endMs: 20, modifyMs: 30)
        XCTAssertEqual(row.values.first?.key, 500_018_055)
        XCTAssertEqual(row.values.first?.value, hex("00000672"))
        XCTAssertEqual(row.values.count, 1)
        XCTAssertEqual(BodyMetricsCodec.dictResting, 500_018)
    }

    func testHealthGlanceOmitsWhatIsUnknown() {
        let full = BodyMetricsData(weightKg: 70.5, weightTsMs: 1_760_400_000_000, bodyFatPct: 22.5, bodyFatTsMs: 1_760_400_000_000)
        // BMI 70.5 / 1.75^2 = 23.02 -> 23.0; order: bodyMassIndex, fatPercentageTimestamp, fatPercentage, height, weight, weightTimestamp.
        XCTAssertEqual(
            glanceJson(BodyMetricsCodec.glance(full, weightKg: 70.5, heightCm: 175)),
            "{\"bodyMassIndex\":23.0,\"fatPercentageTimestamp\":1760400000000,\"fatPercentage\":22.5,\"height\":175,\"weight\":70.5,\"weightTimestamp\":1760400000000}"
        )
        XCTAssertEqual(glanceJson(BodyMetricsCodec.glance(BodyMetricsData(), weightKg: 70.5, heightCm: 175)), "{\"bodyMassIndex\":23.0,\"height\":175,\"weight\":70.5}")
        XCTAssertEqual(glanceJson(BodyMetricsCodec.glance(BodyMetricsData(), weightKg: nil, heightCm: 175)), "{\"height\":175}")
        XCTAssertEqual(glanceJson(BodyMetricsCodec.glance(BodyMetricsData(), weightKg: 70.5, heightCm: nil)), "{\"weight\":70.5}")
        XCTAssertEqual(glanceJson(BodyMetricsCodec.glance(BodyMetricsData(), weightKg: nil, heightCm: nil)), "{}")
    }

    func testHealthGlanceBloodPressureNeedsBothValues() {
        let bp = BodyMetricsData(systolic: 120, diastolic: 80, bpTsMs: 5)
        XCTAssertEqual(
            glanceJson(BodyMetricsCodec.glance(bp, weightKg: nil, heightCm: nil)),
            "{\"bloodPressureSource\":0,\"bloodPressureTimestamp\":5,\"diastolicPressure\":80,\"systolicPressure\":120}"
        )
        XCTAssertEqual(glanceJson(BodyMetricsCodec.glance(BodyMetricsData(systolic: 120), weightKg: nil, heightCm: nil)), "{}")
    }

    func testGlanceRoundsTheBmiToOneDecimalAndIgnoresNonPositiveValues() {
        // 82.3 / 1.8^2 = 25.40 -> 25.4; a zero weight or height leaves weight, height and BMI out.
        XCTAssertEqual(glanceJson(BodyMetricsCodec.glance(BodyMetricsData(), weightKg: 82.3, heightCm: 180)), "{\"bodyMassIndex\":25.4,\"height\":180,\"weight\":82.3}")
        XCTAssertEqual(glanceJson(BodyMetricsCodec.glance(BodyMetricsData(), weightKg: 0, heightCm: 0)), "{}")
    }

    func testBodyMetricsJsHasEveryKeyAndNullForUnknown() {
        let js = BodyMetricsData(weightKg: 70.5, restingKcal: 1650).toJS()
        XCTAssertEqual(Set(js.keys), ["weightKg", "weightTs", "bodyFatPct", "bodyFatTs", "restingKcal", "systolic", "diastolic", "bpTs"])
        XCTAssertEqual(js["weightKg"] as? Double, 70.5)
        XCTAssertEqual(js["restingKcal"] as? Int, 1650)
        XCTAssertTrue(js["bpTs"] is NSNull)
    }

    func testGoldenDoublesAndIntsMatchJava() {
        for c in g.list("doubles") { XCTAssertEqual(BodyMetricsCodec.doubleLe(((c["value"] as? NSNumber)?.doubleValue)!).hexLower, c.str("hex")) }
        for c in g.list("ints") { XCTAssertEqual(BodyMetricsCodec.int32Be(c.int("value")).hexLower, c.str("hex")) }
        XCTAssertEqual(g.list("doubles").count, 7)
    }

    // MARK: activity rings

    func testSingleGoalIsTimeThenGoalAsInt32() {
        XCTAssertEqual(ActivityGoalsCodec.single(nowSec: 1_760_400_000, goal: 10000), hex("010468ed9280020400002710"))
    }

    func testBundleUsesMinimalBytesForTypesAndValues() {
        // 01 time, 82{83{04 01, 05 2710} 83{04 03, 05 1e} 83{04 04, 05 0c}}: types 1 steps, 3 exercise minutes, 4 stand hours.
        XCTAssertEqual(
            ActivityGoalsCodec.bundle(nowSec: 1_760_400_000, steps: 10000, exerciseMinutes: 30, standHours: 12),
            hex("010468ed92808219830704010105022710830604010305011e830604010405010c")
        )
        XCTAssertEqual(ActivityGoalsCodec.minimal(0), [0])
        XCTAssertEqual(ActivityGoalsCodec.minimal(25), [0x19])
        XCTAssertEqual(ActivityGoalsCodec.minimal(300), hex("012c"))
        XCTAssertEqual(ActivityGoalsCodec.minimal(100_000), hex("0186a0"))
    }

    func testAFullSendIsEightConfigsInHuaweisIds() {
        let items = ActivityGoalsCodec.items(ActivityGoalsData(), nowSec: 1_760_400_000, nowMs: 1_760_400_000_000)
        XCTAssertEqual(items.map(\.configId), [900200006, 900200007, 900200008, 900200009, 900200002, 900200004, 900200010, 900200011])
        XCTAssertTrue(items.allSatisfy { $0.action == 1 && $0.modifyMs == 1_760_400_000_000 })
        // Calories are kcal x 1000 (GB sendCaloriesBurntGoal).
        XCTAssertEqual(items[1].data, hex("010468ed9280020400" + "0493e0"))
        // Reminders are 1 / 0.
        XCTAssertEqual(items[5].data, hex("010468ed9280020400000001"))
        XCTAssertEqual(ActivityGoalsCodec.items(ActivityGoalsData(remindStand: false), nowSec: 1_760_400_000, nowMs: 0)[5].data, hex("010468ed9280020400000000"))
    }

    func testGoalConfigPacketMatchesGbsFindDeviceShape() throws {
        let items = ActivityGoalsCodec.items(ActivityGoalsData(), nowSec: 1_760_400_000, nowMs: 1_760_400_000_000)
        let packet = DataSyncWire.config(srcPkg: ActivityGoalsCodec.srcPkg, wearPkg: ActivityGoalsCodec.wearPkg, items: [items[0]])
        var entry = HuaweiTLV()
        entry.put(0x05, int: 900_200_006)
        entry.put(0x06, byte: 1)
        entry.put(0x07, bytes: hex("010468ed9280020400002710"))
        entry.put(0x08, long: 1_760_400_000_000)
        var list = HuaweiTLV()
        list.put(0x84, tlv: entry)
        var expected = HuaweiTLV()
        expected.put(0x01, string: "hw.sport.config")
        expected.put(0x02, string: "in.huawei.motion")
        expected.put(0x83, tlv: list)
        let body = Bytes([0x00, 0x37, 0x01]) + expected.serialize()
        var head = Bytes([0x5A, UInt8(body.count >> 8), UInt8(body.count & 0xFF)]) + body
        head.appendBE(CRC16.checksum(head))
        let out = try packet.serialize(params: plain())
        XCTAssertEqual(out, [head])
    }

    func testDefaultsAndRanges() {
        let d = ActivityGoalsData()
        XCTAssertEqual([d.steps, d.calories, d.exerciseMinutes, d.standHours], [10_000, 300, 30, 12])
        XCTAssertTrue(d.remindStand && d.remindProgress && d.remindGoalReached)
        XCTAssertNoThrow(try ActivityGoalsCodec.validate(d))
        for bad in [ActivityGoalsData(steps: 10), ActivityGoalsData(calories: 1), ActivityGoalsData(exerciseMinutes: 0), ActivityGoalsData(standHours: 25)] {
            XCTAssertThrowsError(try ActivityGoalsCodec.validate(bad)) { XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument) }
        }
        // The limits themselves are valid.
        for ok in [ActivityGoalsData(steps: 1000, calories: 50, exerciseMinutes: 1, standHours: 1), ActivityGoalsData(steps: 100_000, calories: 10_000, exerciseMinutes: 600, standHours: 24)] {
            XCTAssertNoThrow(try ActivityGoalsCodec.validate(ok))
        }
        XCTAssertThrowsError(try ActivityGoalsCodec.validate(ActivityGoalsData(steps: 100_001)))
        XCTAssertThrowsError(try ActivityGoalsCodec.validate(ActivityGoalsData(calories: 10_001)))
        XCTAssertThrowsError(try ActivityGoalsCodec.validate(ActivityGoalsData(exerciseMinutes: 601)))
    }

    // MARK: Java golden

    func testGoalTlvsMatchJava() {
        for c in g.list("singles") { XCTAssertEqual(ActivityGoalsCodec.single(nowSec: c.int("now"), goal: c.int("goal")).hexLower, c.str("hex")) }
        for c in g.list("bundles") {
            XCTAssertEqual(ActivityGoalsCodec.bundle(nowSec: c.int("now"), steps: c.int("steps"), exerciseMinutes: c.int("exercise"), standHours: c.int("stand")).hexLower, c.str("hex"))
        }
        for c in g.list("minimals") { XCTAssertEqual(ActivityGoalsCodec.minimal(c.int("value")).hexLower, c.str("hex"), "\(c.int("value"))") }
        XCTAssertEqual(g.list("singles").count, 15)
        XCTAssertEqual(g.list("bundles").count, 4)
    }

    func testConfigFramesMatchGadgetbridgesRequest() throws {
        XCTAssertEqual(g.list("frames").count, 4)
        for c in g.list("frames") {
            let nowMs = Int64(truncating: (c["nowMs"] as? NSNumber)!)
            let item = ConfigItem(configId: c.int("configId"), action: 1, data: c.bytes("data"), modifyMs: nowMs)
            let packet = DataSyncWire.config(srcPkg: ActivityGoalsCodec.srcPkg, wearPkg: ActivityGoalsCodec.wearPkg, items: [item])
            XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), c.str("name"))
            XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], c.str("name"))
        }
    }
}

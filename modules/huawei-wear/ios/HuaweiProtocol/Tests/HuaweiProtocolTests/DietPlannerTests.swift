import XCTest
@testable import HuaweiProtocol

/// Meal list, ranges and config JSON against Huawei Health's rules; a translation of the Kotlin DietSyncTest (same vectors and assertions) plus
/// the number formatting and the lenient JSON readers the Kotlin gets from `org.json` and `DataSyncJson`.
final class DietPlannerTests: XCTestCase {
    let today = "2026-10-14"
    let midnight: Int64 = 1_760_400_000
    let breakfastTime: Int64 = 1_760_420_000
    let goals = DietGoals(dailyKcal: 2000, deficitKcal: 500, weightInitKg: 70.0, weightManagerType: 0)

    private func day(_ meals: [DietMeal] = [], date: String? = nil) -> DietDay {
        DietDay(date: date ?? today, meals: meals, goals: goals)
    }

    private func meal(_ which: Int, _ kcal: Double, _ time: Int64? = nil) -> DietMeal {
        let t = time ?? breakfastTime
        return DietMeal(id: "m\(which)\(kcal)\(t)", eatTime: t, kcal: kcal, whichMeal: which)
    }

    private func entries(_ d: DietDay, extra: Bool) -> [DietEntry] {
        DietPlanner.entries(day: d, extraSlots: extra, todayDate: today, todayStartSec: midnight)
    }

    private func json(_ e: [DietEntry]) -> String { String(decoding: DietPlanner.mealsJson(e), as: UTF8.self) }

    func testPlaceholdersFillTheSlotsWithNoMealAndFollowTheExampleShape() {
        // Recommended ranges for a 2000 kcal day (region it, maintain): breakfast 0.20..0.26, lunch 0.40..0.47, dinner 0.30..0.35, snack 0..0.05.
        XCTAssertEqual(
            json(entries(day([meal(10, 350)]), extra: false)),
            "[{\"eatTime\":\(breakfastTime),\"hasFood\":true,\"kiloCalorie\":350.0,\"sugRange\":[400,520],\"whichMeal\":10},"
                + "{\"eatTime\":\(midnight),\"hasFood\":false,\"kiloCalorie\":0.0,\"sugRange\":[800,940],\"whichMeal\":20},"
                + "{\"eatTime\":\(midnight),\"hasFood\":false,\"kiloCalorie\":0.0,\"sugRange\":[600,700],\"whichMeal\":30},"
                + "{\"eatTime\":\(midnight),\"hasFood\":false,\"kiloCalorie\":0.0,\"sugRange\":[0,100],\"whichMeal\":40}]"
        )
    }

    func testAnEmptyTodayGetsFourPlaceholdersWithoutBit215AndThreeWith() {
        let folded = entries(day(), extra: false)
        XCTAssertEqual(folded.map(\.whichMeal), [10, 20, 30, 40])
        XCTAssertTrue(folded.allSatisfy { !$0.hasFood })
        XCTAssertEqual(entries(day(), extra: true).map(\.whichMeal), [10, 20, 30])
    }

    func testPlaceholdersAreOnlyForToday() {
        XCTAssertEqual(entries(day([meal(20, 600)], date: "2026-10-13"), extra: false).map(\.whichMeal), [20])
    }

    func testMealsOfOneTypeAreMergedAndSummed() {
        let list = entries(day([meal(10, 200, 100), meal(10, 150.5, 200)]), extra: false)
        let breakfast = list[0]
        XCTAssertEqual(breakfast.whichMeal, 10)
        XCTAssertEqual(breakfast.kcal, 350.5)
        XCTAssertEqual(breakfast.eatTime, 100)
        XCTAssertTrue(breakfast.hasFood)
    }

    func testExtraSlotsAreKeptWithBit215AndChangeTheGroupsRange() {
        let list = entries(day([meal(10, 300, 100), meal(11, 80, 200)]), extra: true)
        XCTAssertEqual(list.map(\.whichMeal), [10, 11, 20, 30])
        // A day with an extra breakfast: breakfast 0.15..0.21 instead of 0.20..0.26; the extra slot itself 0..0.05.
        XCTAssertEqual(list[0].sugRange, [300, 420])
        XCTAssertEqual(list[1].sugRange, [0, 100])
        // No extra lunch, so lunch keeps the plain range.
        XCTAssertEqual(list[2].sugRange, [800, 940])
    }

    func testExtraSlotsFoldIntoFortyWithoutBit215() {
        let list = entries(day([meal(10, 300, 100), meal(11, 80, 200), meal(21, 20, 300), meal(40, 50, 400)]), extra: false)
        XCTAssertEqual(list.map(\.whichMeal), [10, 40, 20, 30])
        let snack = list[1]
        XCTAssertEqual(snack.kcal, 150)
        XCTAssertTrue(snack.hasFood)
        // [0, sum of the folded meals' range maxima]: extra breakfast 100, extra lunch 100, snack 100.
        XCTAssertEqual(snack.sugRange, [0, 300])
        // The day has an extra lunch (21), so lunch uses the 0.35..0.42 group.
        XCTAssertEqual(list[2].sugRange, [700, 840])
    }

    func testNoGoalMeansNoRangeAndAnEmptyArrayForPlaceholders() {
        let list = entries(DietDay(date: today, meals: [meal(10, 100)], goals: nil), extra: true)
        XCTAssertNil(list[0].sugRange)
        XCTAssertEqual(list[1].sugRange, [])
        XCTAssertTrue(json(list).contains("\"sugRange\":[]"))
    }

    func testLowerOrGainPlansUseTheirOwnRatios() {
        XCTAssertEqual(DietPlanner.range(goalKcal: 2000, which: 10, managerType: 1, extras: []), [500, 640])
        XCTAssertEqual(DietPlanner.range(goalKcal: 2000, which: 10, managerType: 2, extras: []), [500, 600])
        XCTAssertEqual(DietPlanner.range(goalKcal: 0, which: 10, managerType: 0, extras: []).count, 0)
    }

    func testTypeFoldingMatchesFbjE() {
        XCTAssertEqual(DietPlanner.fold(11, extraSlots: false), 40)
        XCTAssertEqual(DietPlanner.fold(21, extraSlots: false), 40)
        XCTAssertEqual(DietPlanner.fold(31, extraSlots: false), 40)
        XCTAssertEqual(DietPlanner.fold(11, extraSlots: true), 11)
        XCTAssertEqual(DietPlanner.fold(20, extraSlots: false), 20)
        XCTAssertTrue(DietPlanner.isMealType(31))
        XCTAssertFalse(DietPlanner.isMealType(50))
    }

    func testConfigJsonFollowsTheIzdFieldOrderAndOnePointFullFormula() {
        // onePointFull = round((min + max) / 14): breakfast (400 + 520) / 14 = 66, lunch (800 + 940) / 14 = 124, dinner (600 + 700) / 14 = 93.
        XCTAssertEqual(
            String(decoding: DietPlanner.configJson(goals, activityCalGoal: 300, weightInitKg: 70.0), as: UTF8.self),
            "{\"onePointFull\":{\"dinner\":93,\"lunch\":124,\"breakfast\":66},\"caloricDeficitGoal\":500,\"weightInit\":70.0,\"activityCalGoal\":300,"
                + "\"fatLossRatio\":{\"maxRatio\":0.0,\"minRatio\":0.0,\"maxWeek\":0,\"gear\":1},\"weightManagerType\":0}"
        )
        XCTAssertEqual(String(decoding: DietPlanner.weightGoalJson(62.5), as: UTF8.self), "{\"weightGoal\":62.5}")
    }

    func testConfigJsonWithoutAWeightWritesZero() {
        let text = String(decoding: DietPlanner.configJson(DietGoals(dailyKcal: 0), activityCalGoal: 300, weightInitKg: nil), as: UTF8.self)
        XCTAssertEqual(
            text,
            "{\"onePointFull\":{\"dinner\":0,\"lunch\":0,\"breakfast\":0},\"caloricDeficitGoal\":0,\"weightInit\":0.0,\"activityCalGoal\":300,"
                + "\"fatLossRatio\":{\"maxRatio\":0.0,\"minRatio\":0.0,\"maxWeek\":0,\"gear\":1},\"weightManagerType\":0}"
        )
    }

    func testQuickLogReplies() {
        XCTAssertEqual(String(decoding: DietPlanner.punchReply(resultCode: 0, failTimeSec: 0), as: UTF8.self), "{\"punchResult\":0,\"event\":6}")
        XCTAssertEqual(
            String(decoding: DietPlanner.punchReply(resultCode: 102, failTimeSec: 1_760_420_000), as: UTF8.self),
            "{\"punchResult\":102,\"punchFailTime\":1760420000,\"event\":6}"
        )
    }

    private func object(_ text: String) -> [String: Any] {
        (try! JSONSerialization.jsonObject(with: Data(text.utf8))) as! [String: Any]
    }

    func testQuickLogParsingKeepsRealMealsAndNormalisesTime() {
        let body = object(
            "{\"meals\":[{\"whichMeal\":10,\"eatTime\":1760420000,\"kiloCalorie\":350.5,\"timeZone\":\"+07:00\"},"
                + "{\"whichMeal\":0,\"eatTime\":1,\"kiloCalorie\":1},"
                + "{\"whichMeal\":20,\"eatTime\":1760430000000,\"kiloCalorie\":600}],\"startTime\":1760420000}"
        )
        let meals = DietPlanner.parseQuickLog(body, nowSec: 5)
        XCTAssertEqual(meals.count, 2)
        XCTAssertEqual(meals[0].whichMeal, 10)
        XCTAssertEqual(meals[0].kcal, 350.5)
        XCTAssertEqual(meals[1].eatTime, 1_760_430_000)
        XCTAssertEqual(meals[0].src, "watch")
        XCTAssertFalse(meals[0].synced)
        // The ids are stable per time, type and position in the watch's array (position 2 here: the skipped entry still counts).
        XCTAssertEqual(meals[0].id, "watch-1760420000-10-0")
        XCTAssertEqual(meals[1].id, "watch-1760430000-20-2")
        // The array may also arrive as a string (Huawei's getString("meals")).
        let asString = ["meals": "[{\"whichMeal\":30,\"eatTime\":0,\"kiloCalorie\":10}]"] as [String: Any]
        let parsed = DietPlanner.parseQuickLog(asString, nowSec: 77)
        XCTAssertEqual(parsed[0].eatTime, 77)
        XCTAssertTrue(DietPlanner.parseQuickLog([:], nowSec: 1).isEmpty)
        XCTAssertTrue(DietPlanner.parseQuickLog(["meals": "not json"], nowSec: 1).isEmpty)
        XCTAssertTrue(DietPlanner.parseQuickLog(["meals": 5], nowSec: 1).isEmpty)
    }

    func testDietaryAnalysisOnlyWhenMacrosAreKnown() {
        XCTAssertNil(DietPlanner.analysisJson(day([meal(10, 100)])))
        let withMacros = day([
            DietMeal(id: "a", eatTime: 1, kcal: 100, whichMeal: 10, carbs: 20.5, protein: 5.0, fat: 1.0),
            DietMeal(id: "b", eatTime: 2, kcal: 100, whichMeal: 20, carbs: 10.0),
        ])
        XCTAssertEqual(
            String(decoding: DietPlanner.analysisJson(withMacros)!, as: UTF8.self),
            "{\"dietaryAnalysis\":{\"coefficient\":1,\"carbohydrates\":30.5,\"protein\":5.0,\"fat\":1.0}}"
        )
    }

    func testTheWholeSamplePointCarriesTheMealsAndTheAnalysis() throws {
        let list = entries(day([meal(10, 350)]), extra: false)
        let packet = DataSyncWire.samplePoint(
            srcPkg: DietPlanner.phonePkg, wearPkg: DietPlanner.watchPkg, dictType: DietPlanner.dictDiet,
            values: [PointValue(key: DietPlanner.dictDiet, value: DietPlanner.mealsJson(list))], startMs: 0, endMs: 0,
            metadata: DietPlanner.analysisJson(day([DietMeal(id: "a", eatTime: 1, kcal: 1, whichMeal: 10, protein: 2.0)]))
        )
        let point = try DataSyncWire.parsePoint(packet.tlv!)
        XCTAssertEqual(point.dictId, DietPlanner.dictDiet)
        XCTAssertEqual(String(decoding: point.values[0].value!, as: UTF8.self), json(list))
        XCTAssertEqual(
            String(decoding: point.metadata!, as: UTF8.self), "{\"dietaryAnalysis\":{\"coefficient\":1,\"carbohydrates\":0.0,\"protein\":2.0,\"fat\":0.0}}"
        )
    }

    // MARK: beyond the Kotlin tests

    func testJavaNumberFormatting() {
        func f(_ v: Float) -> String { DietJson.float(v).write() }
        func d(_ v: Double) -> String { DietJson.double(v).write() }
        XCTAssertEqual(f(350), "350.0")
        XCTAssertEqual(f(350.5), "350.5")
        XCTAssertEqual(f(0), "0.0")
        XCTAssertEqual(f(-0.0), "-0.0")
        XCTAssertEqual(f(0.1), "0.1")
        XCTAssertEqual(f(1234.5678), "1234.5677")
        XCTAssertEqual(f(0.001), "0.001")
        XCTAssertEqual(f(0.0001), "1.0E-4")
        XCTAssertEqual(f(1e7), "1.0E7")
        XCTAssertEqual(f(12_345_678), "1.2345678E7")
        XCTAssertEqual(f(9_999_999), "9999999.0")
        XCTAssertEqual(f(.nan), "null")
        XCTAssertEqual(d(62.5), "62.5")
        XCTAssertEqual(d(70), "70.0")
        XCTAssertEqual(d(1e-5), "1.0E-5")
        XCTAssertEqual(d(-123.25), "-123.25")
        XCTAssertEqual(d(100), "100.0")
        XCTAssertEqual(d(1e21), "1.0E21")
    }

    func testStringsAreEscapedLikeDataSyncJson() {
        XCTAssertEqual(DietJson.string("a\"b\\c\n\r\t\u{01}é").write(), "\"a\\\"b\\\\c\\n\\r\\t\\u0001é\"")
    }

    func testStoredMealAndGoalsRoundTrip() {
        let m = DietMeal(id: "a", eatTime: 1_760_420_000, kcal: 350.5, whichMeal: 10, carbs: 1.5, src: "watch", synced: false)
        let data = try! JSONSerialization.data(withJSONObject: m.toJson())
        XCTAssertEqual(DietMeal.fromJson(try! JSONSerialization.jsonObject(with: data) as! [String: Any]), m)
        let g = DietGoals(dailyKcal: 1800, deficitKcal: 300, weightInitKg: 70.5, targetWeightKg: 65, weightManagerType: 1, activityCalGoal: 400)
        let gdata = try! JSONSerialization.data(withJSONObject: g.toJson())
        XCTAssertEqual(DietGoals.fromJson(try! JSONSerialization.jsonObject(with: gdata) as! [String: Any]), g)
        XCTAssertNil(DietGoals.fromJson([:]))
        // A stored meal without an id gets a fresh one, as on Android.
        XCTAssertFalse(DietMeal.fromJson(["eatTime": 1, "kcal": 2, "whichMeal": 20]).id.isEmpty)
        XCTAssertEqual(DietMeal.fromJson(["eatTime": 1]).whichMeal, 40)
        XCTAssertTrue(DietMeal.fromJson(["eatTime": 1]).synced)
    }

    func testTheJsStatusShapeUsesNullForUnsetFields() {
        XCTAssertTrue(DietGoals(dailyKcal: 2000).toJS()["weightInitKg"] is NSNull)
        XCTAssertTrue(DietMeal(id: "a", eatTime: 1, kcal: 1, whichMeal: 10).toJS()["carbs"] is NSNull)
        XCTAssertEqual(DietMeal(id: "a", eatTime: 1, kcal: 1, whichMeal: 10, carbs: 2).toJS()["carbs"] as? Double, 2)
    }

    func testTheJsArgumentFollowsTheRecordDefaults() {
        let arg = DietDayArgument(
            js: [
                "date": "2026-10-14",
                "meals": [["eatTime": 1_760_420_000, "kcal": 350, "whichMeal": 10, "protein": 4.5] as [String: Any], ["eatTime": 5, "kcal": 1.5] as [String: Any]],
                "goals": ["dailyKcal": 2000, "weightInitKg": 70] as [String: Any],
            ]
        )!
        XCTAssertEqual(arg.date, "2026-10-14")
        XCTAssertEqual(arg.meals[0].id, "app-2026-10-14-0")
        XCTAssertEqual(arg.meals[0].protein, 4.5)
        XCTAssertNil(arg.meals[0].carbs)
        XCTAssertEqual(arg.meals[1].whichMeal, 40)
        XCTAssertEqual(arg.goals, DietGoals(dailyKcal: 2000, deficitKcal: 0, weightInitKg: 70, targetWeightKg: nil, weightManagerType: 0, activityCalGoal: nil))
        XCTAssertNil(DietDayArgument(js: ["date": "x", "meals": [5]]))
        XCTAssertNil(DietDayArgument(js: ["date": "x"])!.goals)
    }

    func testParseObjectAndReadInt32() {
        XCTAssertNil(DietPlanner.parseObject(nil))
        XCTAssertNil(DietPlanner.parseObject([]))
        XCTAssertNil(DietPlanner.parseObject(Bytes("[1]".utf8)))
        XCTAssertEqual(DietPlanner.parseObject(Bytes("{\"event\":6}".utf8))?["event"] as? Int, 6)
        XCTAssertEqual(DietPlanner.readInt32([0, 0, 0, 1]), 1)
        XCTAssertEqual(DietPlanner.readInt32([1]), 1)
        XCTAssertNil(DietPlanner.readInt32([]))
        XCTAssertNil(DietPlanner.readInt32([0, 0, 0, 0, 1]))
        XCTAssertEqual(DietPlanner.readInt32([0xFF, 0xFF, 0xFF, 0xFF]), -1)
    }
}

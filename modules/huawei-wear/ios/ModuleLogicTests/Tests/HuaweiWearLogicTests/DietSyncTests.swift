import XCTest
@testable import HuaweiWearLogic

/// Events of the diet tests: the log and the meals the watch logged.
private final class DietEvents: WearEvents, @unchecked Sendable {
    private let lock = NSLock()
    private var _logs: [LogEntry] = []
    private var _meals: [[String: Any]] = []
    var logs: [LogEntry] { lock.locked { _logs } }
    var meals: [[String: Any]] { lock.locked { _meals } }
    func state(_ state: LinkState, error: String?) {}
    func battery(_ level: Int) {}
    func syncComplete(_ summary: SyncSummary) {}
    func log(_ entry: LogEntry) { lock.locked { _logs.append(entry) } }
    func watchMealLogged(_ payload: [String: Any]) { lock.locked { _meals.append(payload) } }
    func contains(_ fragment: String) -> Bool { logs.contains { $0.message.contains(fragment) } }
}

private final class WeightCalls: @unchecked Sendable {
    private let lock = NSLock()
    private var _calls: [String] = []
    var calls: [String] { lock.locked { _calls } }
    func add(_ s: String) { lock.locked { _calls.append(s) } }
}

/// A connected watch, the DataSync framework and a `DietSync` on a real SQLite file; "now" is 2025-10-14 13:53:20 UTC and the calendar is UTC.
private final class DietRig {
    static let nowSec: Int64 = 1_760_450_000
    static let midnight: Int64 = 1_760_400_000
    static let today = "2025-10-14"

    let rig: DataSyncRig
    let events = DietEvents()
    let store: SyncStore
    let defaults = ephemeralDefaults()
    let settings = WearSettings(defaults: ephemeralDefaults())
    let weight = WeightCalls()
    let diet: DietSync
    let calendar: Calendar

    init(bits: [Int] = [83, 84, 85, 173, 215], connected: Bool = true, store: SyncStore? = nil, defaults: UserDefaults? = nil, activityCalories: Int = 300) {
        // DataSyncRig's bitmap stops at bit 191; bit 215 needs a longer one.
        rig = DataSyncRig(bits: bits.filter { $0 < 192 }, connected: connected)
        var bitmap = Bytes(repeating: 0, count: 32)
        for bit in bits { bitmap[bit / 8] |= UInt8(1 << (bit % 8)) }
        rig.caps.expandCapabilities = bitmap
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        self.calendar = calendar
        self.store = store ?? SyncStore(url: temporaryDatabaseURL())
        let weight = self.weight
        diet = DietSync(
            store: self.store, events: events, settings: settings, defaults: defaults ?? self.defaults, calendar: calendar,
            now: { Date(timeIntervalSince1970: Double(DietRig.nowSec)) }, activityCalories: { activityCalories },
            sendWeight: { phone, watch, reason in
                weight.add("\(phone)|\(watch)|\(reason)")
                return true
            }
        )
        rig.service.register(diet)
    }

    func meal(_ which: Int, _ kcal: Double, id: String? = nil, time: Int64 = DietRig.midnight + 3600) -> DietMeal {
        DietMeal(id: id ?? "m\(which)", eatTime: time, kcal: kcal, whichMeal: which)
    }

    func frames(service: UInt8 = 0x37, command: UInt8) -> [HuaweiTLV] { rig.watch.sent.filter { $0.service == service && $0.command == command }.map(\.tlv) }

    var pointJsons: [String] {
        frames(command: 0x03).map { String(decoding: try! DataSyncWire.parsePoint($0).values[0].value!, as: UTF8.self) }
    }

    var configs: [SampleConfigIn] { frames(command: 0x01).map { try! DataSyncWire.parseConfig($0) } }

    var eventsSent: [SampleEvent] { frames(command: 0x02).map { DataSyncWire.parseEvent($0) } }

    func watchEvent(_ json: String) {
        rig.session.onData(DataSyncRig.eventFrame(src: DietPlanner.watchPkg, wear: DietPlanner.phonePkg, id: DietPlanner.eventDiet, data: Bytes(json.utf8)))
    }
}

final class DietSyncTests: XCTestCase {
    private let goals = DietGoals(dailyKcal: 2000, deficitKcal: 500, weightInitKg: 70, weightManagerType: 0)

    // MARK: JS API

    func testSetDayStoresAndPushesTheConfigThenTheMeals() async throws {
        let r = DietRig()
        let sent = try await r.diet.setDay(date: DietRig.today, meals: [r.meal(10, 350)], goals: goals)

        XCTAssertTrue(sent)
        XCTAssertEqual(r.configs.count, 1)
        let config = r.configs[0]
        XCTAssertEqual(config.srcPkg, DietPlanner.phonePkg)
        XCTAssertEqual(config.wearPkg, DietPlanner.watchPkg)
        XCTAssertEqual(config.items[0].configId, DietPlanner.configDiet)
        XCTAssertEqual(
            String(decoding: config.items[0].data!, as: UTF8.self),
            "{\"onePointFull\":{\"dinner\":93,\"lunch\":124,\"breakfast\":66},\"caloricDeficitGoal\":500,\"weightInit\":70.0,\"activityCalGoal\":300,"
                + "\"fatLossRatio\":{\"maxRatio\":0.0,\"minRatio\":0.0,\"maxWeek\":0,\"gear\":1},\"weightManagerType\":0}"
        )
        let t = DietRig.midnight + 3600
        XCTAssertEqual(
            r.pointJsons,
            [
                "[{\"eatTime\":\(t),\"hasFood\":true,\"kiloCalorie\":350.0,\"sugRange\":[400,520],\"whichMeal\":10},"
                    + "{\"eatTime\":\(DietRig.midnight),\"hasFood\":false,\"kiloCalorie\":0.0,\"sugRange\":[800,940],\"whichMeal\":20},"
                    + "{\"eatTime\":\(DietRig.midnight),\"hasFood\":false,\"kiloCalorie\":0.0,\"sugRange\":[600,700],\"whichMeal\":30}]"
            ]
        )
        let point = try DataSyncWire.parsePoint(r.frames(command: 0x03)[0])
        XCTAssertEqual(point.dictId, DietPlanner.dictDiet)
        XCTAssertNil(point.metadata)
        let status = r.diet.status()
        XCTAssertEqual(status["lastResult"] as? String, "sent (set)")
        XCTAssertEqual(status["pushedAt"] as? Int64, DietRig.nowSec * 1000)
        XCTAssertEqual(status["mealCount"] as? Int, 1)
        XCTAssertEqual(status["intakeKcal"] as? Double, 350)
        XCTAssertEqual(status["updatedAt"] as? Int64, DietRig.nowSec * 1000)
        XCTAssertEqual(try r.store.read { try $0.query("SELECT pushed_at FROM diet_day WHERE date = '2025-10-14'") { $0.int64(0) } }, [DietRig.nowSec * 1000])
    }

    func testTheWeightGoalIsItsOwnConfigAndTheMacrosGoAsAnalysis() async throws {
        let r = DietRig()
        var withTarget = goals
        withTarget.targetWeightKg = 62.5
        withTarget.activityCalGoal = 450
        var m = r.meal(20, 600)
        m.protein = 30
        let sent = try await r.diet.setDay(date: DietRig.today, meals: [m], goals: withTarget)

        XCTAssertTrue(sent)
        XCTAssertEqual(r.configs.map { $0.items[0].configId }, [DietPlanner.configDiet, DietPlanner.configWeightGoal])
        XCTAssertTrue(String(decoding: r.configs[0].items[0].data!, as: UTF8.self).contains("\"activityCalGoal\":450"))
        XCTAssertEqual(String(decoding: r.configs[1].items[0].data!, as: UTF8.self), "{\"weightGoal\":62.5}")
        let point = try DataSyncWire.parsePoint(r.frames(command: 0x03)[0])
        XCTAssertEqual(
            String(decoding: point.metadata!, as: UTF8.self), "{\"dietaryAnalysis\":{\"coefficient\":1,\"carbohydrates\":0.0,\"protein\":30.0,\"fat\":0.0}}"
        )
    }

    func testTheProfileWeightAndTheRingGoalFillWhatTheGoalsLeaveOut() async throws {
        let r = DietRig(activityCalories: 420)
        r.settings.profile = UserProfileData(heightCm: 170, weightKg: 66.5, birthYear: 1990, sex: "male", dailyStepGoal: 8000)
        _ = try await r.diet.setDay(date: DietRig.today, meals: [], goals: DietGoals(dailyKcal: 1800))

        let text = String(decoding: r.configs[0].items[0].data!, as: UTF8.self)
        XCTAssertTrue(text.contains("\"weightInit\":66.5"), text)
        XCTAssertTrue(text.contains("\"activityCalGoal\":420"), text)
    }

    func testSetDayWithoutAWatchStoresAndSaysSo() async throws {
        let r = DietRig(connected: false)
        let sent = try await r.diet.setDay(date: DietRig.today, meals: [r.meal(10, 350)], goals: goals)

        XCTAssertFalse(sent)
        XCTAssertTrue(r.rig.watch.sent.isEmpty)
        XCTAssertEqual(r.diet.status()["lastResult"] as? String, "watch not connected")
        XCTAssertNil(r.diet.status()["pushedAt"] as? Int64)
        XCTAssertEqual(r.diet.status()["mealCount"] as? Int, 1)
        XCTAssertNil(r.diet.status()["supported"] as? [String: Any])
        XCTAssertTrue(r.events.contains("not pushed (set): no connected watch; it is sent at the next connect"))
    }

    func testBadArgumentsAreRejectedAndNothingIsStored() async {
        let r = DietRig()
        func expectInvalid(_ date: String, _ meals: [DietMeal], _ g: DietGoals?, _ fragment: String, line: UInt = #line) async {
            do {
                _ = try await r.diet.setDay(date: date, meals: meals, goals: g)
                XCTFail("expected an error", line: line)
            } catch let e as WearError {
                XCTAssertEqual(e.code, .invalidArgument, line: line)
                XCTAssertTrue(e.message.contains(fragment), e.message, line: line)
            } catch {
                XCTFail("\(error)", line: line)
            }
        }
        await expectInvalid("2025-1-14", [], nil, "date must be YYYY-MM-DD")
        await expectInvalid("2025-10-14 ", [], nil, "date must be YYYY-MM-DD")
        await expectInvalid(DietRig.today, [r.meal(50, 100)], nil, "whichMeal must be 10, 11, 20, 21, 30, 31 or 40, got 50")
        await expectInvalid(DietRig.today, [r.meal(10, -1)], nil, "kcal out of range")
        await expectInvalid(DietRig.today, [r.meal(10, 20_001)], nil, "kcal out of range")
        await expectInvalid(DietRig.today, [], DietGoals(dailyKcal: 20_001), "dailyKcal out of range: 20001")
        XCTAssertNil(r.diet.status()["date"] as? String)
    }

    func testTheLatestGoalsAreReusedWhenTheDayBringsNone() async throws {
        let r = DietRig(connected: false)
        _ = try await r.diet.setDay(date: "2025-10-13", meals: [], goals: goals)
        _ = try await r.diet.setDay(date: DietRig.today, meals: [r.meal(10, 100)], goals: nil)

        XCTAssertEqual((r.diet.status()["goals"] as? [String: Any])?["dailyKcal"] as? Int, 2000)
        // The day after the same day with its own goals keeps those.
        _ = try await r.diet.setDay(date: DietRig.today, meals: [], goals: DietGoals(dailyKcal: 1500))
        _ = try await r.diet.setDay(date: DietRig.today, meals: [], goals: nil)
        XCTAssertEqual((r.diet.status()["goals"] as? [String: Any])?["dailyKcal"] as? Int, 1500)
    }

    func testPushingWithNothingStoredSaysSo() async throws {
        let r = DietRig()
        let sent = try await r.diet.push("manual", withConfig: true)

        XCTAssertFalse(sent)
        XCTAssertEqual(r.diet.status()["lastResult"] as? String, "nothing stored")
        XCTAssertTrue(r.rig.watch.sent.isEmpty)
    }

    func testANewDayRollsOverToEmptySlotsWithTheLatestGoals() async throws {
        let r = DietRig()
        _ = try await r.diet.setDay(date: "2025-10-13", meals: [r.meal(10, 350)], goals: goals)
        r.rig.watch.responder = { _ in [] }
        let sentBefore = r.rig.watch.sent.count

        let pushed = try await r.diet.push("manual", withConfig: true)

        XCTAssertTrue(pushed)
        XCTAssertGreaterThan(r.rig.watch.sent.count, sentBefore)
        XCTAssertEqual(r.pointJsons.last?.contains("\"hasFood\":true"), false)
        XCTAssertEqual(r.diet.status()["date"] as? String, DietRig.today)
        XCTAssertEqual(r.diet.status()["mealCount"] as? Int, 0)
        XCTAssertEqual(r.diet.status()["intakeKcal"] as? Double, 0)
        XCTAssertEqual((r.diet.status()["goals"] as? [String: Any])?["dailyKcal"] as? Int, 2000)
    }

    func testTheStatusShapeMatchesDietStatus() async throws {
        let r = DietRig()
        let empty = r.diet.status()
        XCTAssertEqual(
            Set(empty.keys), ["date", "mealCount", "intakeKcal", "goals", "updatedAt", "pushedAt", "lastResult", "unsyncedWatchMeals", "pendingWatchMeals", "supported"]
        )
        XCTAssertTrue(empty["date"] is NSNull)
        XCTAssertTrue(empty["goals"] is NSNull)
        XCTAssertEqual(empty["unsyncedWatchMeals"] as? Int, 0)
        XCTAssertEqual((empty["pendingWatchMeals"] as? [Any])?.count, 0)
        let supported = empty["supported"] as? [String: Any]
        XCTAssertEqual(Set((supported ?? [:]).keys), ["config", "event", "point", "dictionary", "extraMealSlots"])
        XCTAssertEqual(supported?["extraMealSlots"] as? Bool, true)
        _ = try await r.diet.setDay(date: DietRig.today, meals: [], goals: DietGoals(dailyKcal: 2000))
        let goalKeys = Set(((r.diet.status()["goals"] as? [String: Any]) ?? [:]).keys)
        XCTAssertEqual(goalKeys, ["dailyKcal", "deficitKcal", "weightInitKg", "targetWeightKg", "weightManagerType", "activityCalGoal"])
    }

    func testSupportFollowsTheWatchsBits() {
        let r = DietRig(bits: [83, 85])
        let supported = r.diet.status()["supported"] as? [String: Any]
        XCTAssertEqual(supported?["config"] as? Bool, true)
        XCTAssertEqual(supported?["event"] as? Bool, false)
        XCTAssertEqual(supported?["point"] as? Bool, true)
        XCTAssertEqual(supported?["dictionary"] as? Bool, false)
        XCTAssertEqual(supported?["extraMealSlots"] as? Bool, false)
    }

    func testAMissingCapabilityMakesThePushFail() async throws {
        let r = DietRig(bits: [83])
        let sent = try await r.diet.setDay(date: DietRig.today, meals: [r.meal(10, 350)], goals: goals)

        XCTAssertFalse(sent)
        XCTAssertEqual(r.diet.status()["lastResult"] as? String, "failed (set), see the log")
        XCTAssertEqual(r.configs.count, 1)
        XCTAssertTrue(r.pointJsons.isEmpty)
    }

    func testWithoutBit215TheExtraSlotsFoldIntoOther() async throws {
        let r = DietRig(bits: [83, 84, 85, 173])
        _ = try await r.diet.setDay(date: DietRig.today, meals: [r.meal(11, 80), r.meal(40, 50)], goals: goals)

        let json = r.pointJsons[0]
        XCTAssertTrue(json.contains("{\"eatTime\":\(DietRig.midnight + 3600),\"hasFood\":true,\"kiloCalorie\":130.0,\"sugRange\":[0,200],\"whichMeal\":40}"), json)
        XCTAssertFalse(json.contains("\"whichMeal\":11"))
        XCTAssertTrue(r.events.contains("NOT set: they fold into 40"))
    }

    // MARK: watch-logged meals

    func testWatchMealsSurviveASetDayUntilMarkedSynced() async throws {
        let r = DietRig(connected: false)
        _ = try await r.diet.setDay(date: DietRig.today, meals: [r.meal(10, 350, id: "app-1")], goals: goals)
        let watchMeal = DietMeal(id: "watch-1-20-0", eatTime: DietRig.midnight + 7200, kcal: 600, whichMeal: 20, src: "watch", synced: false)
        var day = try XCTUnwrap(r.diet.currentDay())
        day.meals.append(watchMeal)
        try DietStore(r.store).put(day)

        XCTAssertEqual(r.diet.status()["unsyncedWatchMeals"] as? Int, 1)
        _ = try await r.diet.setDay(date: DietRig.today, meals: [r.meal(10, 400, id: "app-1")], goals: nil)
        XCTAssertEqual(r.diet.status()["mealCount"] as? Int, 2)
        XCTAssertEqual(r.diet.status()["intakeKcal"] as? Double, 1000)
        let pending = try XCTUnwrap(r.diet.status()["pendingWatchMeals"] as? [[String: Any]])
        XCTAssertEqual(pending.map { $0["id"] as? String }, ["watch-1-20-0"])
        XCTAssertEqual(pending[0]["src"] as? String, "watch")
        XCTAssertEqual(pending[0]["synced"] as? Bool, false)

        try r.diet.markWatchMealsSynced(["watch-1-20-0"])
        XCTAssertEqual(r.diet.status()["unsyncedWatchMeals"] as? Int, 0)
        XCTAssertEqual(r.diet.status()["mealCount"] as? Int, 2)
        // Once synced, JS's next day replaces it (JoyoRogo now holds it, so JS sends it itself).
        _ = try await r.diet.setDay(date: DietRig.today, meals: [r.meal(10, 400, id: "app-1")], goals: nil)
        XCTAssertEqual(r.diet.status()["mealCount"] as? Int, 1)
    }

    func testAMealJsAlreadyHasIsNotDuplicatedWhenItComesBackWithTheSameId() async throws {
        let r = DietRig(connected: false)
        var day = DietDay(date: DietRig.today, meals: [DietMeal(id: "watch-1-20-0", eatTime: 5, kcal: 600, whichMeal: 20, src: "watch", synced: false)], goals: goals)
        day.updatedAt = 1
        try DietStore(r.store).put(day)

        _ = try await r.diet.setDay(date: DietRig.today, meals: [DietMeal(id: "watch-1-20-0", eatTime: 5, kcal: 600, whichMeal: 20)], goals: nil)

        XCTAssertEqual(r.diet.status()["mealCount"] as? Int, 1)
        XCTAssertEqual(r.diet.status()["unsyncedWatchMeals"] as? Int, 0)
    }

    func testTheQuickLogIsStoredReportedAnsweredAndPushed() async throws {
        let r = DietRig()
        _ = try await r.diet.setDay(date: DietRig.today, meals: [], goals: goals)
        await r.rig.attach()
        let before = r.pointJsons.count
        let configsBefore = r.configs.count
        let t = DietRig.midnight + 36_000

        r.watchEvent("{\"event\":6,\"meals\":[{\"whichMeal\":10,\"eatTime\":\(t),\"kiloCalorie\":350.5}]}")

        await eventually { r.pointJsons.count == before + 1 }
        // Reported to JS.
        XCTAssertEqual(r.events.meals.count, 1)
        XCTAssertEqual(r.events.meals[0]["date"] as? String, DietRig.today)
        let reported = try XCTUnwrap((r.events.meals[0]["meals"] as? [[String: Any]])?.first)
        XCTAssertEqual(reported["id"] as? String, "watch-\(t)-10-0")
        XCTAssertEqual(reported["kcal"] as? Double, 350.5)
        XCTAssertEqual(reported["src"] as? String, "watch")
        XCTAssertEqual(reported["synced"] as? Bool, false)
        XCTAssertTrue(reported["carbs"] is NSNull)
        // Kept until marked synced.
        XCTAssertEqual(r.diet.status()["unsyncedWatchMeals"] as? Int, 1)
        XCTAssertEqual(r.diet.status()["intakeKcal"] as? Double, 350.5)
        // Answered (bit 215) with punchResult 0, and the meals went out again without configs.
        let replies = r.eventsSent.filter { $0.eventId == DietPlanner.eventDiet }
        XCTAssertEqual(replies.count, 1)
        XCTAssertEqual(String(decoding: replies[0].data!, as: UTF8.self), "{\"punchResult\":0,\"event\":6}")
        XCTAssertEqual(r.configs.count, configsBefore, "the push after a quick log is the point only")
        XCTAssertTrue(r.pointJsons.last!.contains("\"kiloCalorie\":350.5"))
    }

    func testTheQuickLogReplyNeedsBit215ButTheMealIsStoredAnyway() async throws {
        let r = DietRig(bits: [83, 84, 85, 173])
        await r.rig.attach()
        let t = DietRig.midnight + 36_000

        r.watchEvent("{\"event\":6,\"meals\":[{\"whichMeal\":30,\"eatTime\":\(t * 1000),\"kiloCalorie\":700}]}")

        await eventually { r.events.meals.count == 1 }
        XCTAssertEqual(r.diet.status()["unsyncedWatchMeals"] as? Int, 1)
        XCTAssertTrue(r.eventsSent.isEmpty)
        XCTAssertTrue(r.events.contains("not set, no quick-log reply sent"))
        // Nothing was stored for the day before, so it takes no goals.
        XCTAssertTrue(r.diet.status()["goals"] is NSNull)
    }

    func testAQuickLogOfADifferentDayGoesToThatDayAndKeepsTheLatestGoals() async throws {
        let r = DietRig()
        _ = try await r.diet.setDay(date: DietRig.today, meals: [], goals: goals)
        await r.rig.attach()
        let yesterday = DietRig.midnight - 3600

        r.watchEvent("{\"event\":6,\"meals\":[{\"whichMeal\":20,\"eatTime\":\(yesterday),\"kiloCalorie\":500}]}")

        await eventually { r.events.meals.count == 1 }
        XCTAssertEqual(r.events.meals[0]["date"] as? String, "2025-10-13")
        let stored = try XCTUnwrap(DietStore(r.store).day("2025-10-13"))
        XCTAssertEqual(stored.goals?.dailyKcal, 2000)
        XCTAssertEqual(stored.meals.count, 1)
        XCTAssertEqual(stored.meals[0].src, "watch")
        XCTAssertEqual(try DietStore(r.store).day(DietRig.today)?.meals.count, 0)
    }

    func testTheQuickLogWithOnlyBadMealsStoresNothingAndAnswersOk() async throws {
        let r = DietRig()
        await r.rig.attach()

        r.watchEvent("{\"event\":6,\"meals\":[{\"whichMeal\":0,\"eatTime\":1,\"kiloCalorie\":1}]}")

        await eventually { r.eventsSent.count == 1 }
        XCTAssertTrue(r.events.meals.isEmpty)
        XCTAssertEqual(String(decoding: r.eventsSent[0].data!, as: UTF8.self), "{\"punchResult\":0,\"event\":6}")
        XCTAssertTrue(r.frames(command: 0x03).isEmpty, "no meals, no push")
    }

    // MARK: the watch's requests

    func testTheWatchAskingForItsMealsGetsThePointForTheClampedWindow() async throws {
        let r = DietRig()
        _ = try await r.diet.setDay(date: DietRig.today, meals: [r.meal(10, 350)], goals: goals)
        await r.rig.attach()
        let before = r.frames(command: 0x03).count
        let configsBefore = r.configs.count
        let start = (DietRig.midnight + 5000) * 1000
        let end = (DietRig.midnight + 9000) * 1000

        r.watchEvent("{\"event\":1,\"startTime\":\(start),\"endTime\":\(end)}")

        await eventually { r.frames(command: 0x03).count == before + 1 }
        XCTAssertEqual(r.configs.count, configsBefore, "a request is answered with the point only")
        XCTAssertTrue(r.events.contains("the watch asks for its meals (event 1, window \(start)..\(end))"))
    }

    func testTheWatchAskingForTheWeightGoesToTheBodyMetricsHook() async throws {
        let r = DietRig()
        await r.rig.attach()

        r.watchEvent("{\"event\":5}")

        await eventually { !r.weight.calls.isEmpty }
        XCTAssertEqual(r.weight.calls, ["\(DietPlanner.phonePkg)|\(DietPlanner.watchPkg)|watch request"])
    }

    func testOtherEventKindsAndBodiesAreLoggedNotAnswered() async throws {
        let r = DietRig()
        await r.rig.attach()

        r.watchEvent("{\"event\":4}")
        r.rig.session.onData(DataSyncRig.eventFrame(src: DietPlanner.watchPkg, wear: DietPlanner.phonePkg, id: DietPlanner.eventDiet, data: nil))

        await eventually { r.events.contains("without a JSON body, ignored") && r.events.contains("kind 4") }
        XCTAssertTrue(r.rig.watch.sent.isEmpty)
    }

    func testTheVipFlagIsAnsweredOnlyForARequestOfOne() async throws {
        let r = DietRig()
        await r.rig.attach()
        func vip(_ data: Bytes?) {
            r.rig.session.onData(DataSyncRig.eventFrame(src: DietPlanner.watchPkg, wear: DietPlanner.commonPkg, id: DietPlanner.eventVip, data: data))
        }

        vip([0, 0, 0, 2])
        await eventually { r.events.contains("VIP flag event with request 2, not answered") }
        vip(nil)
        await eventually { r.events.contains("VIP flag event with request none, not answered") }
        XCTAssertTrue(r.rig.watch.sent.isEmpty)

        vip([0, 0, 0, 1])
        await eventually { r.eventsSent.count == 1 }
        XCTAssertEqual(r.eventsSent[0].eventId, DietPlanner.eventVip)
        XCTAssertEqual(r.eventsSent[0].data, [0])
        XCTAssertEqual(r.eventsSent[0].srcPkg, DietPlanner.commonPkg)
        XCTAssertEqual(r.eventsSent[0].wearPkg, DietPlanner.watchPkg)
    }

    func testTheStoredDayIsPushedWithItsConfigWhenTheWatchConnects() async throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let defaults = ephemeralDefaults()
        let first = DietRig(connected: false, store: store, defaults: defaults)
        _ = try await first.diet.setDay(date: DietRig.today, meals: [first.meal(10, 350)], goals: goals)
        XCTAssertEqual(first.diet.status()["lastResult"] as? String, "watch not connected")

        // The process starts again with the watch there: only the database and the defaults carry over.
        let second = DietRig(store: store, defaults: defaults)
        await second.rig.attach()

        XCTAssertEqual(second.configs.count, 1)
        XCTAssertEqual(second.pointJsons.count, 1)
        XCTAssertTrue(second.pointJsons[0].contains("\"kiloCalorie\":350.0"))
        XCTAssertEqual(second.diet.status()["lastResult"] as? String, "sent (connected)")
    }

    func testTheGoalsOfTheStoredDayAreLoggedWhenNoneExist() async throws {
        let r = DietRig()
        _ = try await r.diet.setDay(date: DietRig.today, meals: [r.meal(10, 100)], goals: nil)

        XCTAssertTrue(r.configs.isEmpty)
        XCTAssertEqual(r.pointJsons.count, 1)
        XCTAssertTrue(r.events.contains("no goals stored, config 900300023 not sent"))
        XCTAssertTrue(r.pointJsons[0].contains("\"sugRange\":[]"))
    }

    func testTheIntakeOfADayIsAvailableToOtherFeatures() async throws {
        let r = DietRig(connected: false)
        _ = try await r.diet.setDay(date: DietRig.today, meals: [r.meal(10, 100), r.meal(20, 250.5)], goals: nil)

        XCTAssertEqual(try r.diet.intakeKcal(DietRig.today), 350.5)
        XCTAssertNil(try r.diet.intakeKcal("2025-10-01"))
    }

    func testTheStoredRowIsWhatAndroidWrites() async throws {
        let r = DietRig(connected: false)
        var m = r.meal(10, 350.5)
        m.carbs = 40
        _ = try await r.diet.setDay(date: DietRig.today, meals: [m], goals: goals)

        let row = try r.store.read { db in
            try db.query("SELECT meals_json, goals_json, updated_at FROM diet_day WHERE date = ?", [.text(DietRig.today)]) { ($0.text(0)!, $0.text(1)!, $0.int64(2)) }
        }
        let meals = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(row[0].0.utf8)) as? [[String: Any]])
        XCTAssertEqual(Set(meals[0].keys), ["id", "eatTime", "kcal", "whichMeal", "src", "synced", "carbs"])
        XCTAssertEqual(meals[0]["src"] as? String, "app")
        XCTAssertEqual(meals[0]["synced"] as? Bool, true)
        let g = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(row[0].1.utf8)) as? [String: Any])
        XCTAssertEqual(Set(g.keys), ["dailyKcal", "deficitKcal", "weightManagerType", "weightInitKg"])
        XCTAssertEqual(row[0].2, DietRig.nowSec * 1000)
    }
}

import XCTest
@testable import HuaweiWearLogic

final class AppleHealthImportPlanTests: XCTestCase {
    func testOwnSamplesAreRecognisedBySourceOrSyncIdentifier() {
        XCTAssertTrue(AppleHealthPlan.isOwnSample(sourceBundleId: "com.joyodigitama.joyofit", ownBundleId: "com.joyodigitama.joyofit", syncIdentifier: nil))
        XCTAssertTrue(AppleHealthPlan.isOwnSample(sourceBundleId: "com.other", ownBundleId: "com.joyodigitama.joyofit", syncIdentifier: "joyofit:steps:100"))
        XCTAssertFalse(AppleHealthPlan.isOwnSample(sourceBundleId: "com.huawei.iossporthealth", ownBundleId: "com.joyodigitama.joyofit", syncIdentifier: nil))
        XCTAssertFalse(AppleHealthPlan.isOwnSample(sourceBundleId: nil, ownBundleId: nil, syncIdentifier: "other:steps:1"))
    }

    func testMinutesSumStepsAverageHeartRateAndKeepLastRestingAndSpo2() {
        var minutes = AppleHealthMinutes()
        minutes.steps(atSec: 130, count: 10, fromPhone: false)
        minutes.steps(atSec: 150, count: 5.4, fromPhone: false)
        XCTAssertTrue(minutes.heartRate(atSec: 121, bpm: 60))
        XCTAssertTrue(minutes.heartRate(atSec: 179, bpm: 71))
        XCTAssertFalse(minutes.heartRate(atSec: 125, bpm: 300))
        XCTAssertTrue(minutes.restingHeartRate(atSec: 10, bpm: 55))
        XCTAssertTrue(minutes.spo2(atSec: 10, fraction: 0.974))
        XCTAssertFalse(minutes.spo2(atSec: 10, fraction: 0.2))
        let rows = minutes.rows()
        XCTAssertEqual(rows.map(\.ts), [0, 120])
        XCTAssertEqual(rows[0].restingHeartRate, 55)
        XCTAssertEqual(rows[0].spo2, 97)
        XCTAssertEqual(rows[1].steps, 15)
        XCTAssertEqual(rows[1].heartRate, 66)
    }

    func testPhoneSourcesAreRecognisedByDeviceThenByBundle() {
        XCTAssertTrue(AppleHealthPlan.isPhoneSource(productType: "iPhone15,2", bundleId: "com.apple.health.ABC"))
        XCTAssertFalse(AppleHealthPlan.isPhoneSource(productType: "Watch6,1", bundleId: "com.apple.health.ABC"))
        XCTAssertFalse(AppleHealthPlan.isPhoneSource(productType: nil, bundleId: "com.huawei.iossporthealth"))
        XCTAssertTrue(AppleHealthPlan.isPhoneSource(productType: nil, bundleId: "com.apple.health.ABC"))
        XCTAssertFalse(AppleHealthPlan.isPhoneSource(productType: "", bundleId: nil))
    }

    func testAMinuteTakesOneSourceTheNonPhoneOneWinningAndThePhoneFallingBack() {
        var minutes = AppleHealthMinutes()
        // Minute 0: iPhone and Huawei both count steps; only Huawei's, summed within the source, counts.
        minutes.steps(atSec: 5, count: 30, fromPhone: true)
        minutes.steps(atSec: 10, count: 12, fromPhone: false)
        minutes.steps(atSec: 40, count: 8, fromPhone: false)
        // Minute 60: only the iPhone has it, so the iPhone is the fallback.
        minutes.steps(atSec: 65, count: 25, fromPhone: true)
        let rows = minutes.rows()
        XCTAssertEqual(rows.map(\.ts), [0, 60])
        XCTAssertEqual(rows[0].steps, 20)
        XCTAssertEqual(rows[1].steps, 25)
    }

    func testPreferredSumNeverAddsTheTiers() {
        var energy = PreferredSum()
        energy.add(100, fromPhone: true)
        XCTAssertEqual(energy.value, 100)
        energy.add(40, fromPhone: false)
        energy.add(2, fromPhone: false)
        XCTAssertEqual(energy.value, 42)
    }

    func testSleepValuesMapToStagesAndInBedIsSkipped() {
        XCTAssertNil(AppleHealthPlan.sleepSegment(startSec: 0, endSec: 60, healthKitValue: 0))
        XCTAssertEqual(AppleHealthPlan.sleepSegment(startSec: 0, endSec: 60, healthKitValue: 3)?.stage, "light")
        XCTAssertEqual(AppleHealthPlan.sleepSegment(startSec: 0, endSec: 60, healthKitValue: 4)?.stage, "deep")
        XCTAssertEqual(AppleHealthPlan.sleepSegment(startSec: 0, endSec: 60, healthKitValue: 5)?.stage, "rem")
        XCTAssertEqual(AppleHealthPlan.sleepSegment(startSec: 0, endSec: 60, healthKitValue: 2)?.stage, "awake")
        XCTAssertNil(AppleHealthPlan.sleepSegment(startSec: 60, endSec: 60, healthKitValue: 4))
    }

    func testWindowsCoverTheHistoryWithoutGaps() {
        let w = AppleHealthPlan.windows(fromSec: 0, toSec: AppleHealthPlan.windowSec * 2 + 5)
        XCTAssertEqual(w.count, 3)
        XCTAssertEqual(w.first?.from, 0)
        XCTAssertEqual(w.last?.to, AppleHealthPlan.windowSec * 2 + 5)
        for i in 1..<w.count { XCTAssertEqual(w[i - 1].to, w[i].from) }
        XCTAssertEqual(AppleHealthPlan.windows(fromSec: 10, toSec: 10).count, 1)
    }

    func testSportsMapToJoyoFitTypes() {
        XCTAssertEqual(AppleHealthSports.sportType(key: "running"), 1)
        XCTAssertEqual(AppleHealthSports.sportType(key: "unknown"), AppleHealthSports.other)
        XCTAssertEqual(AppleHealthSports.name(AppleHealthSports.other), "Workout")
    }

    func testImportedRowsAreMarkedAndASecondImportAddsNothing() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let target = SqliteHuaweiImportStore(store)
        var minutes = AppleHealthMinutes()
        minutes.steps(atSec: 600, count: 20, fromPhone: false)
        minutes.heartRate(atSec: 600, bpm: 70)
        XCTAssertEqual(try target.writeMinutes(minutes.rows()), 1)
        XCTAssertEqual(try target.writeMinutes(minutes.rows()), 0)
        let imported: [Int] = try store.read { db in try db.query("SELECT imported FROM step_samples") { Int($0.int(0)) } }
        XCTAssertEqual(imported, [1])
    }
}

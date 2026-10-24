import XCTest
@testable import HuaweiProtocol

/// Same cases as `eveningDoze.test.ts`: a short session starting after 19:00 joins the session that follows within 8 h.
final class EveningDozeTests: XCTestCase {
    private let MIN: Int64 = 60
    private let zone = TimeZone(secondsFromGMT: 7 * 3600)!

    /// Unix seconds of `HH:MM` on 2026-10-`day`, UTC+7 (the zone passed to `lastNight`).
    private func at(_ day: Int, _ clock: String) -> Int64 {
        let parts = clock.split(separator: ":").map { Int($0)! }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let date = calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: parts[0], minute: parts[1]))!
        return Int64(date.timeIntervalSince1970)
    }

    private func seg(_ day: Int, _ from: String, _ toDay: Int, _ to: String, breakBefore: Bool = false, afterWorkout: Bool = false) -> SleepSegment {
        SleepSegment(start: at(day, from), end: at(toDay, to), type: 6, stage: nil, breakBefore: breakBefore, afterWorkout: afterWorkout)
    }

    func testSalimsDozeBeforeTheNightIsPartOfTheNight() {
        let night = SleepReport.lastNight([seg(23, "21:55", 23, "22:42"), seg(24, "02:00", 24, "05:13")], zone: zone)
        XCTAssertEqual(night?.start, at(23, "21:55"))
        XCTAssertEqual(night?.end, at(24, "05:13"))
        XCTAssertEqual(night?.totalSec, 47 * MIN + 193 * MIN)
        XCTAssertGreaterThanOrEqual(night?.totalSec ?? 0, SleepReport.minNightSec)
    }

    func testAnAfternoonNapStaysItsOwnSession() {
        let last = SleepReport.lastNight([seg(23, "14:00", 23, "15:00"), seg(24, "02:00", 24, "05:13")], zone: zone)
        XCTAssertEqual(last?.start, at(24, "02:00"))
        let nap = SleepReport.lastNight([seg(23, "14:00", 23, "15:00")], zone: zone)
        XCTAssertEqual(nap?.start, at(23, "14:00"))
        XCTAssertLessThan(nap?.totalSec ?? .max, SleepReport.minNightSec)
    }

    func testADozeWithNothingWithinEightHoursAfterItStaysANap() {
        let last = SleepReport.lastNight([seg(23, "21:55", 23, "22:42"), seg(24, "06:43", 24, "10:00")], zone: zone)
        XCTAssertEqual(last?.start, at(24, "06:43"))
        let alone = SleepReport.lastNight([seg(23, "21:55", 23, "22:42")], zone: zone)
        XCTAssertEqual(alone?.start, at(23, "21:55"))
        XCTAssertLessThan(alone?.totalSec ?? .max, SleepReport.minNightSec)
    }

    func testAWorkoutBetweenDozeAndNightKeepsThemApart() {
        let last = SleepReport.lastNight([seg(23, "21:55", 23, "22:42"), seg(24, "02:00", 24, "05:13", breakBefore: true, afterWorkout: true)], zone: zone)
        XCTAssertEqual(last?.start, at(24, "02:00"))
    }

    func testTheGapMarkOfTheCleaningStepDoesNotKeepThemApart() {
        let cleaned = SleepCleaning.cleanUnstagedSleep([seg(23, "21:55", 23, "22:42"), seg(24, "02:00", 24, "05:13")], .none)
        XCTAssertTrue(cleaned[1].breakBefore)
        XCTAssertFalse(cleaned[1].afterWorkout)
        XCTAssertEqual(SleepReport.lastNight(cleaned, zone: zone)?.start, at(23, "21:55"))
    }
}

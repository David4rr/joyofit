import XCTest
@testable import HuaweiProtocol

/// `SleepCleaning` against the fixtures of src/features/sleep/cleanSleep.test.ts, value for value: the stage-less ranges a Huawei Watch Fit 2
/// stored for Salim's 16 to 18 Oct 2026, as his phone's Sleep screen printed them (Western Indonesia Time, UTC+7).
final class SleepCleaningTests: XCTestCase {
    private let H: Int64 = 3600
    private let MIN: Int64 = 60

    /// Unix seconds of `HH:MM[:SS]` on 2026-10-`day`, UTC+7.
    private func wib(_ day: Int, _ clock: String) -> Int64 {
        let parts = clock.split(separator: ":").map { Int64($0)! }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let midnight = calendar.date(from: DateComponents(year: 2026, month: 10, day: day))!.timeIntervalSince1970
        return Int64(midnight) + (parts[0] - 7) * 3600 + parts[1] * 60 + (parts.count > 2 ? parts[2] : 0)
    }

    /// `TruSleep` state ranges as `SleepSync.segmentsFromState` stores them: raw kind 6, no stage.
    private func state(_ start: Int64, _ end: Int64) -> SleepSegment { SleepSegment(start: start, end: end, type: 6, stage: nil) }

    private func broken(_ s: SleepSegment, afterWorkout: Bool = false) -> SleepSegment {
        SleepSegment(start: s.start, end: s.end, type: s.type, stage: s.stage, breakBefore: true, afterWorkout: afterWorkout)
    }

    private func ranges(_ rows: [(Int, String, Int64)]) -> [SleepSegment] {
        rows.map { day, clock, minutes in
            let start = wib(day, clock)
            return state(start, start + minutes * MIN)
        }
    }

    private func minutes(_ start: Int64, _ end: Int64) -> [Int64] { Array(stride(from: start, to: end, by: 60)) }

    private func total(_ segments: [SleepSegment]) -> Int64 { segments.reduce(0) { $0 + $1.end - $1.start } }

    private lazy var hrvNap = ranges([(16, "18:50", 1), (16, "19:17", 2), (16, "19:22", 1), (16, "20:21", 3)])

    private lazy var morningFragments = ranges([
        (17, "06:06", 5), (17, "06:12", 3), (17, "06:16", 3), (17, "06:20", 4), (17, "06:37", 33), (17, "07:16", 1), (17, "07:20", 2),
        (17, "07:24", 4), (17, "07:34", 3), (17, "07:40", 4), (17, "07:45", 16), (17, "08:02", 1), (17, "08:08", 3), (17, "08:12", 1),
        (17, "08:15", 2), (17, "08:26", 19), (17, "08:55", 4), (17, "09:03", 2),
    ])

    private lazy var nightWithRun = ranges([
        (17, "22:41", 7), (18, "00:00", 239), (18, "04:03", 5), (18, "04:12", 1), (18, "04:16", 3), (18, "04:21", 1), (18, "04:31", 2),
        (18, "04:34", 32), (18, "05:07", 2), (18, "05:12", 2), (18, "05:19", 1), (18, "05:22", 3), (18, "05:26", 5), (18, "05:34", 1),
        (18, "05:37", 1), (18, "05:39", 2), (18, "05:45", 5), (18, "06:03", 1), (18, "06:05", 2), (18, "06:19", 5), (18, "06:27", 2),
        (18, "06:32", 2), (18, "06:37", 1),
    ])

    private func run() -> SleepSpan { SleepCleaning.workoutSpan(start: wib(18, "04:34:05"), end: wib(18, "05:06:40"), duration: 31 * MIN) }

    func testTheFixturesAreTheScreenshots() {
        XCTAssertEqual(total(nightWithRun), 5 * H + 25 * MIN)
        XCTAssertEqual(total(morningFragments), H + 50 * MIN)
        XCTAssertEqual(total(hrvNap), 7 * MIN)
    }

    func testTheHrvNapOf16OctIsNotSleepAtAll() {
        let cleaned = SleepCleaning.cleanUnstagedSleep(hrvNap, .none)
        XCTAssertEqual(cleaned, [])
        XCTAssertNil(SleepReport.lastNight(cleaned))
    }

    func testTheMorningOf17OctKeepsTheBlockOf33MinutesAndOneChainOfPieces() {
        let cleaned = SleepCleaning.cleanUnstagedSleep(morningFragments, .none)
        XCTAssertEqual(cleaned, [morningFragments[4], morningFragments[9], morningFragments[10], morningFragments[11]])
    }

    func testWithTheWorkoutThatBlockWasTheRestIsA21MinuteNap() {
        let workout = SleepCleaning.workoutSpan(start: wib(17, "06:37"), end: wib(17, "07:10"), duration: 33 * MIN)
        let cleaned = SleepCleaning.cleanUnstagedSleep(morningFragments, SleepEvidence(workouts: [workout]))
        XCTAssertEqual(cleaned, [morningFragments[9], morningFragments[10], morningFragments[11]])
        XCTAssertEqual(SleepReport.lastNight(cleaned)?.totalSec, 21 * MIN)
    }

    func testASpotHrvMeasurementInTheMiddleOfA25MinuteRangeSplitsItIntoTwoTooShortPieces() {
        let start = wib(16, "15:00")
        let range = state(start, start + 25 * MIN)
        let spot = SleepSpan(start: start + 12 * MIN, end: start + 13 * MIN)
        XCTAssertEqual(SleepCleaning.cleanUnstagedSleep([range], .none), [range])
        XCTAssertEqual(SleepCleaning.cleanUnstagedSleep([range], SleepEvidence(spots: [spot])), [])
    }

    func testWithTheRunStoredTheNightIs0000To0359() {
        let cleaned = SleepCleaning.cleanUnstagedSleep(nightWithRun, SleepEvidence(workouts: [run()]))
        XCTAssertEqual(cleaned, [state(wib(18, "00:00"), wib(18, "03:59"))])
        let night = SleepReport.lastNight(cleaned)
        XCTAssertEqual(night?.start, wib(18, "00:00"))
        XCTAssertEqual(night?.end, wib(18, "03:59"))
        XCTAssertEqual(night?.totalSec, 239 * MIN)
    }

    func testWithOnlyTheStepsOfTheRunTheResultIsTheSame() {
        let evidence = SleepEvidence(activeMinutes: minutes(wib(18, "04:34"), wib(18, "05:06")))
        XCTAssertEqual(SleepCleaning.cleanUnstagedSleep(nightWithRun, evidence), [state(wib(18, "00:00"), wib(18, "03:59"))])
    }

    func testSleepOnBothSidesOfAWorkoutIsTwoSessionsEachWithItsOwnTotals() {
        let before = state(wib(18, "23:00"), wib(19, "04:30"))
        let after = state(wib(19, "05:30"), wib(19, "08:00"))
        let workout = SleepCleaning.workoutSpan(start: wib(19, "04:40"), end: wib(19, "05:20"), duration: 40 * MIN)
        let cleaned = SleepCleaning.cleanUnstagedSleep([before, after], SleepEvidence(workouts: [workout]))
        XCTAssertEqual(cleaned, [before, broken(after, afterWorkout: true)])
        // Last night: only what follows the workout.
        XCTAssertEqual(SleepReport.lastNight(cleaned)?.totalSec, 150 * MIN)
        XCTAssertEqual(SleepReport.lastNight(cleaned)?.start, after.start)
        // Without the break the 1 hour between them would join the two into one night.
        XCTAssertEqual(SleepReport.lastNight([before, after])?.totalSec, 330 * MIN + 150 * MIN)
    }

    func testAWorkoutInsideOneRangeCutsItAndTheSecondPieceStartsANewSession() {
        let range = state(wib(18, "00:00"), wib(18, "07:00"))
        let workout = SleepCleaning.workoutSpan(start: wib(18, "04:34"), end: wib(18, "05:06"), duration: 32 * MIN)
        let cleaned = SleepCleaning.cleanUnstagedSleep([range], SleepEvidence(workouts: [workout]))
        XCTAssertEqual(cleaned, [state(wib(18, "00:00"), wib(18, "04:34")), broken(state(wib(18, "05:06"), wib(18, "07:00")), afterWorkout: true)])
    }

    func testANapNeedsTwentyMinutesOfContinuousSleep() {
        let at = wib(16, "14:00")
        XCTAssertEqual(SleepCleaning.cleanUnstagedSleep([state(at, at + SleepCleaning.minRunSec - MIN)], .none), [])
        XCTAssertEqual(SleepCleaning.cleanUnstagedSleep([state(at, at + SleepCleaning.minRunSec)], .none).count, 1)
    }

    func testFragmentsAddUpToARunOnlyWhenTheGapsAreShort() {
        let at = wib(16, "14:00")
        let close = [state(at, at + 10 * MIN), state(at + 11 * MIN, at + 22 * MIN)]
        let far = [state(at, at + 10 * MIN), state(at + 15 * MIN, at + 26 * MIN)]
        XCTAssertEqual(SleepCleaning.cleanUnstagedSleep(close, .none).count, 2)
        XCTAssertEqual(SleepCleaning.cleanUnstagedSleep(far, .none), [])
    }

    func testAMinuteOfStepsInsideANightDoesNotSplitIt() {
        let range = state(wib(18, "23:00"), wib(19, "06:00"))
        let trip = wib(19, "02:10")
        let cleaned = SleepCleaning.cleanUnstagedSleep([range], SleepEvidence(activeMinutes: [trip]))
        XCTAssertEqual(cleaned, [state(range.start, trip), state(trip + MIN, range.end)])
        XCTAssertEqual(SleepReport.lastNight(cleaned)?.totalSec, 7 * H - MIN)
        XCTAssertEqual(SleepReport.lastNight(cleaned)?.start, range.start)
    }

    func testHalfAnHourOfWalkingInsideARangeEndsTheNightThereWithoutAWorkoutBreak() {
        let range = state(wib(18, "23:00"), wib(19, "06:00"))
        let evidence = SleepEvidence(activeMinutes: minutes(wib(19, "02:00"), wib(19, "02:30")))
        let cleaned = SleepCleaning.cleanUnstagedSleep([range], evidence)
        XCTAssertEqual(cleaned, [state(range.start, wib(19, "02:00")), state(wib(19, "02:30"), range.end)])
    }

    func testMoreThanAnHourWithNothingRecordedBetweenTwoStageLessRunsIsTwoSessions() {
        let a = state(wib(18, "23:00"), wib(19, "02:00"))
        let b = state(wib(19, "03:30"), wib(19, "06:00"))
        let cleaned = SleepCleaning.cleanUnstagedSleep([a, b], .none)
        XCTAssertEqual(cleaned, [a, broken(b)])
        XCTAssertEqual(SleepReport.lastNight(cleaned)?.totalSec, 150 * MIN)
    }

    func testHalfAnHourWithNothingRecordedIsStillOneSession() {
        let a = state(wib(18, "23:00"), wib(19, "02:00"))
        let b = state(wib(19, "02:30"), wib(19, "06:00"))
        let cleaned = SleepCleaning.cleanUnstagedSleep([a, b], .none)
        XCTAssertEqual(cleaned, [a, b])
        XCTAssertEqual(SleepReport.lastNight(cleaned)?.totalSec, 6 * H + 30 * MIN)
    }

    func testTwoOverlappingStageLessRangesOfOneNightCountOnce() {
        let a = state(wib(18, "23:00"), wib(19, "05:00"))
        let b = SleepSegment(start: wib(19, "01:00"), end: wib(19, "06:00"), type: 1, stage: nil)
        XCTAssertEqual(total(SleepCleaning.cleanUnstagedSleep([a, b], .none)), 7 * H)
    }

    // MARK: watches with stages

    private func stagedNight() -> [SleepSegment] {
        [
            SleepSegment(start: wib(18, "23:00"), end: wib(19, "02:00"), type: 6, stage: "light"),
            SleepSegment(start: wib(19, "02:00"), end: wib(19, "04:00"), type: 7, stage: "deep"),
            SleepSegment(start: wib(19, "04:00"), end: wib(19, "04:03"), type: 0x5658, stage: "awake"),
            SleepSegment(start: wib(19, "04:03"), end: wib(19, "06:30"), type: 0x5656, stage: "rem"),
        ]
    }

    func testStagedSegmentsComeBackAsStoredWithEveryKindOfEvidenceOverThem() {
        let night = stagedNight()
        let evidence = SleepEvidence(
            workouts: [SleepCleaning.workoutSpan(start: wib(19, "03:00"), end: wib(19, "03:40"), duration: 40 * MIN)],
            spots: [SleepSpan(start: wib(19, "01:00"), end: wib(19, "01:01"))],
            activeMinutes: minutes(wib(19, "04:10"), wib(19, "04:40"))
        )
        XCTAssertEqual(SleepCleaning.cleanUnstagedSleep(night, evidence), night)
    }

    func testAShortStagedNapIsLeftToTheFiveMinuteBlipRule() {
        let nap = SleepSegment(start: wib(19, "14:00"), end: wib(19, "14:12"), type: 6, stage: "light")
        XCTAssertEqual(SleepCleaning.cleanUnstagedSleep([nap], .none), [nap])
    }

    func testStageLessFragmentsNextToAStagedNightAreStillDroppedByTheStrayRuleAfterwards() {
        let stray = state(wib(19, "06:35"), wib(19, "07:10"))
        let cleaned = SleepCleaning.cleanUnstagedSleep(stagedNight() + [stray], .none)
        XCTAssertEqual(SleepReport.lastNight(cleaned)?.end, wib(19, "06:30"))
    }

    func testBreakBeforeSurvivesTheStrayAndBlipRules() {
        let a = state(wib(18, "23:00"), wib(19, "02:00"))
        let b = state(wib(19, "03:30"), wib(19, "06:00"))
        let cleaned = SleepCleaning.cleanUnstagedSleep([a, b], .none)
        let kept = SleepReport.withoutBlips(SleepReport.withoutStrayUnstaged(cleaned))
        XCTAssertEqual(kept.map(\.breakBefore), [false, true])
    }

    func testSegmentsAreReturnedSortedByStartAndDoNotCarryABreakWhenNothingSeparatesThem() {
        let a = state(wib(18, "23:00"), wib(19, "02:00"))
        let b = state(wib(19, "02:00"), wib(19, "06:00"))
        XCTAssertEqual(SleepCleaning.cleanUnstagedSleep([b, a], .none), [a, b])
    }

    func testAWorkoutBeforeAStagedSegmentNeverMarksIt() {
        let staged = SleepSegment(start: wib(19, "05:30"), end: wib(19, "08:00"), type: 6, stage: "light")
        let before = state(wib(18, "23:00"), wib(19, "04:30"))
        let workout = SleepCleaning.workoutSpan(start: wib(19, "04:40"), end: wib(19, "05:20"), duration: 40 * MIN)
        XCTAssertEqual(SleepCleaning.cleanUnstagedSleep([before, staged], SleepEvidence(workouts: [workout])), [before, staged])
    }
}

// Port of SleepCleaning.kt and cleanSleep.ts (src/features/sleep): what is and is not sleep among the stage-less ranges of a watch without sleep
// stages (Huawei Watch Fit 2: only `sleep_state.bin`).
//
// Those ranges are the watch's sensor windows, not a verdict of "asleep" (see `SleepSync.segmentsFromState`). A 1-minute HRV or stress check,
// and a workout started on the watch, both open such windows, so they were counted as sleep: a "nap" of 7 minutes made of fragments, a night
// that included a morning run. The rule only touches stage-less segments; a segment with a stage came from the watch's own sleep analysis and
// is returned as stored. Keep the three ports and their constants together.
//
//  1. Awake evidence is subtracted from the stage-less ranges: a stored workout, a stored spot HRV measurement (you sat still on purpose),
//     and every minute with `activeStepsPerMin` steps or more.
//  2. What is left is chained into runs (pieces at most `runBridgeSec` apart). A run holding less than `minRunSec` of sleep is dropped: that
//     covers the 1 to 5 minute fragments, a stress check, and a nap too short to tell from one.
//  3. A kept segment that follows a workout, or that follows another stage-less segment after more than `unstagedBreakSec` of nothing, is
//     marked `breakBefore`, so every session builder starts a new session there and works out the totals for each side.
import Foundation

/// A span of unix seconds.
public struct SleepSpan: Equatable, Sendable {
    public var start: Int64
    public var end: Int64

    public init(start: Int64, end: Int64) {
        self.start = start
        self.end = end
    }
}

/// What says the wearer was awake while the watch recorded a stage-less range. All times are unix seconds.
public struct SleepEvidence: Equatable, Sendable {
    /// Stored workouts (any source).
    public var workouts: [SleepSpan]
    /// Stored spot HRV measurements (`hrv_readings.source = 'spot'`).
    public var spots: [SleepSpan]
    /// Start of every minute with at least `SleepCleaning.activeStepsPerMin` steps, in any order.
    public var activeMinutes: [Int64]

    public init(workouts: [SleepSpan] = [], spots: [SleepSpan] = [], activeMinutes: [Int64] = []) {
        self.workouts = workouts
        self.spots = spots
        self.activeMinutes = activeMinutes
    }

    public static let none = SleepEvidence()
}

public enum SleepCleaning {
    /// Bumped whenever the rule or its constants change: the stored derived data (the Health export) is repaired once per version.
    public static let rulesVersion = 2

    /// A stage-less run needs this much sleep (gaps up to `runBridgeSec` inside it are not counted) to be sleep.
    public static let minRunSec: Int64 = 20 * 60
    /// Stage-less pieces this close belong to one run: a minute of steps or a short state gap does not end a night.
    public static let runBridgeSec: Int64 = 2 * 60
    /// A minute with this many steps is awake. Sleep, even a restless one, does not walk.
    public static let activeStepsPerMin = 15
    /// Room left around a spot HRV measurement; the stored span is the 1-minute reading itself.
    public static let spotMarginSec: Int64 = 60
    /// Two stage-less segments further apart than this are two sessions: nobody sleeps through an hour of nothing recorded.
    public static let unstagedBreakSec: Int64 = 60 * 60

    /// A workout's span; a row without a usable end falls back to its active duration.
    public static func workoutSpan(start: Int64, end: Int64, duration: Int64) -> SleepSpan {
        SleepSpan(start: start, end: end > start ? end : start + max(0, duration))
    }

    private static func mergeSpans(_ spans: [SleepSpan]) -> [SleepSpan] {
        var out = [SleepSpan]()
        for s in spans.filter({ $0.end > $0.start }).sorted(by: { ($0.start, $0.end) < ($1.start, $1.end) }) {
            if let last = out.last, s.start <= last.end {
                out[out.count - 1].end = max(last.end, s.end)
            } else {
                out.append(s)
            }
        }
        return out
    }

    /// `piece` minus the sorted, disjoint `awake` spans. `from` is the first span that can still overlap (spans are visited in order).
    private static func subtract(_ piece: SleepSpan, _ awake: [SleepSpan], from: Int) -> [SleepSpan] {
        var out = [SleepSpan]()
        var at = piece.start
        var i = from
        while i < awake.count && awake[i].start < piece.end {
            if awake[i].end > at {
                if awake[i].start > at { out.append(SleepSpan(start: at, end: awake[i].start)) }
                at = max(at, awake[i].end)
                if at >= piece.end { break }
            }
            i += 1
        }
        if at < piece.end { out.append(SleepSpan(start: at, end: piece.end)) }
        return out
    }

    /// Index of the first of the sorted, disjoint `spans` that ends after `time`.
    private static func firstEndingAfter(_ spans: [SleepSpan], _ time: Int64) -> Int {
        var lo = 0
        var hi = spans.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if spans[mid].end > time { hi = mid } else { lo = mid + 1 }
        }
        return lo
    }

    /// Sorted by start, then end; equal keys keep their order.
    private static func sortedByStart(_ segments: [SleepSegment]) -> [SleepSegment] {
        segments.enumerated().sorted { a, b in
            if a.element.start != b.element.start { return a.element.start < b.element.start }
            if a.element.end != b.element.end { return a.element.end < b.element.end }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// Applies the rule above and returns every segment, staged ones untouched, sorted by start. Stage-less segments come back clipped to what
    /// is left of them (a copy, same `type`), without overlaps among themselves.
    public static func cleanUnstagedSleep(_ segments: [SleepSegment], _ evidence: SleepEvidence) -> [SleepSegment] {
        var staged = [SleepSegment]()
        var unstaged = [SleepSegment]()
        for s in segments {
            if s.stage != nil { staged.append(s) } else if s.end > s.start { unstaged.append(s) }
        }
        if unstaged.isEmpty { return sortedByStart(segments) }

        let awake = mergeSpans(
            evidence.workouts
                + evidence.spots.map { SleepSpan(start: $0.start - spotMarginSec, end: $0.end + spotMarginSec) }
                + evidence.activeMinutes.map { SleepSpan(start: $0, end: $0 + 60) }
        )

        // Stage-less ranges overlap each other (two raw types for one night); an earlier-starting one keeps the time.
        var pieces = [SleepSegment]()
        var cursor = Int64.min
        for seg in sortedByStart(unstaged) {
            let start = max(seg.start, cursor)
            if start >= seg.end { continue }
            cursor = seg.end
            for span in subtract(SleepSpan(start: start, end: seg.end), awake, from: firstEndingAfter(awake, start)) {
                pieces.append(SleepSegment(start: span.start, end: span.end, type: seg.type, stage: nil))
            }
        }

        // Runs: pieces chained with gaps up to runBridgeSec; short ones are not sleep.
        var kept = staged
        var run = [SleepSegment]()
        var runSec: Int64 = 0
        var reach = Int64.min
        func closeRun() {
            if runSec >= minRunSec { kept.append(contentsOf: run) }
            run.removeAll()
            runSec = 0
        }
        for piece in pieces {
            if !run.isEmpty && piece.start - reach > runBridgeSec { closeRun() }
            run.append(piece)
            runSec += piece.end - piece.start
            reach = piece.end
        }
        closeRun()
        kept = sortedByStart(kept)

        // Where a workout or a long stretch of nothing separates stage-less sleep from what came before, a new session starts.
        let workouts = mergeSpans(evidence.workouts)
        if kept.count > 1 {
            for i in 1..<kept.count {
                let seg = kept[i]
                if seg.stage != nil { continue }
                let prev = kept[i - 1]
                if seg.start < prev.end { continue }
                let nextIndex = firstEndingAfter(workouts, prev.end)
                let workoutBetween = nextIndex < workouts.count && workouts[nextIndex].start < seg.start
                if workoutBetween || (prev.stage == nil && seg.start - prev.end > unstagedBreakSec) {
                    kept[i] = SleepSegment(start: seg.start, end: seg.end, type: seg.type, stage: nil, breakBefore: true)
                }
            }
        }
        return kept
    }
}

// Port of HrvMath.kt: time-domain HRV from beat-to-beat (RR) intervals, after the Task Force of the ESC and NASPE (1996): RMSSD (root mean
// square of successive differences) and SDNN (standard deviation of the intervals). Artifacts are dropped first: an interval outside
// 300..2000 ms (200..30 bpm), one the watch marked as unusable (`sqi` 0), or one more than 20 % away from the median of its neighbours (a
// missed or doubled beat). A successive difference only counts when both of its intervals survived.
import Foundation

public enum HrvMath {
    public static let minRrMs = 300
    public static let maxRrMs = 2000
    private static let neighbourTolerance = 0.20
    private static let window = 5

    /// Fewer clean intervals than this give no reading (about 40 s at rest).
    public static let minBeats = 40

    public struct Result: Equatable, Sendable {
        public let rmssd: Double
        public let sdnn: Double
        public let meanRr: Double
        public let beats: Int
    }

    /// `rr` in milliseconds, in order; `sqi` the watch's quality per interval or nil when it gave none.
    public static func compute(rr: [Int], sqi: [Int]? = nil) -> Result? {
        var keep = (0..<rr.count).map { i -> Bool in
            let inRange = rr[i] >= minRrMs && rr[i] <= maxRrMs
            // Kotlin `sqi.getOrNull(i) != 0`: an interval without a quality value is kept.
            return inRange && (sqi == nil || i >= sqi!.count || sqi![i] != 0)
        }
        for i in 0..<rr.count where keep[i] {
            let lower = max(0, i - window)
            let upper = min(rr.count - 1, i + window)
            let neighbours = (lower...upper).filter { $0 != i && rr[$0] >= minRrMs && rr[$0] <= maxRrMs }.map { rr[$0] }.sorted()
            if neighbours.count >= 3 {
                let median = Double(neighbours[neighbours.count / 2])
                if abs(Double(rr[i]) - median) > neighbourTolerance * median { keep[i] = false }
            }
        }
        let clean = (0..<rr.count).filter { keep[$0] }
        if clean.count < minBeats { return nil }
        var sumSq = 0.0
        var diffs = 0
        for k in 1..<clean.count {
            let a = clean[k - 1]
            let b = clean[k]
            if b != a + 1 { continue }
            let d = Double(rr[b] - rr[a])
            sumSq += d * d
            diffs += 1
        }
        if diffs < minBeats / 2 { return nil }
        let values = clean.map { Double(rr[$0]) }
        var total = 0.0
        for v in values { total += v }
        let mean = total / Double(values.count)
        var squares = 0.0
        for v in values { squares += (v - mean) * (v - mean) }
        let sdnn = (squares / Double(values.count - 1)).squareRoot()
        return Result(rmssd: (sumSq / Double(diffs)).squareRoot(), sdnn: sdnn, meanRr: mean, beats: clean.count)
    }
}

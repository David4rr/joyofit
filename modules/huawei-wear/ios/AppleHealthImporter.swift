// The one-time import of the history Huawei Health (or any other app) wrote into Apple Health (`importAppleHealthHistory`,
// `cancelHuaweiImport` in HuaweiWearModule.ts); progress goes out as `onHuaweiImportProgress`, the same event and shapes as the Huawei export
// import, so one UI shows both. This is the only place JoyoFit READS HealthKit: read permission for steps, heart rate, resting heart rate, oxygen
// saturation, sleep analysis, workouts and active energy is requested when the user taps the import button, never earlier, and nothing read
// leaves the phone. Rows are written with `imported = 1` through `SqliteHuaweiImportStore` (HuaweiImportStore.swift): watch data wins, nothing
// is overwritten, a second run adds nothing.
//
// Samples whose source is JoyoFit itself are skipped (HealthKitWriter's own writes: same bundle id, or a `joyofit:` sync identifier), so data
// JoyoFit exported does not come back in. The history is read window by window (AppleHealthPlan.windowSec), oldest first.
//
// [INFERENCE] nothing here has run against a real Health store, and it was written on Linux without a Swift toolchain: not compiled.
#if canImport(HealthKit) && (canImport(SQLite3) || canImport(CSQLite))
import Foundation
import HealthKit
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public final class AppleHealthImporter: @unchecked Sendable {
    private let store = HKHealthStore()
    private let syncStore: SyncStore
    private let now: () -> Date
    private let lock = NSLock()
    private var running = false
    private var cancelRequested = false

    public init(syncStore: SyncStore, now: @escaping () -> Date = Date.init) {
        self.syncStore = syncStore
        self.now = now
    }

    public func cancel() { lock.locked { cancelRequested = true } }

    private static var readTypes: Set<HKObjectType> {
        [
            HKQuantityType(.stepCount), HKQuantityType(.heartRate), HKQuantityType(.restingHeartRate), HKQuantityType(.oxygenSaturation),
            HKQuantityType(.activeEnergyBurned), HKCategoryType(.sleepAnalysis), HKObjectType.workoutType(),
        ]
    }

    /// Asks for read permission (the system sheet appears only the first time), then reads everything. `emit` gets the
    /// `HuaweiImportProgressEvent` payloads; the result is the `HuaweiImportSummary`.
    public func run(emit: @escaping @Sendable ([String: Any]) -> Void) async throws -> [String: Any] {
        guard HKHealthStore.isHealthDataAvailable() else { throw WearError(.unsupported, "Apple Health is not available on this device") }
        let started = lock.locked { () -> Bool in
            if running { return false }
            running = true
            cancelRequested = false
            return true
        }
        guard started else { throw WearError(.busy, "An import is already running") }
        defer { lock.locked { running = false } }
        do {
            try await store.requestAuthorization(toShare: [], read: AppleHealthImporter.readTypes)
            return try await read(emit: emit).toJS()
        } catch let e as SQLiteError {
            throw WearError(.storage, "Database error: \(e.message)", underlying: e)
        }
    }

    private var isCancelled: Bool { lock.locked { cancelRequested } }

    // MARK: reading

    private func read(emit: @Sendable ([String: Any]) -> Void) async throws -> HuaweiImportSummary {
        var summary = HuaweiImportSummary()
        let target = SqliteHuaweiImportStore(syncStore)
        let sources = try await allSources()
        let nowSec = Int64(now().timeIntervalSince1970)
        guard let first = try await earliestSec(sources) else {
            emit(progress("done", fraction: 1, summary))
            return summary
        }
        let windows = AppleHealthPlan.windows(fromSec: first, toSec: nowSec + 1)
        let span = Double(max(1, nowSec + 1 - first))
        var lastEmit = Date.distantPast
        for window in windows {
            if isCancelled {
                summary.cancelled = true
                break
            }
            try await importWindow(window.from, window.to, sources, target, &summary)
            if now().timeIntervalSince(lastEmit) >= 0.25 {
                lastEmit = now()
                emit(progress("reading", fraction: Double(window.to - first) / span, summary))
            }
        }
        emit(progress("done", fraction: 1, summary))
        return summary
    }

    private func progress(_ phase: String, fraction: Double, _ summary: HuaweiImportSummary) -> [String: Any] {
        HuaweiImportProgress(phase: phase, fileName: nil, fileIndex: 0, fileCount: 0, fraction: min(1, max(0, fraction)), summary: summary).toJS()
    }

    private func importWindow(
        _ from: Int64, _ to: Int64, _ sources: [HKSampleType: Set<HKSource>], _ target: SqliteHuaweiImportStore, _ summary: inout HuaweiImportSummary
    ) async throws {
        var minutes = AppleHealthMinutes()

        for sample in try await samples(HKQuantityType(.stepCount), from, to, sources) {
            guard let q = sample as? HKQuantitySample else { continue }
            let at = Int64(q.startDate.timeIntervalSince1970)
            minutes.steps(atSec: at, count: q.quantity.doubleValue(for: .count()))
            summary.seen(at)
        }
        let perMinute = HKUnit.count().unitDivided(by: .minute())
        for sample in try await samples(HKQuantityType(.heartRate), from, to, sources) {
            guard let q = sample as? HKQuantitySample else { continue }
            let at = Int64(q.startDate.timeIntervalSince1970)
            if minutes.heartRate(atSec: at, bpm: q.quantity.doubleValue(for: perMinute)) {
                summary.heartRateReadings += 1
                summary.seen(at)
            } else {
                summary.rejectedSamples += 1
            }
        }
        for sample in try await samples(HKQuantityType(.restingHeartRate), from, to, sources) {
            guard let q = sample as? HKQuantitySample else { continue }
            let at = Int64(q.startDate.timeIntervalSince1970)
            if minutes.restingHeartRate(atSec: at, bpm: q.quantity.doubleValue(for: perMinute)) {
                summary.restingHeartRateReadings += 1
                summary.seen(at)
            } else {
                summary.rejectedSamples += 1
            }
        }
        for sample in try await samples(HKQuantityType(.oxygenSaturation), from, to, sources) {
            guard let q = sample as? HKQuantitySample else { continue }
            let at = Int64(q.startDate.timeIntervalSince1970)
            if minutes.spo2(atSec: at, fraction: q.quantity.doubleValue(for: .percent())) {
                summary.spo2Readings += 1
                summary.seen(at)
            } else {
                summary.rejectedSamples += 1
            }
        }
        if !minutes.isEmpty { summary.minutesWritten += try target.writeMinutes(minutes.rows()) }

        var segments = [ImportedSleep]()
        for sample in try await samples(HKCategoryType(.sleepAnalysis), from, to, sources) {
            guard let c = sample as? HKCategorySample,
                  let segment = AppleHealthPlan.sleepSegment(
                      startSec: Int64(c.startDate.timeIntervalSince1970), endSec: Int64(c.endDate.timeIntervalSince1970), healthKitValue: c.value
                  )
            else { continue }
            segments.append(segment)
            summary.seen(segment.start)
            summary.seen(segment.end)
        }
        summary.sleepSegmentsFound += segments.count
        summary.sleepSegmentsAdded += try target.writeSleep(segments)

        for sample in try await samples(HKObjectType.workoutType(), from, to, sources) {
            guard let workout = sample as? HKWorkout else { continue }
            summary.workoutsFound += 1
            let imported = try await importedWorkout(workout, sources)
            summary.seen(imported.start)
            summary.seen(imported.end)
            let written = try target.writeWorkout(imported)
            if written.added { summary.workoutsAdded += 1 }
            summary.workoutPointsAdded += written.points
        }
    }

    private func importedWorkout(_ workout: HKWorkout, _ sources: [HKSampleType: Set<HKSource>]) async throws -> ImportedWorkout {
        let start = Int64(workout.startDate.timeIntervalSince1970)
        let end = Int64(workout.endDate.timeIntervalSince1970)
        let sport = AppleHealthSports.sportType(key: AppleHealthImporter.activityKey(workout.workoutActivityType))
        let perMinute = HKUnit.count().unitDivided(by: .minute())
        let heart = try await statistics(HKQuantityType(.heartRate), [.discreteAverage, .discreteMax], workout, sources)
        let stepStats = try await statistics(HKQuantityType(.stepCount), .cumulativeSum, workout, sources)
        var kcal = workout.totalEnergyBurned?.doubleValue(for: .kilocalorie())
        if kcal == nil {
            kcal = try await statistics(HKQuantityType(.activeEnergyBurned), .cumulativeSum, workout, sources)?.sumQuantity()?.doubleValue(for: .kilocalorie())
        }
        let avg = heart?.averageQuantity()?.doubleValue(for: perMinute).rounded()
        let peak = heart?.maximumQuantity()?.doubleValue(for: perMinute).rounded()
        return ImportedWorkout(
            start: start, end: end, sportType: sport, sportName: AppleHealthSports.name(sport), duration: Int(workout.duration.rounded()),
            distance: Int((workout.totalDistance?.doubleValue(for: .meter()) ?? 0).rounded()), calories: Int((kcal ?? 0).rounded()),
            steps: Int((stepStats?.sumQuantity()?.doubleValue(for: .count()) ?? 0).rounded()),
            avgHr: avg.flatMap { AppleHealthPlan.plausibleHeartRate($0) }, maxHr: peak.flatMap { AppleHealthPlan.plausibleHeartRate($0) },
            summaryJson: "{\"source\":\"apple-health\"}", points: []
        )
    }

    /// The `HKWorkoutActivityType` case names `AppleHealthSports.sportType` knows.
    static func activityKey(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "running"
        case .walking: return "walking"
        case .cycling: return "cycling"
        case .hiking: return "hiking"
        case .swimming: return "swimming"
        case .elliptical: return "elliptical"
        case .rowing: return "rowing"
        case .stairClimbing: return "stairClimbing"
        case .yoga: return "yoga"
        case .pilates: return "pilates"
        case .functionalStrengthTraining: return "functionalStrengthTraining"
        case .traditionalStrengthTraining: return "traditionalStrengthTraining"
        case .highIntensityIntervalTraining: return "highIntensityIntervalTraining"
        case .crossTraining: return "crossTraining"
        case .boxing: return "boxing"
        case .tennis: return "tennis"
        case .badminton: return "badminton"
        case .soccer: return "soccer"
        case .basketball: return "basketball"
        case .volleyball: return "volleyball"
        case .tableTennis: return "tableTennis"
        default: return "other"
        }
    }

    // MARK: HealthKit queries

    private func sampleTypes() -> [HKSampleType] {
        [
            HKQuantityType(.stepCount), HKQuantityType(.heartRate), HKQuantityType(.restingHeartRate), HKQuantityType(.oxygenSaturation),
            HKQuantityType(.activeEnergyBurned), HKCategoryType(.sleepAnalysis), HKObjectType.workoutType(),
        ]
    }

    /// Every app or device that wrote each type, JoyoFit itself left out. A type nobody else wrote has an empty set and is skipped.
    private func allSources() async throws -> [HKSampleType: Set<HKSource>] {
        let own = Bundle.main.bundleIdentifier
        var result = [HKSampleType: Set<HKSource>]()
        for type in sampleTypes() {
            let found: Set<HKSource> = try await withCheckedThrowingContinuation { continuation in
                let query = HKSourceQuery(sampleType: type, samplePredicate: nil) { _, sources, error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: sources ?? []) }
                }
                store.execute(query)
            }
            result[type] = found.filter { !AppleHealthPlan.isOwnSample(sourceBundleId: $0.bundleIdentifier, ownBundleId: own, syncIdentifier: nil) }
        }
        return result
    }

    private func sourcePredicate(_ sources: Set<HKSource>) -> NSPredicate { HKQuery.predicateForObjects(from: sources) }

    private func earliestSec(_ sources: [HKSampleType: Set<HKSource>]) async throws -> Int64? {
        var earliest: Int64?
        for type in sampleTypes() {
            guard let from = sources[type], !from.isEmpty else { continue }
            let found: [HKSample] = try await withCheckedThrowingContinuation { continuation in
                let query = HKSampleQuery(
                    sampleType: type, predicate: sourcePredicate(from), limit: 1,
                    sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
                ) { _, result, error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: result ?? []) }
                }
                store.execute(query)
            }
            if let sample = found.first {
                let sec = Int64(sample.startDate.timeIntervalSince1970)
                if earliest.map({ sec < $0 }) ?? true { earliest = sec }
            }
        }
        return earliest
    }

    /// Samples that start in `[from, to)`, written by someone other than JoyoFit.
    private func samples(_ type: HKSampleType, _ from: Int64, _ to: Int64, _ sources: [HKSampleType: Set<HKSource>]) async throws -> [HKSample] {
        guard let allowed = sources[type], !allowed.isEmpty else { return [] }
        let window = HKQuery.predicateForSamples(
            withStart: Date(timeIntervalSince1970: TimeInterval(from)), end: Date(timeIntervalSince1970: TimeInterval(to)), options: .strictStartDate
        )
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [window, sourcePredicate(allowed)])
        let own = Bundle.main.bundleIdentifier
        let found: [HKSample] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, result, error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: result ?? []) }
            }
            store.execute(query)
        }
        return found.filter {
            !AppleHealthPlan.isOwnSample(
                sourceBundleId: $0.sourceRevision.source.bundleIdentifier, ownBundleId: own,
                syncIdentifier: $0.metadata?[HKMetadataKeySyncIdentifier] as? String
            )
        }
    }

    private func statistics(
        _ type: HKQuantityType, _ options: HKStatisticsOptions, _ workout: HKWorkout, _ sources: [HKSampleType: Set<HKSource>]
    ) async throws -> HKStatistics? {
        guard let allowed = sources[type], !allowed.isEmpty else { return nil }
        let window = HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate, options: [])
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [window, sourcePredicate(allowed)])
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: options) { _, result, error in
                // No samples in the range is an error of code `errorNoData`, not a failure.
                if let error, (error as? HKError)?.code != .errorNoData { continuation.resume(throwing: error) } else { continuation.resume(returning: result) }
            }
            store.execute(query)
        }
    }
}

#endif

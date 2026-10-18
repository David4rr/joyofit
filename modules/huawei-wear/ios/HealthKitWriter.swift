// The HealthKit side of the export (HealthExporter.swift plans and calls it): authorization to WRITE stepCount, heartRate, oxygenSaturation,
// restingHeartRate, distanceWalkingRunning, activeEnergyBurned, sleepAnalysis, workouts and workout routes, and the samples themselves.
//
// Replace instead of duplicate, the HealthKit counterpart of the Health Connect clientRecordId + version: every sample carries
// HKMetadataKeySyncIdentifier (`joyofit:<kind>:<key>`) and HKMetadataKeySyncVersion (the export time in milliseconds), and HealthKit replaces a
// sample whose sync identifier it already holds when the new version is higher. Sleep has no session record to replace as a whole, so the stages
// of a night are written after this app's sleep samples in the same time range are deleted. A workout (HKWorkout, its heart-rate readings and its
// HKWorkoutRoute) is replaced the same way: this app's earlier objects with the workout's ids are deleted before the new ones are saved.
//
// [INFERENCE] nothing here has run against a real Health store: the compile is checked against the iPhoneOS SDK only.
#if canImport(HealthKit)
import Foundation
import HealthKit
#if canImport(CoreLocation)
import CoreLocation
#endif
#if canImport(UIKit)
import UIKit
#endif
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public final class HealthKitWriter: HealthWriter, @unchecked Sendable {
    private let store = HKHealthStore()

    /// HealthKit samples are saved in chunks of this size.
    static let saveChunk = 500

    /// The type behind each record type the export writes.
    static func sampleType(for record: HealthRecordType) -> HKSampleType {
        switch record {
        case .steps: return HKQuantityType(.stepCount)
        case .heartRate: return HKQuantityType(.heartRate)
        case .oxygenSaturation: return HKQuantityType(.oxygenSaturation)
        case .restingHeartRate: return HKQuantityType(.restingHeartRate)
        case .distance: return HKQuantityType(.distanceWalkingRunning)
        case .activeCaloriesBurned: return HKQuantityType(.activeEnergyBurned)
        case .sleepSession: return HKCategoryType(.sleepAnalysis)
        case .exerciseSession: return HKObjectType.workoutType()
        }
    }

    /// The route of a workout is a series type of its own; it has its own write permission and is asked for together with the others.
    static var routeType: HKSeriesType { HKSeriesType.workoutRoute() }

    static var shareTypes: Set<HKSampleType> { Set(HealthRecordType.allCases.map { sampleType(for: $0) }).union([routeType]) }

    static func plan(_ status: HKAuthorizationStatus) -> HealthAuthStatus {
        switch status {
        case .sharingAuthorized: return .authorized
        case .sharingDenied: return .denied
        default: return .notDetermined
        }
    }

    public init() {}

    public var availability: String { HKHealthStore.isHealthDataAvailable() ? "available" : "unavailable" }

    /// Write permission is readable per type (`sharingAuthorized`); read permission is not (the one read is AppleHealthImporter, after the user taps Import).
    public func authorized() async throws -> Set<HealthRecordType> {
        guard HKHealthStore.isHealthDataAvailable() else { return [] }
        return Set(HealthRecordType.allCases.filter { record in
            let status = HealthKitWriter.plan(store.authorizationStatus(for: HealthKitWriter.sampleType(for: record)))
            if record == .exerciseSession {
                return HealthKitPlan.exerciseSessionGranted(workout: status, route: HealthKitWriter.plan(store.authorizationStatus(for: HealthKitWriter.routeType)))
            }
            return status == .authorized
        })
    }

    public func requestAuthorization() async throws {
        try await store.requestAuthorization(toShare: HealthKitWriter.shareTypes, read: [])
    }

    public func openSettings() async {
        #if canImport(UIKit)
        await MainActor.run {
            guard let health = URL(string: "x-apple-health://") else { return }
            UIApplication.shared.open(health, options: [:]) { opened in
                if opened { return }
                if let settings = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(settings, options: [:], completionHandler: nil) }
            }
        }
        #endif
    }

    // MARK: writing

    public func write(_ batch: HealthBatch, device: HealthDevice, version: Int64) async throws -> Int {
        let hkDevice = HKDevice(
            name: device.name, manufacturer: device.manufacturer, model: device.model, hardwareVersion: nil, firmwareVersion: nil,
            softwareVersion: nil, localIdentifier: nil, udiDeviceIdentifier: nil
        )
        func meta(_ id: String) -> [String: Any] {
            [HKMetadataKeySyncIdentifier: id, HKMetadataKeySyncVersion: NSNumber(value: version)]
        }
        func date(_ sec: Int64) -> Date { Date(timeIntervalSince1970: Double(sec)) }
        func quantity(_ type: HKQuantityType, _ unit: HKUnit, _ value: Double, _ start: Int64, _ end: Int64, _ id: String) -> HKQuantitySample {
            HKQuantitySample(type: type, quantity: HKQuantity(unit: unit, doubleValue: value), start: date(start), end: date(end), device: hkDevice, metadata: meta(id))
        }
        let perMinute = HKUnit.count().unitDivided(by: .minute())

        switch batch {
        case .steps(let intervals):
            let type = HKQuantityType(.stepCount)
            return try await save(intervals.map { quantity(type, .count(), Double($0.value), $0.startSec, $0.endSec, $0.id) })
        case .distance(let intervals):
            let type = HKQuantityType(.distanceWalkingRunning)
            return try await save(intervals.map { quantity(type, .meter(), Double($0.value), $0.startSec, $0.endSec, $0.id) })
        case .calories(let intervals):
            // Step frames count small calories (1/1000 kcal), see StepSample.calories.
            let type = HKQuantityType(.activeEnergyBurned)
            return try await save(intervals.map { quantity(type, .smallCalorie(), Double($0.value), $0.startSec, $0.endSec, $0.id) })
        case .heartRate(let points):
            let type = HKQuantityType(.heartRate)
            return try await save(points.map { quantity(type, perMinute, Double($0.value), $0.timeSec, $0.timeSec, HealthKitPlan.id("hr", $0.timeSec)) })
        case .spo2(let points):
            // HKUnit.percent() takes a fraction: 97 % is 0.97.
            let type = HKQuantityType(.oxygenSaturation)
            return try await save(points.map { quantity(type, .percent(), Double($0.value) / 100.0, $0.timeSec, $0.timeSec, HealthKitPlan.id("spo2", $0.timeSec)) })
        case .restingHeartRate(let readings):
            let type = HKQuantityType(.restingHeartRate)
            return try await save(readings.map { quantity(type, perMinute, Double($0.point.value), $0.point.timeSec, $0.point.timeSec, $0.id) })
        case .sleep(let sessions, let from, let to):
            let type = HKCategoryType(.sleepAnalysis)
            // Delete this app's own sleep samples that overlap the range, so a night that was cut differently last time leaves no stale stage.
            let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
                HKQuery.predicateForObjects(from: HKSource.default()),
                HKQuery.predicateForSamples(withStart: date(from), end: date(to), options: []),
            ])
            _ = try await store.deleteObjects(of: type, predicate: predicate)
            var samples = [HKCategorySample]()
            for session in sessions {
                for stage in session.stages {
                    samples.append(
                        HKCategorySample(
                            type: type, value: HealthKitWriter.categoryValue(for: stage.stage).rawValue, start: date(stage.startSec), end: date(stage.endSec), device: hkDevice,
                            metadata: meta(HealthKitPlan.id("sleep", "\(session.startSec):\(stage.startSec)"))
                        )
                    )
                }
            }
            return try await save(samples)
        case .workouts(let plans):
            var written = 0
            for plan in plans {
                try await saveWorkout(plan, device: hkDevice, meta: meta)
                written += 1
            }
            return written
        }
    }

    private func save(_ samples: [HKSample]) async throws -> Int {
        var saved = 0
        var index = 0
        while index < samples.count {
            let chunk = Array(samples[index..<min(index + HealthKitWriter.saveChunk, samples.count)])
            try await store.save(chunk)
            saved += chunk.count
            index += chunk.count
        }
        return saved
    }

    /// One workout as an HKWorkout with the sport mapped from the Huawei type, the heart-rate readings inside it attached, and its route when
    /// the watch recorded one and the user allowed routes. Its energy and distance are not written again: the per-minute samples already cover
    /// them, and adding them would count them twice for readers that sum energy or distance (the same rule as the Android exporter).
    ///
    /// Replace instead of duplicate: what an earlier export of this workout saved (the workout, its route, its heart-rate readings) is deleted by
    /// sync identifier first. HealthKit lets an app delete only its own objects.
    private func saveWorkout(_ plan: WorkoutPlan, device: HKDevice, meta: (String) -> [String: Any]) async throws {
        func date(_ sec: Int64) -> Date { Date(timeIntervalSince1970: Double(sec)) }
        let routeAllowed = HealthKitWriter.plan(store.authorizationStatus(for: HealthKitWriter.routeType)) == .authorized
        let heartType = HKQuantityType(.heartRate)

        try await deleteOwn(HKObjectType.workoutType(), ids: [plan.id])
        if routeAllowed { try await deleteOwn(HealthKitWriter.routeType, ids: [plan.routeId]) }
        if !plan.heartRate.isEmpty { try await deleteOwn(heartType, ids: plan.heartRate.map(\.id)) }

        let (activity, indoor) = HealthKitWriter.activity(for: plan.kind)
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = activity
        configuration.locationType = indoor ? .indoor : .unknown
        let builder = HKWorkoutBuilder(healthStore: store, configuration: configuration, device: device)
        try await builder.beginCollection(at: date(plan.start))
        var extra = meta(plan.id)
        if let name = plan.name, !name.isEmpty { extra[HKMetadataKeyWorkoutBrandName] = name }
        if let notes = plan.notes { extra["JoyoFitNotes"] = notes }
        try await builder.addMetadata(extra)
        if !plan.heartRate.isEmpty {
            let perMinute = HKUnit.count().unitDivided(by: .minute())
            let readings: [HKSample] = plan.heartRate.map {
                HKQuantitySample(
                    type: heartType, quantity: HKQuantity(unit: perMinute, doubleValue: Double($0.bpm)), start: date($0.timeSec), end: date($0.timeSec),
                    device: device, metadata: meta($0.id)
                )
            }
            for start in stride(from: 0, to: readings.count, by: HealthKitWriter.saveChunk) {
                try await builder.addSamples(Array(readings[start..<min(start + HealthKitWriter.saveChunk, readings.count)]))
            }
        }
        try await builder.endCollection(at: date(plan.end))
        guard let workout = try await builder.finishWorkout() else {
            throw WearError(.storage, "HealthKit did not return the workout it saved (start \(plan.start))")
        }

        #if canImport(CoreLocation)
        if routeAllowed && !plan.route.isEmpty {
            let routeBuilder = HKWorkoutRouteBuilder(healthStore: store, device: device)
            let locations = plan.route.map { p -> CLLocation in
                // The watch reports no accuracy: 10 m horizontal (a valid, usual GPS value) and "no altitude accuracy" without an altitude.
                CLLocation(
                    coordinate: CLLocationCoordinate2D(latitude: p.latitude, longitude: p.longitude), altitude: p.altitude ?? 0, horizontalAccuracy: 10,
                    verticalAccuracy: p.altitude == nil ? -1 : 10, timestamp: date(p.timeSec)
                )
            }
            for start in stride(from: 0, to: locations.count, by: HealthKitWriter.saveChunk) {
                try await routeBuilder.insertRouteData(Array(locations[start..<min(start + HealthKitWriter.saveChunk, locations.count)]))
            }
            _ = try await routeBuilder.finishRoute(with: workout, metadata: meta(plan.routeId))
        }
        #endif
    }

    /// Deletes this app's own objects of `type` whose sync identifier is one of `ids`.
    private func deleteOwn(_ type: HKObjectType, ids: [String]) async throws {
        for start in stride(from: 0, to: ids.count, by: HealthKitWriter.saveChunk) {
            let chunk = Array(ids[start..<min(start + HealthKitWriter.saveChunk, ids.count)])
            let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: chunk)
            _ = try await store.deleteObjects(of: type, predicate: predicate)
        }
    }

    /// The HealthKit activity for an exercise type, and whether it is an indoor one.
    static func activity(for kind: WorkoutKind) -> (HKWorkoutActivityType, Bool) {
        switch kind {
        case .running: return (.running, false)
        case .walking: return (.walking, false)
        case .biking: return (.cycling, false)
        case .hiking: return (.hiking, false)
        case .runningTreadmill: return (.running, true)
        case .swimmingPool: return (.swimming, true)
        case .bikingStationary: return (.cycling, true)
        case .swimmingOpenWater: return (.swimming, false)
        case .scubaDiving:
            if #available(iOS 17.0, *) { return (.underwaterDiving, false) }
            return (.other, false)
        case .tableTennis: return (.tableTennis, true)
        case .badminton: return (.badminton, false)
        case .tennis: return (.tennis, false)
        case .soccer: return (.soccer, false)
        case .basketball: return (.basketball, false)
        case .volleyball: return (.volleyball, false)
        case .elliptical: return (.elliptical, true)
        case .rowingMachine: return (.rowing, true)
        case .stairClimbingMachine: return (.stairClimbing, true)
        case .yoga: return (.yoga, true)
        case .pilates: return (.pilates, true)
        case .exerciseClass: return (.mixedCardio, true)
        case .strengthTraining: return (.traditionalStrengthTraining, true)
        case .highIntensityIntervalTraining: return (.highIntensityIntervalTraining, false)
        case .calisthenics: return (.functionalStrengthTraining, false)
        case .martialArts: return (.martialArts, false)
        case .boxing: return (.boxing, false)
        case .fencing: return (.fencing, false)
        case .dancing: return (.socialDance, true)
        case .gymnastics: return (.gymnastics, true)
        case .rollerHockey: return (.skatingSports, false)
        case .frisbeeDisc: return (.discSports, false)
        case .stairClimbing: return (.stairClimbing, false)
        case .handball: return (.handball, false)
        case .baseball: return (.baseball, false)
        case .softball: return (.softball, false)
        case .cricket: return (.cricket, false)
        case .rugby: return (.rugby, false)
        case .iceHockey: return (.hockey, false)
        case .squash: return (.squash, true)
        case .sailing: return (.sailing, false)
        case .surfing: return (.surfingSports, false)
        case .paddling: return (.paddleSports, false)
        case .rowing: return (.rowing, false)
        case .iceSkating: return (.skatingSports, false)
        case .skating: return (.skatingSports, false)
        case .rockClimbing: return (.climbing, false)
        case .paragliding: return (.other, false)
        case .otherWorkout: return (.other, false)
        }
    }

    /// `HKCategoryValueSleepAnalysis` for a stage, straight from the framework, for the test that checks `SleepStageKind.healthKitValue`.
    static func categoryValue(for stage: SleepStageKind) -> HKCategoryValueSleepAnalysis {
        switch stage {
        case .sleeping: return .asleepUnspecified
        case .light: return .asleepCore
        case .deep: return .asleepDeep
        case .rem: return .asleepREM
        case .awake: return .awake
        }
    }
}

#endif

// `LocationSource` over CoreLocation: coarse position for the weather. When-in-use authorization only (no background location), accuracy
// `kCLLocationAccuracyKilometer`: the weather needs the city, not the street. `requestLocation()` delivers one fix; `CLLocationManager.location` is
// the system's cached last fix.
#if canImport(CoreLocation)
import CoreLocation
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public final class CoreLocationSource: NSObject, LocationSource, CLLocationManagerDelegate, @unchecked Sendable {
    /// How long a caller of `requestAuthorization` waits for the user to answer the system prompt.
    static let promptTimeoutMs = 120_000

    private let lock = NSLock()
    private var _manager: CLLocationManager?
    private var authorizationWaiters: [CheckedContinuation<LocationAuthorization, Never>] = []
    private var fixWaiters: [UUID: CheckedContinuation<LocationFix?, Never>] = [:]

    public override init() { super.init() }

    /// The manager is made on the main thread, whose run loop CoreLocation delivers the delegate calls on.
    private func manager() -> CLLocationManager {
        if let existing = lock.locked({ _manager }) { return existing }
        let make = { () -> CLLocationManager in
            let manager = CLLocationManager()
            manager.desiredAccuracy = kCLLocationAccuracyKilometer
            manager.delegate = self
            return manager
        }
        let manager = Thread.isMainThread ? make() : DispatchQueue.main.sync(execute: make)
        return lock.locked {
            if let existing = _manager { return existing }
            _manager = manager
            return manager
        }
    }

    private static func map(_ status: CLAuthorizationStatus) -> LocationAuthorization {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse: return .granted
        case .notDetermined: return .notDetermined
        default: return .denied
        }
    }

    public var authorization: LocationAuthorization { CoreLocationSource.map(manager().authorizationStatus) }

    public func requestAuthorization() async -> LocationAuthorization {
        let manager = manager()
        let current = CoreLocationSource.map(manager.authorizationStatus)
        if current != .notDetermined { return current }
        return await withCheckedContinuation { (continuation: CheckedContinuation<LocationAuthorization, Never>) in
            lock.locked { authorizationWaiters.append(continuation) }
            DispatchQueue.main.async { manager.requestWhenInUseAuthorization() }
            // The prompt can stay unanswered (the app went to the background under it): the caller must not wait for ever.
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(CoreLocationSource.promptTimeoutMs) * 1_000_000)
                self?.resolveAuthorization()
            }
        }
    }

    private func resolveAuthorization() {
        let status = CoreLocationSource.map(manager().authorizationStatus)
        let waiters: [CheckedContinuation<LocationAuthorization, Never>] = lock.locked {
            let w = authorizationWaiters
            authorizationWaiters = []
            return w
        }
        for waiter in waiters { waiter.resume(returning: status) }
    }

    public func lastKnown() async -> LocationFix? {
        let manager = manager()
        return await MainActor.run { manager.location.map(CoreLocationSource.fix) }
    }

    public func currentFix() async -> LocationFix? {
        let manager = manager()
        let id = UUID()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<LocationFix?, Never>) in
                lock.locked { fixWaiters[id] = continuation }
                // The task was cancelled before the waiter existed: the cancellation handler found nothing to resolve.
                if Task.isCancelled {
                    resolveFix(id, nil)
                    return
                }
                DispatchQueue.main.async { manager.requestLocation() }
            }
        } onCancel: {
            resolveFix(id, nil)
        }
    }

    private func resolveFix(_ id: UUID, _ fix: LocationFix?) {
        let waiter: (CheckedContinuation<LocationFix?, Never>, Bool)? = lock.locked {
            guard let w = fixWaiters.removeValue(forKey: id) else { return nil }
            return (w, fixWaiters.isEmpty)
        }
        guard let (continuation, nobodyLeft) = waiter else { return }
        if nobodyLeft && fix == nil {
            let manager = manager()
            DispatchQueue.main.async { manager.stopUpdatingLocation() }
        }
        continuation.resume(returning: fix)
    }

    private func resolveAllFixes(_ fix: LocationFix?) {
        let ids: [UUID] = lock.locked { Array(fixWaiters.keys) }
        for id in ids { resolveFix(id, fix) }
    }

    private static func fix(_ location: CLLocation) -> LocationFix {
        LocationFix(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude, timeSec: Int64(location.timestamp.timeIntervalSince1970))
    }

    public func placeName(latitude: Double, longitude: Double) async -> String? {
        let geocoder = CLGeocoder()
        return await withTaskCancellationHandler {
            do {
                let placemarks = try await geocoder.reverseGeocodeLocation(CLLocation(latitude: latitude, longitude: longitude))
                guard let placemark = placemarks.first else { return nil }
                return placemark.locality ?? placemark.subAdministrativeArea ?? placemark.administrativeArea
            } catch {
                return nil
            }
        } onCancel: {
            geocoder.cancelGeocode()
        }
    }

    // MARK: CLLocationManagerDelegate

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // Also called once when the delegate is set, with the status the user has not answered yet.
        if manager.authorizationStatus != .notDetermined { resolveAuthorization() }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        resolveAllFixes(locations.last.map(CoreLocationSource.fix))
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        resolveAllFixes(nil)
    }
}
#endif

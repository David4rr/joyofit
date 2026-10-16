// The phone's GPS for a workout the watch asks it about (WorkoutLink.kt `startGps`): a continuous, precise stream of fixes, wanted only while
// the watch says a workout runs. The seam keeps WorkoutLink testable without CoreLocation.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public protocol LiveGpsSource: AnyObject, Sendable {
    var authorization: LocationAuthorization { get }
    /// Shows the system prompt when the user was never asked and returns the answer; returns at once otherwise.
    func requestAuthorization() async -> LocationAuthorization
    /// Starts delivering fixes to `onFix`; false when they cannot be had. Calling it while started replaces the handler.
    func start(_ onFix: @escaping @Sendable (WorkoutLinkWire.Fix) -> Void) -> Bool
    func stop()
}

/// A platform without location: never granted, never starts.
public final class UnavailableLiveGps: LiveGpsSource, @unchecked Sendable {
    public init() {}
    public var authorization: LocationAuthorization { .denied }
    public func requestAuthorization() async -> LocationAuthorization { .denied }
    public func start(_ onFix: @escaping @Sendable (WorkoutLinkWire.Fix) -> Void) -> Bool { false }
    public func stop() {}
}

// The process-wide wiring of the iOS module: the real CoreBluetooth central, the Keychain, the HealthKit writer and the UIKit background
// task, put together into the one WearRuntime that the Expo module and the app delegate subscriber share.
#if canImport(CoreBluetooth) && (canImport(SQLite3) || canImport(CSQLite))
import CoreBluetooth
import Foundation
#if canImport(UIKit)
import UIKit
#endif
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public enum WearApp {
    public static let central = BleCentral.shared

    /// The phone's coarse position for the weather.
    private static var weatherLocationSource: LocationSource {
        #if canImport(CoreLocation)
        return CoreLocationSource()
        #else
        return UnavailableLocationSource()
        #endif
    }

    /// The phone's precise position while a workout started on the watch asks for it (when-in-use, foreground).
    private static var liveGpsSource: LiveGpsSource {
        #if canImport(CoreLocation)
        return CoreLocationStream()
        #else
        return UnavailableLiveGps()
        #endif
    }

    /// The one runtime. Creating it touches nothing on the radio: the central starts on the first connect or scan, or at launch when
    /// background mode is on (`HuaweiWearAppDelegateSubscriber`).
    public static let runtime: WearRuntime = {
        let central = BleCentral.shared
        let settings = WearSettings()
        let syncStore = SyncStore()
        let runtime = WearRuntime(
            settings: settings,
            syncStore: syncStore,
            deviceStore: DeviceStore(secrets: KeychainSecretStore()),
            gate: central,
            environment: environment(),
            phoneModel: machineIdentifier(),
            transportFactory: { request, delegate in BleTransport(request: request, delegate: delegate) },
            nearby: { timeoutMs in
                try await central.requireReady()
                return await central.nearbyWatches(timeoutMs: timeoutMs).map { NearbyWatch(identifier: $0.identifier.uuidString, name: $0.name) }
            },
            systemConnected: {
                try await central.requireReady()
                let remembered = settings.watchAddress.flatMap { UUID(uuidString: $0) }
                return central.systemConnectedWatches(remembered: remembered).map { NearbyWatch(identifier: $0.identifier.uuidString, name: $0.name) }
            },
            expiring: expiringWork,
            weatherLocation: weatherLocationSource,
            liveGps: liveGpsSource
        )
        // Bluetooth coming back on is the moment a waiting background connect can be retried.
        _ = central.addObserver { state in
            if state == .poweredOn { runtime.controller.nudge(reset: true) }
        }
        #if canImport(HealthKit)
        runtime.onSyncComplete = { summary in health.onSyncComplete(summary) }
        #endif
        return runtime
    }()

    #if canImport(HealthKit)
    public static let health = HealthExporter(
        syncStore: runtime.syncStore, writer: HealthKitWriter(), settings: HealthExportSettings(), events: runtime.events
    )
    /// The one-time Apple Health history import; the only code that reads HealthKit.
    public static let appleHealthImport = AppleHealthImporter(syncStore: runtime.syncStore)
    #endif

    // MARK: environment

    /// `iPhone15,2`; the simulator reports the model it pretends to be.
    static func machineIdentifier() -> String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return simulated }
        var info = utsname()
        uname(&info)
        return withUnsafePointer(to: &info.machine) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
        }
    }

    static func environment() -> SupportReport.Environment {
        let bundle = Bundle.main
        let id = bundle.bundleIdentifier ?? "app"
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        #if canImport(UIKit)
        let system = "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)"
        #else
        let system = ProcessInfo.processInfo.operatingSystemVersionString
        #endif
        return SupportReport.Environment(app: "\(id) \(version) (\(build))", phone: "Apple \(machineIdentifier()), \(system)")
    }

    // MARK: background execution time

    /// Runs `work` inside a UIKit background task, so the process is not suspended halfway through a connect or a sync that iOS woke it for.
    static let expiringWork: ExpiringWork = { name, work in
        #if canImport(UIKit)
        let task = BackgroundTaskBox()
        await MainActor.run {
            task.id = UIApplication.shared.beginBackgroundTask(withName: name) {
                // The time is up: ending the task is what keeps iOS from killing the app.
                if task.id != .invalid {
                    UIApplication.shared.endBackgroundTask(task.id)
                    task.id = .invalid
                }
            }
        }
        await work()
        await MainActor.run {
            if task.id != .invalid {
                UIApplication.shared.endBackgroundTask(task.id)
                task.id = .invalid
            }
        }
        #else
        await work()
        #endif
    }

    #if canImport(UIKit)
    private final class BackgroundTaskBox: @unchecked Sendable {
        var id: UIBackgroundTaskIdentifier = .invalid
    }
    #endif
}

#endif

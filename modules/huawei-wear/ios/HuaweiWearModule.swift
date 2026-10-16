// Expo module `HuaweiWear` for iOS: the same JS API as HuaweiWearModule.ts (and the Kotlin HuaweiWearModule.kt). All protocol work lives in
// WearLink, reached through the process-wide WearRuntime (WearApp.runtime) that the background controller shares; this class wires the TS
// contract to it and forwards runtime events (onStateChange / onBattery / onLog / onSyncComplete) to JS while the module is alive.
//
// Implemented for real: the link (getBondedDevices, connect, disconnect, getState, getDevice, getSupportReport, refreshBattery, syncActivity,
// forgetDevice), the background session, the user profile and the HealthKit export. Everything else the Android module offers has no iOS
// counterpart or no ported protocol layer yet and keeps its name: getters answer with the inert status of InertStatus.swift, commands reject
// with ERR_UNSUPPORTED ("... not available on iOS yet"). Nothing claims to have reached the watch that did not.
#if canImport(ExpoModulesCore) && canImport(CoreBluetooth) && (canImport(SQLite3) || canImport(CSQLite))
import CoreBluetooth
import ExpoModulesCore
import Foundation
#if canImport(UIKit)
import UIKit
#endif
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

/// A failure that reaches JS as a coded exception, like the Android `WearException` (`ERR_...` is the code on the JS error).
final class WearException: Exception, @unchecked Sendable {
    init(_ error: WearError, file: String = #fileID, line: UInt = #line, function: String = #function) {
        super.init(name: "WearException", description: error.message, code: error.code.rawValue, file: file, line: line, function: function)
        self.cause = error.underlying
    }

    init(_ code: ErrorCode, _ message: String, file: String = #fileID, line: UInt = #line, function: String = #function) {
        super.init(name: "WearException", description: message, code: code.rawValue, file: file, line: line, function: function)
    }
}

/// The rejection of a command that is not available on iOS yet.
func iosUnsupported(_ what: String) -> WearException { WearException(.unsupported, Inert.message(what)) }

/// Runs `body` and turns the layer's `WearError` into the coded exception JS sees.
func wearCall<T>(_ body: () async throws -> T) async throws -> T {
    do {
        return try await body()
    } catch let e as WearError {
        throw WearException(e)
    }
}

/// Reads a JS number out of a dictionary value (JS numbers arrive as Double or Int).
private func number(_ value: Any?) -> Double? {
    switch value {
    case let d as Double: return d
    case let i as Int: return Double(i)
    case let n as NSNumber: return n.doubleValue
    default: return nil
    }
}

/// `UserProfile` of HuaweiWear.types.ts from the JS object; a missing or mistyped field is an invalid argument.
func parseUserProfile(_ raw: [String: Any]) throws -> UserProfileData {
    guard let height = number(raw["heightCm"]), let weight = number(raw["weightKg"]), let birth = number(raw["birthYear"]),
        let sex = raw["sex"] as? String, let goal = number(raw["dailyStepGoal"])
    else {
        throw WearException(.invalidArgument, "The profile needs heightCm, weightKg, birthYear, sex and dailyStepGoal")
    }
    return UserProfileData(heightCm: Int(height), weightKg: weight, birthYear: Int(birth), sex: sex, dailyStepGoal: Int(goal))
}

// MARK: unsupported definitions

/// A command with no arguments that rejects with ERR_UNSUPPORTED.
private func rejects(_ name: String) -> AnyDefinition {
    AsyncFunction(name) { () async throws -> Bool in throw iosUnsupported(name) }
}

private func rejects<A: AnyArgument>(_ name: String, _ a: A.Type) -> AnyDefinition {
    AsyncFunction(name) { (_: A) async throws -> Bool in throw iosUnsupported(name) }
}

private func rejects<A: AnyArgument, B: AnyArgument>(_ name: String, _ a: A.Type, _ b: B.Type) -> AnyDefinition {
    AsyncFunction(name) { (_: A, _: B) async throws -> Bool in throw iosUnsupported(name) }
}

private func rejects<A: AnyArgument, B: AnyArgument, C: AnyArgument>(_ name: String, _ a: A.Type, _ b: B.Type, _ c: C.Type) -> AnyDefinition {
    AsyncFunction(name) { (_: A, _: B, _: C) async throws -> Bool in throw iosUnsupported(name) }
}

/// A phone-side switch of a feature that is always off here: switching it off is already the state (resolves), switching it on rejects.
private func switchRejectingOn(_ name: String) -> AnyDefinition {
    AsyncFunction(name) { (enabled: Bool) async throws -> Void in
        if enabled { throw iosUnsupported(name) }
    }
}

public final class HuaweiWearModule: Module {
    private let runtime = WearApp.runtime
    private let bridge = EventBridge()
    private var listenerToken: UUID?

    /// Forwards runtime events to JS while the module is alive.
    private final class EventBridge: WearEvents, @unchecked Sendable {
        private let lock = NSLock()
        private var destroyed = false
        weak var module: HuaweiWearModule?

        func destroy() { lock.locked { destroyed = true } }

        private func emit(_ name: String, _ payload: [String: Any?]) {
            guard !lock.locked({ destroyed }), let module else { return }
            module.sendEvent(name, payload)
        }

        func state(_ state: LinkState, error: String?) { emit("onStateChange", ["state": state.rawValue, "error": error]) }
        func battery(_ level: Int) { emit("onBattery", ["level": level]) }
        func syncComplete(_ summary: SyncSummary) { emit("onSyncComplete", summary.toJS()) }
        func uploadProgress(bytes: Int, total: Int) { emit("onUploadProgress", ["bytes": bytes, "total": total]) }
        func uploadResult(ok: Bool, fileName: String, code: Int?, message: String) {
            emit("onUploadResult", ["ok": ok, "fileName": fileName, "code": code, "message": message])
        }
        func log(_ entry: LogEntry) {
            emit(
                "onLog",
                [
                    "ts": Int64(Date().timeIntervalSince1970 * 1000),
                    "direction": entry.direction.rawValue,
                    "serviceId": entry.serviceId,
                    "commandId": entry.commandId,
                    "hex": entry.hex,
                    "message": entry.message,
                ]
            )
        }
    }

    public func definition() -> ModuleDefinition {
        let runtime = self.runtime

        Name("HuaweiWear")

        // iOS has no store-specific build: the app is signed and shipped by this project.
        Constant("distribution") { "sideload" }

        Events(
            "onStateChange", "onBattery", "onLog", "onSyncComplete", "onUploadProgress", "onUploadResult", "onHeartRate", "onWatchMealLogged",
            "onFaceCustomization", "onLiveWorkout", "onHrvProgress"
        )

        OnCreate {
            self.bridge.module = self
            self.listenerToken = runtime.addListener(self.bridge)
            runtime.ensureBackgroundRunning()
        }

        OnAppBecomesActive {
            runtime.ensureBackgroundRunning()
            runtime.controller.nudge(reset: false)
        }

        OnDestroy {
            self.bridge.destroy()
            if let token = self.listenerToken { runtime.removeListener(token) }
            runtime.onModuleDestroyed()
        }

        // MARK: link

        AsyncFunction("getBondedDevices") { () async throws -> [[String: Any]] in
            try await wearCall { try await runtime.bondedDevices() }
        }

        AsyncFunction("connect") { (address: String) async throws -> [String: Any] in
            try await wearCall { try await runtime.connectFromApp(address).toJS() }
        }

        AsyncFunction("disconnect") { () async throws -> Void in
            runtime.disconnectFromApp()
        }

        // The link outlives JS reloads when the background session owns it.
        Function("getState") { () -> String in
            runtime.link.currentState().rawValue
        }

        Function("getDevice") { () -> [String: Any]? in
            guard var info = runtime.link.deviceInfo() else { return nil }
            if let battery = runtime.status.battery { info.batteryLevel = battery }
            return info.toJS()
        }

        AsyncFunction("getSupportReport") { () async throws -> [String: Any] in
            runtime.supportReport()
        }

        AsyncFunction("refreshBattery") { () async throws -> Int in
            try await wearCall { try await runtime.link.refreshBattery() }
        }

        AsyncFunction("syncActivity") { () async throws -> [String: Any] in
            try await wearCall { try await runtime.link.syncActivity().toJS() }
        }

        AsyncFunction("forgetDevice") { (address: String) async throws -> Void in
            runtime.forget(address)
        }

        // MARK: background session

        AsyncFunction("setBackgroundEnabled") { (address: String?) async throws -> Void in
            try await wearCall {
                try runtime.setBackground(address)
                // The central has to exist from launch on, or iOS cannot hand a restored connection back to it.
                if address != nil { WearApp.central.start() }
            }
        }

        Function("getBackgroundStatus") { () -> [String: Any] in
            runtime.backgroundStatus()
        }

        AsyncFunction("setSyncIntervalMinutes") { (minutes: Int) async throws -> Void in
            try await wearCall { try runtime.setSyncInterval(minutes) }
        }

        // MARK: link settings

        // iOS always opens the watch over Bluetooth LE GATT: there is no Classic link to force away from.
        Function("getForceBle") { () -> Bool in true }

        AsyncFunction("setForceBle") { (enabled: Bool) async throws -> Void in }

        // MARK: profile

        Function("getUserProfile") { () -> [String: Any]? in
            runtime.settings.profile?.toJS()
        }

        AsyncFunction("setUserProfile") { (profile: [String: Any]) async throws -> Bool in
            let parsed = try parseUserProfile(profile)
            return try await wearCall { try await runtime.setUserProfile(parsed) }
        }

        // MARK: Apple Health (the HealthKit counterpart of the Health Connect export)

        AsyncFunction("getHealthConnectStatus") { () async throws -> [String: Any] in
            await WearApp.health.status()
        }

        AsyncFunction("requestHealthConnectPermissions") { () async throws -> [String: Any] in
            try await wearCall { try await WearApp.health.requestPermissions() }
        }

        AsyncFunction("setHealthConnectEnabled") { (enabled: Bool) async throws -> [String: Any] in
            try await wearCall {
                try await WearApp.health.setEnabled(enabled)
                return await WearApp.health.status()
            }
        }

        AsyncFunction("backfillHealthConnect") { () async throws -> [String: Any] in
            try await wearCall { try await WearApp.health.backfill().toJS() }
        }

        // The Health app is where permissions and written data are managed.
        AsyncFunction("openHealthConnectSettings") { () async throws -> Void in
            await WearApp.health.openSettings()
        }

        // MARK: no iOS counterpart or protocol layer not ported: inert getters

        Function("getNotificationAccess") { () -> [String: Any] in Inert.notificationAccess() }
        Function("getMorningSummaryEnabled") { () -> Bool in false }
        Function("getHealthSensors") { () -> [String: Any] in Inert.healthSensors() }
        Function("getStressStatus") { () -> [String: Any] in Inert.stress() }
        Function("getLiveWorkout") { () -> [String: Any]? in nil }
        Function("getPhoneFeatures") { () -> [String: Any] in runtime.features.status() }
        Function("getAlarms") { () -> [String: Any] in Inert.alarms() }
        Function("getWeatherStatus") { () -> [String: Any] in Inert.weather() }
        Function("getSafety") { () -> [String: Any] in Inert.safety() }
        Function("testSosRelay") { () -> [String: Any] in Inert.sosRelayTest() }
        Function("getDietStatus") { () -> [String: Any] in Inert.diet() }
        Function("getBodyMetrics") { () -> [String: Any] in Inert.bodyMetrics() }
        Function("getActivityGoals") { () -> [String: Any] in Inert.activityGoals(dailyStepGoal: runtime.settings.profile?.dailyStepGoal) }
        Function("getHealthyLiving") { () -> [String: Any] in Inert.healthyLiving() }
        Function("getCourses") { () -> [String: Any] in Inert.courses() }

        AsyncFunction("getNotificationApps") { () async throws -> [[String: Any]] in [] }
        AsyncFunction("getCycle") { () async throws -> [String: Any] in
            Inert.cycle(today: Inert.today(), watchConnected: runtime.link.deviceInfo() != nil)
        }

        // Nothing to do where Android's own call is a no-op with nothing running or stored.
        AsyncFunction("cancelHrvMeasurement") { () async throws -> Void in }
        Function("dismissLiveWorkout") { () -> Void in }
        Function("finishLiveWorkout") { () -> Void in }
        AsyncFunction("markWatchMealsSynced") { (ids: [String]) async throws -> Void in }
        AsyncFunction("setLiveHeartRate") { (active: Bool) async throws -> Void in
            // Android does nothing when no watch is connected; with one connected, starting is a command that cannot be honoured.
            if active && runtime.link.deviceInfo() != nil { throw iosUnsupported("setLiveHeartRate") }
        }
        Function("startLiveWorkout") { () throws -> Void in throw iosUnsupported("startLiveWorkout") }

        AsyncFunction("findWatch") { (start: Bool) async throws -> Void in
            try await wearCall { try await runtime.features.findWatch(start) }
        }

        // MARK: watch faces

        AsyncFunction("listWatchfaces") { () async throws -> [String: Any] in
            try await wearCall { try await runtime.watchfaces.list() }
        }

        AsyncFunction("installWatchface") { (uri: String, signature: String?, fileName: String?) async throws -> [String: Any] in
            try await wearCall { try await runtime.watchfaces.install(uri: uri, signature: signature, fileName: fileName) }
        }

        AsyncFunction("setActiveWatchface") { (id: String) async throws -> [String: Any] in
            try await wearCall { try await runtime.watchfaces.setActive(id) }
        }

        AsyncFunction("deleteWatchface") { (id: String) async throws -> [String: Any] in
            try await wearCall { try await runtime.watchfaces.delete(id) }
        }

        // MARK: switches of phone-side features that are always off here

        switchRejectingOn("setNotificationsEnabled")
        switchRejectingOn("setMorningSummaryEnabled")
        switchRejectingOn("setFindPhoneEnabled")
        switchRejectingOn("setCallsEnabled")
        switchRejectingOn("setCallControlEnabled")
        switchRejectingOn("setWeatherEnabled")
        switchRejectingOn("setSosRelayEnabled")
        switchRejectingOn("setSleepReportEnabled")
        switchRejectingOn("setCycleEnabled")
        switchRejectingOn("setHealthyLivingEnabled")
        switchRejectingOn("setCoursesEnabled")

        // MARK: commands that would reach the watch or Android-only screens: ERR_UNSUPPORTED

        rejects("openNotificationAccess")
        rejects("setNotificationAppEnabled", String.self, Bool.self)
        rejects("setHealthSensors", [String: Any].self)
        rejects("measureHrv")
        rejects("setAutomaticStress", Bool.self)
        rejects("refreshAlarms")
        rejects("setAlarms", [String: Any].self)
        rejects("setWeatherUnit", String.self)
        rejects("setWeatherLocationMode", String.self)
        rejects("setWeatherIntervalMinutes", Int.self)
        rejects("setWeatherCity", String.self)
        rejects("refreshWeather")
        rejects("getFaceCustomization", String.self)
        rejects("applyFaceCustomization", String.self, [String: Any].self)
        rejects("getPhotoFace")
        rejects("addPhoto", String.self)
        rejects("deletePhoto", String.self)
        rejects("setPhotoFaceActive")
        rejects("setFallDetection", Bool.self)
        rejects("queryFallDetection")
        rejects("sendSleepReportNow")
        rejects("setCycleSwitches", [String: Any].self)
        rejects("startPeriod", String.self)
        rejects("endPeriod", String.self)
        rejects("addPeriod", String.self, String.self)
        rejects("deletePeriod", String.self)
        rejects("logCycleDay", String.self, Int.self, Int.self)
        rejects("setDietDay", [String: Any].self)
        rejects("pushDietNow")
        rejects("setBodyMetrics", [String: Any].self)
        rejects("setActivityGoals", [String: Any].self)
        rejects("sendActivityGoals")
        rejects("pushHealthyLiving")
        rejects("pushRunningCourse", [String: Any].self)
    }
}

/// Starts the CoreBluetooth central at launch when background mode is on, or when iOS relaunched the app for the bluetooth-central session:
/// the central must exist (with its restoration identifier) before the first run-loop turn for the restoration event to reach it.
public class HuaweiWearAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    public func application(
        _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let relaunchedForBluetooth = launchOptions?[.bluetoothCentrals] != nil
        if WearSettings().backgroundEnabled || relaunchedForBluetooth {
            WearApp.central.start()
            WearApp.runtime.ensureBackgroundRunning()
        }
        return true
    }
}

#endif

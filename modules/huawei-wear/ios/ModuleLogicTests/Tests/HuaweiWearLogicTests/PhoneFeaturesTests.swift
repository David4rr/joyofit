import XCTest
@testable import HuaweiWearLogic

private final class NullSink: FrameSink, @unchecked Sendable {
    func write(_ frames: [Bytes]) async throws {}
}

private final class Recorder: LinkObserver, @unchecked Sendable {
    private let lock = NSLock()
    private var _connected = 0
    private var _disconnected = 0
    var connected: Int { lock.locked { _connected } }
    var disconnected: Int { lock.locked { _disconnected } }
    func linkConnected(_ handle: LinkHandle) async { lock.locked { _connected += 1 } }
    func linkDisconnected() { lock.locked { _disconnected += 1 } }
}

final class PhoneFeaturesTests: XCTestCase {
    private func handle() -> LinkHandle {
        LinkHandle(address: "A", session: HuaweiSession(sink: NullSink(), log: { _ in }), caps: DeviceCaps(), operationLock: AsyncLock())
    }

    func testASessionIsAnnouncedOnceNoMatterHowOftenTheStateRepeats() async {
        let observers = LinkObservers()
        let recorder = Recorder()
        observers.add(recorder)
        let h = handle()
        for task in observers.connected(h) { await task.value }
        // A sync ending reports `connected` again for the same session.
        XCTAssertTrue(observers.connected(h).isEmpty)
        XCTAssertEqual(recorder.connected, 1)

        observers.disconnected()
        observers.disconnected()
        XCTAssertEqual(recorder.disconnected, 1, "only a session that was announced is taken back")

        for task in observers.connected(handle()) { await task.value }
        XCTAssertEqual(recorder.connected, 2, "a new session is announced again")
    }

    func testARemovedObserverHearsNothing() async {
        let observers = LinkObservers()
        let recorder = Recorder()
        let token = observers.add(recorder)
        observers.remove(token)
        XCTAssertTrue(observers.connected(handle()).isEmpty)
        XCTAssertEqual(recorder.connected, 0)
    }

    private func runtime() -> WearRuntime {
        WearRuntime(
            settings: WearSettings(defaults: ephemeralDefaults()), syncStore: SyncStore(url: temporaryDatabaseURL()),
            deviceStore: DeviceStore(secrets: MemorySecretStore()), gate: AlwaysReadyGate(),
            environment: .init(app: "app 1 (1)", phone: "Apple test"), phoneModel: "test",
            transportFactory: { request, delegate in FakeTransport(.hangConnect, request: request, delegate: delegate) }
        )
    }

    func testFindWatchNeedsAConnectedWatchAndTheStatusSaysNotSupportedUntilOne() async {
        let rt = runtime()
        XCTAssertEqual(rt.features.status()["findWatchSupported"] as? Bool, false)
        do {
            try await rt.features.findWatch(true)
            XCTFail("nothing is connected")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .notConnected)
        } catch {
            XCTFail("\(error)")
        }
    }

    func testOnlyTheWatchSideCapabilityIsLive() {
        let status = runtime().features.status()
        XCTAssertEqual(status.count, Inert.phoneFeatures().count, "same shape as PhoneFeatures in HuaweiWearPhone.types.ts")
        for key in ["findPhoneEnabled", "callsEnabled", "callControlEnabled", "readPhoneState", "readCallLog", "readContacts", "callerIdSupported", "answerPhoneCalls"] {
            XCTAssertEqual(status[key] as? Bool, false, key)
        }
    }
}

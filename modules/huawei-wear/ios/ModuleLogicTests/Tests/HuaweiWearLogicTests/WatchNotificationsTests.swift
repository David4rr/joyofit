import XCTest
@testable import HuaweiWearLogic

/// Answers every write with an empty 02/04 acknowledgment and records the requests (transactions are not encrypted here).
private final class AckSink: FrameSink, @unchecked Sendable {
    private let lock = NSLock()
    private var _writes: [[Bytes]] = []
    weak var session: HuaweiSession?
    var writes: Int { lock.locked { _writes.count } }

    func write(_ frames: [Bytes]) async throws {
        lock.locked { _writes.append(frames) }
        var frame = Bytes([huaweiMagic])
        frame.appendBE(UInt16(2 + 1))
        frame.append(0x00)
        frame.append(0x02)
        frame.append(0x04)
        frame.appendBE(CRC16.checksum(frame))
        session?.onData(frame)
    }
}

final class WatchNotificationsTests: XCTestCase {
    private func harness(supportsSwitch: Bool = true) -> (LinkHandle, AckSink, RecordingEvents) {
        let sink = AckSink()
        let session = HuaweiSession(sink: sink, log: { _ in })
        session.params.transactionsCrypted = false
        sink.session = session
        let caps = DeviceCaps()
        caps.supportedCommands = supportsSwitch ? [0x02: [0x01, 0x04]] : [0x02: [0x01]]
        return (LinkHandle(address: "A", session: session, caps: caps, operationLock: AsyncLock()), sink, RecordingEvents())
    }

    private func notifications(_ events: WearEvents, defaults: UserDefaults? = nil) -> (WatchNotifications, WatchNotificationSettings) {
        let runtime = WearRuntime(
            settings: WearSettings(defaults: ephemeralDefaults()), syncStore: SyncStore(url: temporaryDatabaseURL()),
            deviceStore: DeviceStore(secrets: MemorySecretStore()), gate: AlwaysReadyGate(),
            environment: .init(app: "app 1 (1)", phone: "Apple test"), phoneModel: "test",
            transportFactory: { request, delegate in FakeTransport(.hangConnect, request: request, delegate: delegate) }
        )
        let settings = WatchNotificationSettings(defaults: defaults ?? ephemeralDefaults())
        return (WatchNotifications(link: runtime.link, events: events, settings: settings), settings)
    }

    func testTheSwitchRequestReachesTheWatchAndIsAcknowledged() async throws {
        let (handle, sink, events) = harness()
        let sent = try await WatchNotifications.send(handle: handle, enabled: true, log: events.sink)
        XCTAssertTrue(sent)
        XCTAssertEqual(sink.writes, 1)
        XCTAssertTrue(events.messages().contains("NotificationState: on"))
    }

    func testAWatchWithoutTheCommandIsNotSentIt() async throws {
        let (handle, sink, events) = harness(supportsSwitch: false)
        let sent = try await WatchNotifications.send(handle: handle, enabled: true, log: events.sink)
        XCTAssertFalse(sent)
        XCTAssertEqual(sink.writes, 0)
    }

    func testNothingIsSentOnConnectUntilTheUserHasChosen() async {
        let (handle, sink, events) = harness()
        let (feature, settings) = notifications(events)
        XCTAssertNil(settings.enabled)
        await feature.linkConnected(handle)
        XCTAssertEqual(sink.writes, 0)
        XCTAssertTrue(events.messages().contains { $0.contains("left as it is") })

        settings.enabled = false
        await feature.linkConnected(handle)
        XCTAssertEqual(sink.writes, 1, "a saved choice, even off, is applied like Android's init does")
        XCTAssertTrue(events.messages().contains("NotificationState: off"))
    }

    func testTheChoiceIsStoredEvenWithoutAWatch() async throws {
        let (feature, settings) = notifications(RecordingEvents())
        try await feature.setEnabled(true)
        XCTAssertEqual(settings.enabled, true)
        XCTAssertEqual(feature.access()["enabled"] as? Bool, true)
        XCTAssertEqual(feature.access()["granted"] as? Bool, false, "no connection, no ANCS authorization")
    }

    func testAccessShapeIsTheAndroidOne() {
        let (feature, _) = notifications(RecordingEvents())
        XCTAssertEqual(Set(feature.access().keys), Set(Inert.notificationAccess().keys))
    }
}

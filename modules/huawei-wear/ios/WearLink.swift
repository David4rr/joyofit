// The single active session to a watch: BLE transport + packet session + auth/init/sync, and the LinkState machine JS observes.
// Port of WearLink.kt. At most one Connection exists; every failure while connecting (including every authentication failure) tears it
// down. The JS module and the background controller both drive this one instance.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// What the profile sender and the sync need from the live connection.
public struct LinkHandle: Sendable {
    public let address: String
    public let session: HuaweiSession
    public let caps: DeviceCaps
    /// Held by syncs, battery reads and profile sends, which must not interleave on the one session.
    public let operationLock: AsyncLock
}

public final class WearLink: @unchecked Sendable {
    private let events: WearEvents
    private let settings: WearSettings
    private let syncStore: SyncStore
    private let store: DeviceStore
    private let gate: BluetoothGate
    private let transportFactory: TransportFactory
    private let phoneModel: String
    /// Clock for the sync window; tests replace it.
    private let now: @Sendable () -> Date

    private let lock = NSLock()
    private var current: Connection?
    private var state: LinkState = .disconnected
    private var _lastDeviceInfo: WatchDeviceInfo?
    private var _lastAttemptName: String?
    private var _lastCaps: DeviceCaps?

    /// The last watch this process connected to, as `connect` returned it; kept after it disconnects (support report).
    public var lastDeviceInfo: WatchDeviceInfo? { lock.locked { _lastDeviceInfo } }
    /// The Bluetooth name of the watch of the last connect attempt, successful or not (support report).
    public var lastAttemptName: String? { lock.locked { _lastAttemptName } }
    /// The capabilities the last connected watch reported (support report).
    public var lastCaps: DeviceCaps? { lock.locked { _lastCaps } }

    public init(
        events: WearEvents,
        settings: WearSettings,
        syncStore: SyncStore,
        deviceStore: DeviceStore,
        gate: BluetoothGate,
        phoneModel: String,
        transportFactory: @escaping TransportFactory,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.events = events
        self.settings = settings
        self.syncStore = syncStore
        self.store = deviceStore
        self.gate = gate
        self.phoneModel = phoneModel
        self.transportFactory = transportFactory
        self.now = now
    }

    // MARK: connection record

    fileprivate final class Connection: WatchTransportDelegate, @unchecked Sendable {
        let address: String
        let model: ModelMatch
        let deviceType: HuaweiDeviceType
        let caps = DeviceCaps()
        let operationLock = AsyncLock()
        /// Completes when this connect attempt finishes, so a second caller for the same watch can join it.
        let ready = OneShot<WatchDeviceInfo>()
        let mode: ConnectMode
        weak var link: WearLink?

        // Guarded by the link's lock.
        var closed = false
        var closeCause: WearError?
        var info: WatchDeviceInfo?
        var handle: LinkHandle?
        /// True while a background connect waits for the watch: the state stays `disconnected` until the OS link is up.
        var waiting = false

        var transport: WatchTransport!
        var session: HuaweiSession!

        init(address: String, model: ModelMatch, mode: ConnectMode, link: WearLink) {
            self.address = address
            self.model = model
            self.deviceType = model.deviceType
            self.mode = mode
            self.link = link
        }

        func transportDidReceive(_ chunk: Bytes) { session?.onData(chunk) }
        func transportDidClose(_ cause: WearError) { link?.onRemoteClosed(self, cause) }
        func transportLog(_ message: String) { link?.events.info(message) }
    }

    fileprivate enum Registration {
        case alreadyConnected(WatchDeviceInfo)
        case join(Connection)
        case start(Connection, replacing: Connection?, name: String?)
    }

    // MARK: state

    public func currentState() -> LinkState { lock.locked { state } }

    /// The live connection for sending profile data; nil unless connected.
    public func handle() -> LinkHandle? {
        lock.locked {
            guard let connection = current, !connection.closed, state == .connected || state == .syncing else { return nil }
            return connection.handle
        }
    }

    /// The connected watch, as `connect` returned it; nil unless connected.
    public func deviceInfo() -> WatchDeviceInfo? {
        lock.locked {
            guard let connection = current, state == .connected || state == .syncing else { return nil }
            return connection.info
        }
    }

    /// Whether iOS shares the iPhone's notifications with the connected watch (ANCS); nil unless connected or unknown.
    public func ancsAuthorized() -> Bool? {
        lock.locked {
            guard let connection = current, !connection.closed, state == .connected || state == .syncing else { return nil }
            return connection.transport?.ancsAuthorized
        }
    }

    /// True until a HiChain bind with `address` has completed; a first bind needs the user to confirm on the watch.
    public func needsBind(_ address: String) -> Bool {
        store.forDevice(address).isFirstConnection
    }

    // MARK: connect

    /// Decides under the lock whether this call starts a connection, joins one in progress or returns the live one.
    fileprivate func register(address: String, mode: ConnectMode) throws -> Registration {
        try lock.locked {
            var replacing: Connection?
            if let existing = current {
                if existing.address == address {
                    if let info = existing.info, state == .connected || state == .syncing { return .alreadyConnected(info) }
                    if existing.waiting && !existing.closed && mode == .interactive {
                        // The user asked while the background session waited for the watch: this attempt replaces the wait.
                        replacing = existing
                    } else if existing.info == nil && !existing.closed {
                        // Another caller (the background controller or JS) is already connecting to this watch.
                        return .join(existing)
                    }
                }
                if replacing == nil {
                    throw WearError(.busy, "Already \(state.rawValue) with \(existing.address); disconnect before connecting again")
                }
            }
            let name: String?
            if let remembered = settings.watchAddress, remembered.caseInsensitiveCompare(address) == .orderedSame {
                name = settings.watchName
            } else {
                name = nil
            }
            let match = WatchModels.match(name)
            if !match.connectable {
                throw WearError(.unsupported, "\(name ?? address): \(match.reason ?? "not supported")")
            }
            let connection = Connection(address: address, model: match, mode: mode, link: self)
            connection.waiting = mode == .background
            _lastAttemptName = name
            current = connection
            state = mode == .interactive ? .connecting : .disconnected
            return .start(connection, replacing: replacing, name: name)
        }
    }

    /// Opens the link, authenticates, initializes and remembers the watch. Resolves with the watch once `connected`.
    @discardableResult
    public func connect(_ rawAddress: String, mode: ConnectMode = .interactive) async throws -> WatchDeviceInfo {
        let address = DeviceStore.normalize(rawAddress)
        guard UUID(uuidString: address) != nil else {
            throw WearError(.invalidAddress, "'\(rawAddress)' is not a Bluetooth peripheral identifier")
        }
        try await gate.requireReady()

        let connection: Connection
        let name: String?
        switch try register(address: address, mode: mode) {
        case .alreadyConnected(let info):
            return info
        case .join(let joined):
            return try await joined.ready.value()
        case .start(let started, let replacing, let remembered):
            connection = started
            name = remembered
            if let replacing { teardown(replacing, cause: WearError(.disconnected, "Superseded by a connect from the app"), error: nil, report: false) }
        }
        let match = connection.model

        let log = events.sink
        let request = TransportRequest(address: address, rememberedName: name, newHonorProtocol: match.newHonorProtocol, mode: mode)
        let transport = transportFactory(request, connection)
        connection.transport = transport
        let session = HuaweiSession(sink: transport, log: log)
        session.params.transactionsCrypted = match.crypted
        // GB HuaweiSupportProvider: the AW70 bands send their workout records with their own layout.
        session.params.isAW = connection.deviceType == .aw
        connection.session = session

        do {
            if mode == .background {
                events.info("Waiting for \(name ?? address) to come into range (pending connect)")
                try await transport.waitForWatch()
                let stillCurrent: Bool = lock.locked {
                    let ok = current === connection && !connection.closed
                    if ok {
                        connection.waiting = false
                        state = .connecting
                    }
                    return ok
                }
                if !stillCurrent { throw lock.locked { connection.closeCause } ?? WearError(.disconnected, "Disconnected while waiting for the watch") }
            }
            events.state(.connecting, error: nil)
            events.info(
                "Connecting to \(address) \"\(name ?? "no name")\": \(match.model?.name ?? "unknown model") (\(match.support.rawValue)), " +
                    "Bluetooth LE GATT (\(match.newHonorProtocol ? "Honor service" : "service 0xFE86")), device type \(connection.deviceType), encrypted \(match.crypted)"
            )

            try await transport.connect(timeoutMs: Timeouts.connectMs)
            events.info("Bluetooth LE (GATT) connected")
            // With no remembered name the model is matched on the name the watch advertised.
            if name == nil, let seen = transport.peripheralName {
                let seenMatch = WatchModels.match(seen)
                if !seenMatch.connectable { throw WearError(.unsupported, "\(seen): \(seenMatch.reason ?? "not supported")") }
            }

            try setState(connection, .authenticating)
            let identity = store.forDevice(address)
            let authenticator = HuaweiAuthenticator(
                session: session, identity: identity, log: log, deviceType: connection.deviceType, phoneModel: phoneModel
            )
            // A first bind replaces the watch's one stored credential (an Android phone bound to it loses its binding), so it only ever
            // runs from a connect the user asked for; a background reconnect that finds the watch does not know this phone stops here.
            let authMode = try await authenticator.authenticate(firstBindAllowed: mode == .interactive)

            try setState(connection, .initializing)
            let bondedName = transport.peripheralName ?? name
            let result = try await HuaweiInitializer(
                session: session, caps: connection.caps, log: log, bondedName: bondedName,
                protocolVersion: authenticator.protocolVersion, profile: settings.profile, deviceType: connection.deviceType
            ).run()

            let finalName = bondedName ?? result.deviceName ?? address
            let finalMatch = WatchModels.match(finalName)
            let model = finalMatch.model != nil ? finalMatch : match
            let info = WatchDeviceInfo(
                address: address, name: finalName, productModel: result.productModel, softwareVersion: result.softwareVersion,
                hardwareVersion: result.hardwareVersion, serialNumber: result.serialNumber, batteryLevel: result.batteryLevel,
                authMode: authMode, model: model.model?.name, support: model.support
            )

            let lost: Bool = lock.locked {
                if connection.closed || current !== connection { return true }
                connection.info = info
                _lastDeviceInfo = info
                _lastCaps = connection.caps
                connection.handle = LinkHandle(address: address, session: session, caps: connection.caps, operationLock: connection.operationLock)
                state = .connected
                return false
            }
            if lost { throw WearError(.disconnected, "Disconnected while connecting") }

            rememberWatch(address: address, name: finalName, info: info)
            events.state(.connected, error: nil)
            if let level = result.batteryLevel { events.battery(level) }
            connection.ready.complete(.success(info))
            return info
        } catch {
            if error is CancellationError {
                teardown(connection, cause: WearError(.disconnected, "Connect cancelled"), error: nil)
                throw error
            }
            // Closed under us (user disconnect, watch dropped the link): report what closed it rather than the I/O error that followed. A
            // protocol-level failure of the operation itself wins.
            let closeCause = lock.locked { connection.closeCause }
            let wear = error as? WearError
            let failure: WearError
            if let closeCause, wear == nil || wear!.code == .disconnected || wear!.code == .connectFailed {
                failure = closeCause
            } else if let wear {
                failure = wear
            } else {
                failure = WearError(.connectFailed, "Connect failed: \(error)", underlying: error)
            }
            if mode == .background && failure.isFirstBindNeeded {
                events.error(
                    "Background reconnect stopped: the watch does not know this phone (\(failure.message)). Not binding in the background: " +
                        "a bind replaces the watch's one stored credential. Connect to the watch from the app to bind it."
                )
            }
            events.error("Connect failed [\(failure.code.rawValue)]: \(failure.message)")
            teardown(connection, cause: failure, error: failure.message)
            throw failure
        }
    }

    /// The watch becomes the one background mode follows, and gets its row in the shared database.
    private func rememberWatch(address: String, name: String, info: WatchDeviceInfo) {
        settings.watchAddress = address
        settings.watchName = name
        do {
            try syncStore.upsertDevice(address: address, name: name, productModel: info.productModel, softwareVersion: info.softwareVersion)
        } catch {
            events.error("Could not store the watch in the database: \(error)")
        }
    }

    // MARK: disconnect / teardown

    public func disconnect() {
        guard let connection = lock.locked({ current }) else { return }
        events.info("Disconnecting from \(connection.address)")
        teardown(connection, cause: WearError(.disconnected, "Disconnected"), error: nil)
    }

    /// JS reload / module destroy: close without telling JS.
    public func shutdown() { disconnect() }

    public func forget(_ rawAddress: String) {
        let address = DeviceStore.normalize(rawAddress)
        if let connection = lock.locked({ current }), connection.address == address {
            teardown(connection, cause: WearError(.disconnected, "Device forgotten"), error: nil)
        }
        store.forget(address)
        events.info("Forgot \(address): stored auth key and fake identity cleared")
    }

    fileprivate func onRemoteClosed(_ connection: Connection, _ cause: WearError) {
        let reason = "Connection lost: \(cause.message)"
        events.error(reason)
        teardown(connection, cause: WearError(.disconnected, reason, underlying: cause), error: reason)
    }

    /// Idempotent. Fails in-flight requests with `cause`; reports `disconnected` with `error` to JS.
    private func teardown(_ connection: Connection, cause: WearError, error: String?, report: Bool = true) {
        let first: Bool = lock.locked {
            if connection.closed { return false }
            connection.closed = true
            connection.closeCause = cause
            return true
        }
        guard first else { return }

        connection.ready.complete(.failure(cause))
        if let session = connection.session {
            Task { await session.close(cause) }
        }
        connection.transport?.close()

        let (wasCurrent, wasWaiting): (Bool, Bool) = lock.locked {
            let waiting = connection.waiting
            if current === connection {
                current = nil
                state = .disconnected
                return (true, waiting)
            }
            return (false, waiting)
        }
        // A background connect that never got past the wait never reported a state: there is nothing to take back.
        if wasCurrent && report && !wasWaiting { events.state(.disconnected, error: error) }
    }

    private func setState(_ connection: Connection, _ next: LinkState) throws {
        let failure: String? = lock.locked {
            if current !== connection || connection.closed { return "Disconnected while \(state.rawValue)" }
            state = next
            return nil
        }
        if let failure { throw WearError(.disconnected, failure) }
        events.state(next, error: nil)
    }

    // MARK: operations on a connected watch

    private func requireConnected() throws -> Connection {
        try lock.locked {
            guard let connection = current, state == .connected || state == .syncing else {
                throw WearError(.notConnected, "Not connected to a watch (state: \(state.rawValue))")
            }
            return connection
        }
    }

    public func refreshBattery() async throws -> Int {
        let connection = try requireConnected()
        return try await connection.operationLock.withLock {
            let level = try await connection.session.queryBattery(timeoutMs: Timeouts.queryMs)
            events.battery(level)
            return level
        }
    }

    /// Pulls sleep, steps and totals since the last stored sync, commits them to the shared database and reports a summary (also as
    /// `onSyncComplete`). The night-HRV and P2P phases of the Android sync are not ported.
    public func syncActivity() async throws -> SyncSummary {
        let connection = try requireConnected()
        if currentState() == .syncing { throw WearError(.busy, "A sync is already running") }
        let summary: SyncSummary = try await connection.operationLock.withLock {
            try beginSync(connection)
            events.state(.syncing, error: nil)
            do {
                let result = try await runSync(connection)
                restoreConnected(connection)
                return result
            } catch {
                restoreConnected(connection)
                throw error
            }
        }
        events.syncComplete(summary)
        return summary
    }

    private func beginSync(_ connection: Connection) throws {
        try lock.locked {
            if current !== connection || state != .connected {
                throw WearError(.notConnected, "Not connected to a watch (state: \(state.rawValue))")
            }
            state = .syncing
        }
    }

    private func restoreConnected(_ connection: Connection) {
        let restored: Bool = lock.locked {
            if current === connection && state == .syncing {
                state = .connected
                return true
            }
            return false
        }
        if restored { events.state(.connected, error: nil) }
    }

    private func runSync(_ connection: Connection) async throws -> SyncSummary {
        let address = connection.address
        let last = try storage { try syncStore.lastSync(address: address) }
        let from = syncWindowStart(lastSyncSec: last, nowSec: Int64(now().timeIntervalSince1970))
        let log = events.sink
        let session = connection.session!
        let caps = connection.caps
        let sync = ActivitySync(
            session: session, caps: caps, log: log,
            trueSleep: { since, end in try await SleepSync(session: session, caps: caps, log: log).sync(sinceSec: since, end: end) }
        )
        let result = try await sync.sync(fromSec: from)
        let stored = try storage { try syncStore.save(address: address, result: result) }
        let workouts = try await WorkoutPhase.run(
            session: session, caps: caps, syncStore: syncStore, events: events, nowSec: Int64(now().timeIntervalSince1970)
        )
        return stored.withWorkouts(workouts)
    }

    /// Database access; a failed read or write surfaces as ERR_STORAGE.
    private func storage<T>(_ block: () throws -> T) throws -> T {
        do {
            return try block()
        } catch let e as SQLiteError {
            throw WearError(.storage, "Database error: \(e.message)", underlying: e)
        }
    }
}

#endif

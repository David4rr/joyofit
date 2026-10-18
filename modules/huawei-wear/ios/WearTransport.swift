// What the link layer needs from a transport, so WearLink compiles and is tested on Linux without CoreBluetooth (BleTransport.swift is the
// CoreBluetooth implementation), plus the small concurrency helpers shared by the link layers.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

/// How a connect attempt waits for the watch.
public enum ConnectMode: Sendable {
    /// The user asked: scan if the remembered identifier fails, give up after the timeouts.
    case interactive
    /// The background session: a pending connect that iOS keeps open until the watch shows up (no scan, no timeout), then the usual steps.
    case background
}

public struct TransportRequest: Sendable {
    /// Upper case peripheral identifier (UUID string).
    public let address: String
    /// The Bluetooth name remembered for this watch (a scan matches its stem), when known.
    public let rememberedName: String?
    /// GB isNewHonorProtocol: Honor's own GATT service instead of 0xFE86 with FE01 and FE02.
    public let newHonorProtocol: Bool
    public let mode: ConnectMode

    public init(address: String, rememberedName: String?, newHonorProtocol: Bool, mode: ConnectMode) {
        self.address = address
        self.rememberedName = rememberedName
        self.newHonorProtocol = newHonorProtocol
        self.mode = mode
    }
}

/// What a transport reports back to the link that owns it. Called on a transport-owned queue; implementations must not block.
public protocol WatchTransportDelegate: AnyObject, Sendable {
    /// A notification payload (Kotlin `onData`), delivered in order.
    func transportDidReceive(_ chunk: Bytes)
    /// The link ended after `connect` returned and without `close()` having been called (Kotlin `onRemoteClosed`).
    func transportDidClose(_ cause: WearError)
    /// Connect progress for the support report (negotiated write size, services, write type).
    func transportLog(_ message: String)
}

/// A link to the watch that carries the packet stream: frames out through `FrameSink.write`, notification payloads in through the delegate.
public protocol WatchTransport: FrameSink {
    /// The Bluetooth name the watch showed while connecting (advertised or GATT name), once known.
    var peripheralName: String? { get }

    /// Background mode only: returns when the watch is in reach and the OS link is up, without any timeout (the caller cancels the task).
    /// The ordinary `connect` continues from there.
    func waitForWatch() async throws

    /// Opens the link, finds the characteristics and turns notifications on, all within `timeoutMs` (plus the scan, as in BleTransport.kt).
    func connect(timeoutMs: Int) async throws

    /// Idempotent; does not call the delegate's `transportDidClose`.
    func close()

    /// Whether iOS lets the watch read the iPhone's notifications over ANCS (`CBPeripheral.ancsAuthorized`); nil when the transport has no
    /// such notion or before the link is open.
    var ancsAuthorized: Bool? { get }

    /// The watch did not answer the first request after the link came up (LinkParams): `attempt` (2 or 3) is the try about to start.
    /// Change something about the link the earlier tries did not; returns a line saying what was done (the support log), nil when there is
    /// nothing different to try. Throws `.disconnected` when the link is gone.
    func recoverLink(beforeAttempt attempt: Int) async throws -> String?
}

extension WatchTransport {
    public var ancsAuthorized: Bool? { nil }
    public func recoverLink(beforeAttempt attempt: Int) async throws -> String? { nil }
}

/// The Bluetooth radio as the link sees it before a connect: ready, or a coded error (off, not permitted, missing).
public protocol BluetoothGate: Sendable {
    func requireReady() async throws
}

public struct AlwaysReadyGate: BluetoothGate {
    public init() {}
    public func requireReady() async throws {}
}

public typealias TransportFactory = @Sendable (_ request: TransportRequest, _ delegate: WatchTransportDelegate) -> WatchTransport

// MARK: concurrency helpers

/// A mutex for async code: `withLock` suspends instead of blocking, one holder at a time, in arrival order (Kotlin `Mutex`).
public final class AsyncLock: @unchecked Sendable {
    private let lock = NSLock()
    private var held = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    public init() {}

    public func acquire() async {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            lock.lock()
            if !held {
                held = true
                lock.unlock()
                c.resume()
            } else {
                waiters.append(c)
                lock.unlock()
            }
        }
    }

    public func release() {
        lock.lock()
        if waiters.isEmpty {
            held = false
            lock.unlock()
        } else {
            let next = waiters.removeFirst()
            lock.unlock()
            next.resume()
        }
    }

    public func withLock<T>(_ body: () async throws -> T) async rethrows -> T {
        await acquire()
        defer { release() }
        return try await body()
    }
}

/// One value delivered once; `value()` may be awaited before or after `complete` (Kotlin `CompletableDeferred`).
public final class OneShot<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<T, Error>?
    private var waiters: [CheckedContinuation<T, Error>] = []

    public init() {}

    public func complete(_ r: Result<T, Error>) {
        lock.lock()
        if result != nil { lock.unlock(); return }
        result = r
        let pending = waiters
        waiters = []
        lock.unlock()
        for c in pending { c.resume(with: r) }
    }

    public func value() async throws -> T {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<T, Error>) in
            lock.lock()
            if let r = result {
                lock.unlock()
                c.resume(with: r)
            } else {
                waiters.append(c)
                lock.unlock()
            }
        }
    }
}

/// Runs `body` and gives up with `onTimeout` after `ms` milliseconds (Kotlin `withTimeout`); the body is cancelled.
public func withDeadline<T: Sendable>(ms: Int, onTimeout: @escaping @Sendable () -> Error, _ body: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await body() }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(max(ms, 0)) * 1_000_000)
            throw onTimeout()
        }
        defer { group.cancelAll() }
        guard let first = try await group.next() else { throw CancellationError() }
        return first
    }
}

extension NSLock {
    /// `lock()`/`unlock()` around a synchronous body. Async code calls this instead of `lock()` directly, which the Swift 6 toolchain flags
    /// as unavailable from asynchronous contexts. (`NSLocking.withLock` needs iOS 16.)
    @inline(__always)
    public func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}

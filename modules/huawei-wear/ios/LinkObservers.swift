// Features that act on a live session (subscribe to watch-initiated packets, run timers while connected) register here and are told when a
// session appears and when the link drops. The runtime calls `connected` on every `connected` state event; a sync ending also reports
// `connected`, so the same session is announced once.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public protocol LinkObserver: AnyObject, Sendable {
    /// A new session is ready (after authentication and init). Subscribe to pushed packets here. Runs on its own task.
    func linkConnected(_ handle: LinkHandle) async
    /// The link is gone; its subscriptions died with the session.
    func linkDisconnected()
}

public final class LinkObservers: @unchecked Sendable {
    private let lock = NSLock()
    private var observers: [(token: UUID, observer: LinkObserver)] = []
    private var announced: HuaweiSession?

    public init() {}

    @discardableResult
    public func add(_ observer: LinkObserver) -> UUID {
        let token = UUID()
        lock.locked { observers.append((token, observer)) }
        return token
    }

    public func remove(_ token: UUID) { lock.locked { observers.removeAll { $0.token == token } } }

    /// Announces `handle`'s session to every observer unless it was announced before. Returns the observers' tasks (tests await them).
    @discardableResult
    public func connected(_ handle: LinkHandle) -> [Task<Void, Never>] {
        let targets: [LinkObserver] = lock.locked {
            if let announced, announced === handle.session { return [] }
            announced = handle.session
            return observers.map(\.observer)
        }
        return targets.map { observer in Task { await observer.linkConnected(handle) } }
    }

    public func disconnected() {
        let targets: [LinkObserver] = lock.locked {
            if announced == nil { return [] }
            announced = nil
            return observers.map(\.observer)
        }
        for observer in targets { observer.linkDisconnected() }
    }
}

#endif

// Port of the parts of PhoneFeatures.kt that exist on iOS: find my watch (phone to watch). Find my phone, calls and call control need
// Android-only permissions and receivers and have no iOS counterpart.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class PhoneFeatures: LinkObserver, @unchecked Sendable {
    private let link: WearLink
    private let events: WearEvents
    private let lock = NSLock()
    private var subscription: (session: HuaweiSession, id: Int)?

    public init(link: WearLink, events: WearEvents) {
        self.link = link
        self.events = events
    }

    // MARK: LinkObserver

    public func linkConnected(_ handle: LinkHandle) async {
        let id = await FindWatch.attach(session: handle.session, log: events.sink)
        lock.locked { subscription = (handle.session, id) }
    }

    public func linkDisconnected() { lock.locked { subscription = nil } }

    // MARK: find my watch

    /// Rings (`true`) or stops (`false`) the connected watch.
    public func findWatch(_ start: Bool) async throws {
        guard let handle = link.handle() else { throw WearError(.notConnected, "Not connected to a watch") }
        try await FindWatch.send(session: handle.session, caps: handle.caps, log: events.sink, start: start)
    }

    /// `PhoneFeatures` of HuaweiWearPhone.types.ts: only the watch-side capability is live on iOS.
    public func status() -> [String: Any] {
        var status = Inert.phoneFeatures()
        status["findWatchSupported"] = link.handle().map { FindWatch.supported($0.caps) } ?? false
        return status
    }
}

#endif

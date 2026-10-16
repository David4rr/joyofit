// The morning sleep report (see SleepReport): pushed once after the first sync that stored a night ending today. Port of SleepReportFeature
// (SleepAndDstFeatures.kt). Never sends while the switch is off, the watch lacks ExpandCapability 84 or no watch is connected.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class SleepReportFeature: DataSyncFeature, @unchecked Sendable {
    public let name = "sleep-report"
    private static let lookbackSec: Int64 = 36 * 3600

    private let settings: WatchExtrasSettings
    private let syncStore: SyncStore
    private let events: WearEvents
    private let zone: @Sendable () -> TimeZone
    private let locale: @Sendable () -> (language: String?, country: String?)
    private let now: @Sendable () -> Date
    private let lock = NSLock()
    private var service: DataSyncService?

    public init(
        settings: WatchExtrasSettings, syncStore: SyncStore, events: WearEvents,
        zone: @escaping @Sendable () -> TimeZone = { TimeZone.current },
        locale: @escaping @Sendable () -> (language: String?, country: String?) = {
            (Locale.current.language.languageCode?.identifier, Locale.current.region?.identifier)
        },
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.settings = settings
        self.syncStore = syncStore
        self.events = events
        self.zone = zone
        self.locale = locale
        self.now = now
    }

    private func log(_ message: String) { events.info(message) }

    public func register(service: DataSyncService) {
        lock.locked { self.service = service }
        service.onEvent(phonePkg: SleepReport.phonePackage, watchPkg: SleepReport.watchPackage, eventId: SleepReport.eventId) { [weak self] event in
            let shown = SleepReport.acknowledged(event.data)
            self?.log("Sleep report: the watch answers \(shown ? "shown" : "NOT shown") (data \(DataSyncWire.describe(event.data)), level \(event.level))")
        }
    }

    /// After every stored sync: a night in it may be the one to report. Returns the task (tests await it).
    @discardableResult
    public func onSyncComplete(_ summary: SyncSummary) -> Task<Void, Never>? {
        if summary.sleep <= 0 { return nil }
        return Task { [self] in
            do {
                _ = try await push(force: false)
            } catch is CancellationError {
                return
            } catch {
                events.error("Sleep report: \(error)")
            }
        }
    }

    /// The newest night with stages, from the stored segments of the last 36 hours.
    private func latestNight(nowSec: Int64) throws -> SleepNight? {
        let segments = try syncStore.read { db in
            try db.query("SELECT start, end, type, stage FROM sleep_segments WHERE end >= ? ORDER BY start", [.int(nowSec - Self.lookbackSec)]) {
                SleepSegment(start: $0.int64(0), end: $0.int64(1), type: $0.int(2), stage: $0.isNull(3) ? nil : $0.text(3))
            }
        }
        return SleepReport.lastNight(segments)
    }

    /// Pushes the report for the latest night. `force` skips the switch and the once-a-morning rules (the Settings "send now" button) but never
    /// the hardware gates. Returns a short description of what happened: "sent" or why not.
    public func push(force: Bool) async throws -> String {
        guard let service = lock.locked({ self.service }) else { return decision("not registered") }
        if !force && !settings.sleepReportEnabled { return decision("switched off in settings") }
        if !service.connected() { return decision("no watch connected") }
        if !service.supports(DataSyncWire.capEvent) {
            return decision("the watch does not report DataSync events (ExpandCapability \(DataSyncWire.capEvent))")
        }
        let zone = zone()
        let nowSec = Int64(now().timeIntervalSince1970)
        guard let night = try latestNight(nowSec: nowSec) else { return decision("no sleep stored in the last \(Self.lookbackSec / 3600) h") }
        if !force, let reason = SleepReport.shouldPush(night, nowSec: nowSec, zone: zone, lastReportedEnd: settings.sleepReportLastEnd) {
            return decision(reason)
        }
        let locale = locale()
        let message = SleepReport.message(night, zone: zone, language: locale.language, country: locale.country)
        log("Sleep report: sending \"\(message.description)\" (night \(night.start)..\(night.end), locale \(message.locale))")
        let sent = try await service.sendEvent(
            phonePkg: SleepReport.phonePackage, watchPkg: SleepReport.watchPackage, eventId: SleepReport.eventId,
            data: SleepReport.payload(message), level: 0, what: "sleep report"
        )
        if !sent { return decision("the send failed, see the lines above") }
        settings.sleepReportLastEnd = max(settings.sleepReportLastEnd, night.end)
        return "sent"
    }

    private func decision(_ reason: String) -> String {
        log("Sleep report: not sent, \(reason)")
        return reason
    }
}

#endif

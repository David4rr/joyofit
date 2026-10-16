// The menstrual calendar on the watch plus the log behind it. Port of MenstrualFeature.kt. Two transports, both modelled on Huawei Health
// 17.0.8.300 (see `MenstrualCodec`):
//  - classic service 0x32: switches, capability, update notice, the watch's requests for the modify time, the cycle list and the daily status
//    frames, all answered from `CycleModel`;
//  - DataSync dictionary 400018 (`hw.unitedevice.physiological` / `hw.watch.health.physiological`, ExpandCapability 173 and 174): the watch
//    asks for logged flow and cramps, the phone answers at most 10 rows.
//
// Off until the user enables it. While off the watch's 0x32 requests are answered with the "no data" error and nothing is pushed. Gated on
// SupportedCommands 0x32/01. Predictions are an average-cycle estimate. Registered both as a `DataSyncFeature` (the dictionary, the push after
// connect) and as a `LinkObserver` (the 0x32 subscriptions of a new session).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class MenstrualFeature: DataSyncFeature, LinkObserver, @unchecked Sendable {
    public let name = "menstrual"

    private static let dictPhonePkg = "hw.unitedevice.physiological"
    private static let dictWatchPkg = "hw.watch.health.physiological"
    private static let dayMs: Int64 = 86_400_000
    private static let tenDaysMs: Int64 = 10 * dayMs
    private static let historyMs: Int64 = 60 * dayMs
    private static let overviewDays = 120

    private let settings: CycleSettings
    private let store: CycleStore
    private let link: LinkHandleSource
    private let events: WearEvents
    private let now: @Sendable () -> Date
    private let zone: @Sendable () -> TimeZone
    private let lock = NSLock()
    private var service: DataSyncService?
    private var tasks: [UUID: Task<Void, Never>] = [:]
    /// The daily frames the watch is paging through: the key days at the time of its `06` request, and the frame size.
    private var frames: (days: [(day: CivilDate, status: Int)], size: Int) = ([], 0)

    public init(
        settings: CycleSettings, store: CycleStore, link: LinkHandleSource, events: WearEvents,
        now: @escaping @Sendable () -> Date = { Date() }, zone: @escaping @Sendable () -> TimeZone = { TimeZone.current }
    ) {
        self.settings = settings
        self.store = store
        self.link = link
        self.events = events
        self.now = now
        self.zone = zone
    }

    private func log(_ message: String) { events.info(message) }
    private func error(_ message: String) { events.error(message) }

    // MARK: DataSyncFeature

    public func register(service: DataSyncService) {
        lock.locked { self.service = service }
        service.onDictionary(phonePkg: Self.dictPhonePkg, watchPkg: Self.dictWatchPkg, dictId: MenstrualCodec.dictId) { [weak self] query in
            await self?.onDictionaryQuery(query)
        }
    }

    public func onConnected() async throws {
        if !settings.enabled {
            log("Menstrual: off in settings, nothing sent")
            return
        }
        await syncToWatch("connected")
    }

    // MARK: LinkObserver

    /// A new session: listen for the watch's own 0x32 requests.
    public func linkConnected(_ handle: LinkHandle) async {
        for command in [MenstrualCodec.cmdModifyTime, MenstrualCodec.cmdCycles, MenstrualCodec.cmdFrameCount, MenstrualCodec.cmdBodyStatus] {
            _ = await handle.session.subscribe(service: UInt8(MenstrualCodec.service), command: UInt8(command), label: "menstrual \(command)") { [weak self] packet in
                self?.onWatchPacket(command, packet)
            }
        }
    }

    public func linkDisconnected() {}

    // MARK: gates

    private var dataSync: DataSyncService? { lock.locked { service } }

    /// Why the calendar cannot be sent to the connected watch, or nil when it can.
    public func gate() -> String? {
        guard let handle = link.handle() else { return "no watch connected" }
        if !handle.caps.supports(MenstrualCodec.service, MenstrualCodec.cmdSwitches) {
            return "the watch does not list the menstrual service (0x32 command 01)"
        }
        return nil
    }

    private func expand(_ bit: Int) -> Bool { link.handle()?.caps.expandCapability(bit) ?? false }

    private var dictionary: Bool { expand(MenstrualCodec.capDictionary) && expand(DataSyncWire.capDict) }

    // MARK: phone -> watch

    private func hex2(_ v: Int) -> String { String(format: "%02x", v) }

    private func sendClassic(_ command: Int, _ body: HuaweiTLV, _ what: String) async throws {
        guard let handle = link.handle() else { return log("Menstrual \(what): not sent, no connected watch") }
        log("Menstrual \(what): send 0x32/\(hex2(command))")
        try await handle.session.send(Menstrual.message(commandId: UInt8(command), body: body), label: "Menstrual \(what)")
    }

    private func bitfield() -> Int { settings.switches.bitfield(includeEasyPregnancy: expand(MenstrualCodec.capEasyPregnancySwitch)) }

    /// Capability, switches, then the update notice that makes the watch ask again; flow and cramps go as dictionary rows when the watch has
    /// ExpandCapability 173 and 174 (the last 60 days in 10-day windows, at most 10 rows each).
    public func syncToWatch(_ reason: String) async {
        if !settings.enabled { return log("Menstrual: sync (\(reason)) skipped, off in settings") }
        if let why = gate() { return log("Menstrual: sync (\(reason)) skipped, \(why)") }
        do {
            let dict = dictionary
            log("Menstrual: sync to the watch (\(reason)); dictionary \(dict ? "yes (ExpandCapability 174 and 173)" : "no")")
            try await sendClassic(MenstrualCodec.cmdCapability, MenstrualCodec.capability(dictionarySupported: dict), "capability")
            try await sendClassic(MenstrualCodec.cmdSwitches, MenstrualCodec.switches(bitfield()), "switches")
            try await sendClassic(MenstrualCodec.cmdUpdateNotice, MenstrualCodec.updateNotice(), "update notice")
            if dict {
                let nowMs = Int64(now().timeIntervalSince1970 * 1000)
                try await pushDictionary(fromMs: nowMs - Self.historyMs, toMs: nowMs, modifyMs: 0)
            }
        } catch is CancellationError {
            return
        } catch {
            self.error("Menstrual: sync (\(reason)) failed: \(error)")
        }
    }

    /// Turns the master reminder switch off on the watch when the feature is disabled (best effort).
    public func sendDisabled() async {
        if let why = gate() { return log("Menstrual: master switch not cleared on the watch, \(why)") }
        do {
            var off = settings.switches
            off.master = false
            try await sendClassic(MenstrualCodec.cmdSwitches, MenstrualCodec.switches(off.bitfield(includeEasyPregnancy: expand(MenstrualCodec.capEasyPregnancySwitch))), "switches (off)")
        } catch is CancellationError {
            return
        } catch {
            self.error("Menstrual: could not clear the switches: \(error)")
        }
    }

    // MARK: watch -> phone (0x32). Runs on the session's executor: parse, then hand off.

    private func onWatchPacket(_ command: Int, _ packet: HuaweiPacket) {
        guard let tlv = packet.tlv else {
            error("Menstrual 0x32/\(hex2(command)): the watch's packet has no readable TLV")
            return
        }
        log("Menstrual: watch asks 0x32/\(hex2(command)) tlv=\(tlv)")
        spawn { [self] in
            do {
                try await answer(command, tlv)
            } catch is CancellationError {
                return
            } catch {
                self.error("Menstrual 0x32/\(hex2(command)): \(error)")
            }
        }
    }

    private func answer(_ command: Int, _ tlv: HuaweiTLV) async throws {
        if !settings.enabled {
            log("Menstrual 0x32/\(hex2(command)): off in settings, answering with no data")
            try await sendClassic(command, MenstrualCodec.noData(), "no data")
            return
        }
        let zone = zone()
        let instant = now()
        let today = CivilDate.day(of: instant, in: zone)
        switch command {
        case MenstrualCodec.cmdModifyTime:
            let modified = try store.lastModified()
            try await sendClassic(command, MenstrualCodec.modifyTime(modified), "modify time \(modified.map(String.init) ?? "none")")
        case MenstrualCodec.cmdCycles:
            guard let request = MenstrualCodec.parseCycleRequest(tlv) else {
                return log("Menstrual 0x32/03: the watch sent an error or no request, not answered")
            }
            let model = CycleModel(periods: try store.periods(), today: today)
            let modified = try store.lastModified() ?? 0
            let entries = model.entries(history: request.historyCycles, future: request.futureCycles)
            log("Menstrual 0x32/03: history=\(request.historyCycles) future=\(request.futureCycles) flags 0a=\(request.tag0a) 0b=\(request.tag0b) 0c=\(request.tag0c): \(entries.count) cycle(s), cycle \(model.averageCycleDays) d, period \(model.averagePeriodDays) d")
            try await sendClassic(
                command,
                MenstrualCodec.cycleList(
                    entries: entries, request: request, nowSec: Int64(instant.timeIntervalSince1970), modifiedSec: modified,
                    averageCycleDays: model.averageCycleDays, averagePeriodDays: model.averagePeriodDays, zone: zone
                ),
                "cycle list"
            )
        case MenstrualCodec.cmdFrameCount:
            guard let request = MenstrualCodec.parseFrameRequest(tlv) else {
                return log("Menstrual 0x32/06: the watch sent an error, not answered")
            }
            let model = CycleModel(periods: try store.periods(), today: today)
            let days = model.keyDays(historyDays: request.historyDays, futureDays: request.futureDays)
            lock.locked { frames = (days: days, size: request.frameSize) }
            let count = MenstrualCodec.frameCount(days.count, frameSize: request.frameSize)
            log("Menstrual 0x32/06: history=\(request.historyDays) d future=\(request.futureDays) d frame=\(request.frameSize): \(days.count) key day(s), \(count) frame(s)")
            try await sendClassic(command, MenstrualCodec.frameCountAnswer(count), "frame count \(count)")
        case MenstrualCodec.cmdBodyStatus:
            let index = MenstrualCodec.parseBodyStatusRequest(tlv)
            let current = lock.locked { frames }
            let days = current.days, size = current.size
            guard let index, let frame = MenstrualCodec.bodyStatusFrame(index: index, days: days, frameSize: size, zone: zone) else {
                return log("Menstrual 0x32/07: no frame \(index.map(String.init) ?? "nil") (have \(days.count) day(s), frame size \(size)), not answered")
            }
            try await sendClassic(command, frame, "frame \(index)")
        default:
            break
        }
    }

    // MARK: DataSync dictionary 400018

    private func onDictionaryQuery(_ query: DictQuery) async {
        if !settings.enabled { return log("Menstrual: dictionary \(query.dictId) query ignored, off in settings") }
        if query.rows.contains(where: { !$0.values.isEmpty }) {
            log("Menstrual: the watch sent edited flow values in dictionary \(query.dictId); Huawei Health only reads the time window, JoyoFit does too")
        }
        let zone = zone()
        let start = query.startMs ?? 0
        let end = query.endMs ?? 0
        let modify = query.modifyMs ?? 0
        do {
            let since = CivilDate.day(of: Date(timeIntervalSince1970: Double(max(start, 0)) / 1000), in: zone)
            let days = try store.days(since: since)
            let rows = MenstrualCodec.dictionaryRows(days: days, startMs: start, endMs: end, modifyMs: modify, zone: zone)
            log("Menstrual: dictionary \(query.dictId) query start=\(start) end=\(end) modify=\(modify): \(rows.count) row(s) of \(days.count) logged day(s)")
            if rows.isEmpty { return }
            _ = try await dataSync?.sendDictionary(phonePkg: query.phonePkg, watchPkg: query.watchPkg, dictType: MenstrualCodec.dictId, rows: rows, what: "menstrual flow")
        } catch is CancellationError {
            return
        } catch {
            self.error("Menstrual: dictionary \(query.dictId) answer failed: \(error)")
        }
    }

    /// Proactive push as Huawei Health does: 10-day windows from `fromMs` to `toMs`.
    private func pushDictionary(fromMs: Int64, toMs: Int64, modifyMs: Int64) async throws {
        let zone = zone()
        let days = try store.days(since: CivilDate.day(of: Date(timeIntervalSince1970: Double(fromMs) / 1000), in: zone))
        var windowStart = fromMs
        while windowStart < toMs {
            let windowEnd = windowStart + Self.tenDaysMs
            let rows = MenstrualCodec.dictionaryRows(days: days, startMs: windowStart, endMs: windowEnd, modifyMs: modifyMs, zone: zone)
            if !rows.isEmpty {
                _ = try await dataSync?.sendDictionary(phonePkg: Self.dictPhonePkg, watchPkg: Self.dictWatchPkg, dictType: MenstrualCodec.dictId, rows: rows, what: "menstrual flow push")
            }
            windowStart = windowEnd
        }
    }

    // MARK: JS side

    private func today() -> CivilDate { CivilDate.day(of: now(), in: zone()) }

    private func nowSec() -> Int64 { Int64(now().timeIntervalSince1970) }

    /// Everything the Cycle screen shows (`CycleOverview`).
    public func overview() throws -> [String: Any] {
        let today = today()
        let periods = try store.periods()
        let model = CycleModel(periods: periods, today: today)
        let days = try store.days(since: today.minusDays(Self.overviewDays))
        let predictions: [[String: Any]] = model.predictedStarts(CycleModel.predictedCycles).map { start in
            let ovulation = start.minusDays(CycleModel.lutealDays)
            return [
                "start": start.description,
                "end": start.plusDays(model.averagePeriodDays - 1).description,
                "fertileStart": ovulation.minusDays(CycleModel.fertileBefore).description,
                "fertileEnd": ovulation.plusDays(CycleModel.fertileAfter).description,
                "ovulation": ovulation.description,
            ]
        }
        let switches = settings.switches
        let unsupported = gate()
        return [
            "today": today.description,
            "enabled": settings.enabled,
            "periods": periods.map { ["start": $0.start.description, "end": $0.end?.description ?? NSNull()] as [String: Any] },
            "days": days.map { ["day": $0.day.description, "flow": $0.flow, "cramps": $0.cramps] as [String: Any] },
            "predictions": predictions,
            "averageCycleDays": model.averageCycleDays,
            "averagePeriodDays": model.averagePeriodDays,
            "periodOngoing": model.periodOngoing,
            "daysLate": model.daysLate(),
            "switches": [
                "master": switches.master,
                "periodStart": switches.periodStart,
                "periodEnd": switches.periodEnd,
                "fertileStart": switches.fertileStart,
                "fertileEnd": switches.fertileEnd,
                "easyPregnancy": switches.easyPregnancy,
            ] as [String: Any],
            "watchConnected": link.handle() != nil,
            "watchSupported": unsupported == nil,
            "watchNote": unsupported ?? "the watch lists the menstrual service\(dictionary ? " and flow dictionary" : "")",
            "easyPregnancySwitch": expand(MenstrualCodec.capEasyPregnancySwitch),
        ]
    }

    public func setEnabled(_ enabled: Bool) {
        settings.enabled = enabled
        spawn { [self] in if enabled { await syncToWatch("enabled") } else { await sendDisabled() } }
    }

    public func setSwitches(_ switches: MenstrualCodec.Switches) {
        settings.switches = switches
        spawn { [self] in await syncToWatch("switches changed") }
    }

    private func changed(_ reason: String) { spawn { [self] in await syncToWatch(reason) } }

    private func refuse(_ message: String?) throws {
        if let message { throw WearError(.invalidArgument, message) }
    }

    public func startPeriod(_ day: String) throws {
        let date = try CycleLogRules.parseDay(day)
        try refuse(CycleLogRules.checkStart(try store.periods(), date, today()))
        try store.startPeriod(date, nowSec: nowSec())
        log("Cycle log: period started \(date)")
        changed("period started")
    }

    public func endPeriod(_ day: String) throws {
        let date = try CycleLogRules.parseDay(day)
        try refuse(CycleLogRules.checkEnd(try store.periods(), date, today()))
        try store.endPeriod(date, nowSec: nowSec())
        log("Cycle log: period ended \(date)")
        changed("period ended")
    }

    public func addPeriod(start: String, end: String) throws {
        let from = try CycleLogRules.parseDay(start)
        let to = try CycleLogRules.parseDay(end)
        try refuse(CycleLogRules.checkRange(try store.periods(), from, to, today()))
        try store.addPeriod(start: from, end: to, nowSec: nowSec())
        log("Cycle log: period added \(from)..\(to)")
        changed("period added")
    }

    public func deletePeriod(_ start: String) throws {
        let date = try CycleLogRules.parseDay(start)
        try store.deletePeriod(date)
        log("Cycle log: period \(date) deleted")
        changed("period deleted")
    }

    public func logDay(_ day: String, flow: Int, cramps: Int) throws {
        let date = try CycleLogRules.parseDay(day)
        try refuse(CycleLogRules.checkLevels(date, today(), flow: flow, cramps: cramps))
        try store.logDay(date, flow: flow, cramps: cramps, nowSec: nowSec())
        log("Cycle log: \(date) flow=\(flow) cramps=\(cramps)")
        changed("symptoms logged")
    }

    // MARK: background tasks

    private func spawn(_ body: @escaping @Sendable () async -> Void) {
        let id = UUID()
        // Held while the task is created, so its own removal (which takes the lock) cannot run before it was recorded.
        lock.locked {
            tasks[id] = Task { [weak self] in
                await body()
                self?.lock.locked { self?.tasks[id] = nil }
            }
        }
    }

    /// Waits for every watch push the last changes started (the logic tests; the app never needs it).
    public func settle() async {
        while true {
            let pending = lock.locked { Array(tasks.values) }
            if pending.isEmpty { return }
            for task in pending { await task.value }
        }
    }
}

#endif

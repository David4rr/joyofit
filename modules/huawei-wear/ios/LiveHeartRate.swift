// Port of LiveHeartRate.kt: the live heart rate on Today. While the UI wants it (`setActive`) and the watch is connected, the watch is asked
// for realtime heart rate (FitnessData 07/1C, GB EnableRealtimeHeartRate, and the 19/01 report Huawei Health opens) and every reading it
// pushes becomes an `onHeartRate` event. It is switched off again when the UI no longer wants it, and the watch's automatic heart rate is put
// back to the user's setting, because GB sends both through the same boolean.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class LiveHeartRate: LinkObserver, @unchecked Sendable {
    private static let fitness = Int(FitnessData.id)
    private static let realtime = Int(HealthSensors.realtimeCommand)
    private static let automatic = Int(FitnessData.EnableAutomaticHeartrate.id)
    private static let undecodedLogEvery = 10
    private static let readingsLogEvery = 12
    private static let hrService: UInt8 = 0x19
    private static let hrSwitch: UInt8 = 0x01
    private static let hrNotice: UInt8 = 0x03

    private let handle: @Sendable () -> LinkHandle?
    private let settings: WearSettings
    private let events: WearEvents
    private let nowMs: @Sendable () -> Int64

    private let lock = NSLock()
    private var attached: HuaweiSession?
    /// The session realtime heart rate is switched on in, so it is not asked twice and not left on.
    private var running: HuaweiSession?
    private var uiWanted = false
    /// A live workout needs the readings, whatever screen is open and also in the background.
    private var workoutWanted = false
    /// A 1-minute HRV measurement owns service 0x19 meanwhile; live readings are off and come back after.
    private var paused = false
    private var undecoded = 0
    private var readings = 0
    private let stateLock = AsyncLock()

    public init(
        handle: @escaping @Sendable () -> LinkHandle?, settings: WearSettings, events: WearEvents,
        nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.handle = handle
        self.settings = settings
        self.events = events
        self.nowMs = nowMs
    }

    private var wanted: Bool { lock.locked { (uiWanted || workoutWanted) && !paused } }

    /// A live workout holds the heart-rate sensor; an HRV measurement must not take it over.
    public var workoutActive: Bool { lock.locked { workoutWanted } }

    private func log(_ message: String) { events.log(LogEntry(.info, message)) }

    /// Switches the live readings off on the watch (when they were on) and keeps them off until `resume`.
    public func pause() async {
        lock.locked { paused = true }
        await stop()
    }

    /// Puts the live readings back if the UI or a workout still wants them.
    public func resume() {
        lock.locked { paused = false }
        Task { if self.wanted { await self.start() } else { await self.stop() } }
    }

    /// The UI asks for live heart rate (Today on screen) or stops asking (other screen, app in background).
    public func setActive(_ active: Bool) {
        lock.locked { uiWanted = active }
        Task { if self.wanted { await self.start() } else { await self.stop() } }
    }

    /// A live workout starts or ends.
    public func setWorkoutActive(_ active: Bool) {
        lock.locked { workoutWanted = active }
        Task { if self.wanted { await self.start() } else { await self.stop() } }
    }

    // MARK: LinkObserver

    /// A new session: subscribe to the pushed readings (the session is brand new, so there is nothing to close).
    public func linkConnected(_ handle: LinkHandle) async {
        lock.locked {
            attached = handle.session
            running = nil
        }
        _ = await handle.session.subscribe(service: HealthSensors.realtimeService, command: HealthSensors.realtimeCommand, label: "realtime heart rate") { [weak self] in
            self?.onPacket($0)
        }
        _ = await handle.session.subscribe(service: Self.hrService, command: Self.hrNotice, label: "heart rate report") { [weak self] in self?.onNotice($0) }
        if wanted { await start() }
    }

    public func linkDisconnected() {
        lock.locked {
            attached = nil
            running = nil
        }
    }

    // MARK: start and stop

    private func start() async {
        await stateLock.withLock {
            guard wanted, let h = handle() else { return }
            if lock.locked({ running === h.session }) { return }
            // Huawei Health's own report (as observed): 19/01 {01: 1 open, 02: 2}; readings arrive as 19/03. The Fit 4 Pro acknowledges
            // 07/1C but never pushes on it, so both are asked for.
            if h.caps.supports(Int(Self.hrService), Int(Self.hrSwitch)) {
                do {
                    var tlv = HuaweiTLV()
                    tlv.put(0x01, byte: 1)
                    tlv.put(0x02, byte: 2)
                    try await h.session.send(HuaweiPacket(serviceId: Self.hrService, commandId: Self.hrSwitch, tlv: tlv), label: "HeartRateReport on")
                } catch let e as WearError {
                    events.error("Heart rate report not opened: \(e.message)")
                } catch {
                    events.error("Heart rate report not opened: \(error)")
                }
            } else {
                log("Live heart rate: the watch does not list 19/01")
            }
            if !h.caps.supports(Self.fitness, Self.realtime) {
                lock.locked { running = h.session }
                return
            }
            do {
                _ = try await h.operationLock.withLock {
                    try await HealthSensors.send(session: h.session, log: events.sink, plan: [HealthSensors.realtimeRequest(true)])
                }
                lock.locked { running = h.session }
            } catch let e as WearError {
                events.error("Live heart rate not started: \(e.message)")
            } catch {
                events.error("Live heart rate not started: \(error)")
            }
        }
    }

    private func stop() async {
        await stateLock.withLock {
            if wanted { return }
            guard let h = handle() else { return }
            if lock.locked({ running !== h.session }) { return }
            do {
                if h.caps.supports(Int(Self.hrService), Int(Self.hrSwitch)) {
                    var tlv = HuaweiTLV()
                    tlv.put(0x01, byte: 2)
                    tlv.put(0x02, byte: 2)
                    try await h.session.send(HuaweiPacket(serviceId: Self.hrService, commandId: Self.hrSwitch, tlv: tlv), label: "HeartRateReport off")
                }
                _ = try await h.operationLock.withLock {
                    var restore = [HealthSensors.realtimeRequest(false)]
                    if h.caps.supports(Self.fitness, Self.automatic) {
                        restore.append(HealthSensors.automaticHeartRateRequest(settings.healthSensors.automaticHeartRate))
                    }
                    return try await HealthSensors.send(session: h.session, log: events.sink, plan: restore)
                }
                lock.locked { running = nil }
            } catch let e as WearError {
                events.error("Live heart rate not stopped: \(e.message)")
            } catch {
                events.error("Live heart rate not stopped: \(error)")
            }
        }
    }

    // MARK: pushed readings

    /// 07/1C pushed by the watch: decode and hand off.
    private func onPacket(_ packet: HuaweiPacket) {
        guard let bpm = HealthSensors.decodeRealtime(packet.tlv) else {
            // The raw frame is already in the log; say once in a while that it carried no reading.
            if nextUndecoded() % Self.undecodedLogEvery == 0 {
                log("Live heart rate: pushed packet without a reading (\(packet.tlv.map { "\($0)" } ?? "nil"))")
            }
            return
        }
        events.heartRate(bpm: bpm, tsMs: nowMs())
    }

    /// `19/03`: `81{82{03 bpm, 04 time s, 05 credibility}}`, possibly several.
    private func onNotice(_ packet: HuaweiPacket) {
        guard let tlv = packet.tlv else { return }
        guard let bpm = HealthSensors.decodeNotice(tlv) else {
            if nextUndecoded() % Self.undecodedLogEvery == 0 { log("Live heart rate: report without a reading (\(tlv))") }
            return
        }
        if nextReading() % Self.readingsLogEvery == 0 { log("Live heart rate: \(bpm) bpm (19/03)") }
        events.heartRate(bpm: bpm, tsMs: nowMs())
    }

    private func nextUndecoded() -> Int { lock.locked { defer { undecoded += 1 }; return undecoded } }

    private func nextReading() -> Int { lock.locked { defer { readings += 1 }; return readings } }
}

#endif

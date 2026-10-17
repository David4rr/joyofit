// Port of the state half of StressSwitch.kt: the watch's automatic stress switch and the calibration it needs. The watch only turns it on
// together with a stress calibration computed on the phone from a minute of RR intervals (GB `HuaweiStressCalibration`): status 1, the score,
// 12 float features and the time of the measurement. Status 2 turns it off. The switch and the last calibration are kept in `WearSettings`
// and sent again when the watch reconnects, as GB does on every connection.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class StressFeature: @unchecked Sendable {
    private let handle: @Sendable () -> LinkHandle?
    private let settings: WearSettings
    private let hrv: HrvSpot
    private let events: WearEvents
    private let answerMs: Int

    public init(handle: @escaping @Sendable () -> LinkHandle?, settings: WearSettings, hrv: HrvSpot, events: WearEvents, answerMs: Int = StressSwitchProtocol.answerMs) {
        self.handle = handle
        self.settings = settings
        self.hrv = hrv
        self.events = events
        self.answerMs = answerMs
    }

    private func supported() -> Bool { handle().map { StressSwitchProtocol.supported($0.caps) } ?? false }

    private func storedCalibration() -> StressData? { settings.stressCalibration.flatMap { StressData.fromJsonString($0) } }

    /// `StressStatus` in `HuaweiWear.types.ts`.
    public func status() -> [String: Any] {
        [
            "enabled": settings.stressEnabled,
            "lastCalibratedAt": storedCalibration().map { $0.endTime / 1000 as Any } ?? NSNull(),
            "supported": supported(),
            "knownSupported": settings.autoStressListed.map { $0 as Any } ?? NSNull(),
        ]
    }

    /// Turns the watch's automatic stress on (runs the 1-minute calibration first) or off. The returned status is the stored one after the
    /// watch took the request; a watch that answers with an error code rejects with `ERR_STRESS_REJECTED`.
    public func setEnabled(_ enabled: Bool) async throws -> [String: Any] {
        guard handle() != nil else { throw WearError(.notConnected, "The watch is not connected") }
        if !supported() { throw WearError(.unsupported, "This watch does not list the automatic stress command (20/09)") }
        if enabled {
            let collected = try await hrv.collect()
            // The same minute is a valid spot reading; keep it when it is clean enough.
            do {
                _ = try hrv.record(collected)
            } catch let e as WearError {
                events.error("HRV spot reading from the calibration not stored: \(e.message)")
            }
            guard let data = HrvSpotCodec.calibrateStress(beats: collected.beats, startMs: collected.startMs, endMs: collected.endMs) else {
                throw WearError(
                    .stressCalibration,
                    "The calibration minute could not be scored (\(collected.beats.filter { $0.sqi != 0 }.count) beats with a clean signal). "
                        + "Wear the watch snug on the wrist, sit still for the whole minute and try again."
                )
            }
            events.info("Stress calibration: score \(data.score), level \(data.level), factor \(data.scoreFactor), features \(data.features)")
            guard let h = handle() else { throw WearError(.notConnected, "The watch disconnected before the calibration could be sent") }
            try await StressSwitchProtocol.transmit(session: h.session, log: events.sink, status: 1, data: data, answerMs: answerMs)
            settings.stressCalibration = data.toJsonString()
            settings.stressEnabled = true
        } else {
            guard let h = handle() else { throw WearError(.notConnected, "The watch is not connected") }
            try await StressSwitchProtocol.transmit(session: h.session, log: events.sink, status: 2, data: nil, answerMs: answerMs)
            settings.stressEnabled = false
        }
        return status()
    }

    /// A new session: put the stored switch back on the watch (GB sends it on every connect). The observers announce each session once.
    public func linkConnected(_ h: LinkHandle) async {
        // Stored only when it changed; the log line is the same as on Android.
        let listed = StressSwitchProtocol.supported(h.caps)
        if settings.autoStressListed != listed {
            settings.autoStressListed = listed
            events.info("Automatic stress (20/09) is \(listed ? "listed" : "not listed") by this watch")
        }
        guard settings.stressEnabled, let data = storedCalibration() else { return }
        do {
            try await StressSwitchProtocol.transmit(session: h.session, log: events.sink, status: 1, data: data, answerMs: answerMs)
        } catch let e as WearError {
            events.error("Automatic stress not re-sent: \(e.message)")
        } catch {
            events.error("Automatic stress not re-sent: \(error)")
        }
    }
}

#endif

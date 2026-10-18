import XCTest
@testable import HuaweiWearLogic

/// The 1-minute HRV measurement and the automatic stress switch over a scripted watch, with a shortened minute and a fake wall clock that
/// reports a 60 s window (the model only accepts 50 to 70 s of signal).
final class HrvStressTests: XCTestCase {
    private var events: RecordingEvents!
    private var settings: WearSettings!
    private var syncStore: SyncStore!
    private var watch: ScriptedWatch!
    private var handle: LinkHandle?
    private var connected = true

    private let fixedRri = (0..<70).map { i in 860 + ((i * 37) % 61 - 30) + (i % 9 < 4 ? 20 : -20) }

    override func setUp() {
        events = RecordingEvents()
        settings = WearSettings(defaults: ephemeralDefaults())
        syncStore = SyncStore(url: temporaryDatabaseURL())
        watch = ScriptedWatch()
        connected = true
    }

    private func caps(hrv: Bool = true, stress: Bool = true, realtime: Bool = false) -> DeviceCaps {
        let caps = DeviceCaps()
        var map: [Int: Bytes] = [:]
        if hrv { map[0x19] = [0x01] }
        if stress { map[0x20] = [0x09] }
        if realtime { map[0x07] = [0x1C] }
        caps.supportedCommands = map
        return caps
    }

    private final class Clock: @unchecked Sendable {
        private let lock = NSLock()
        private var calls = 0
        /// First call is the start of the window, the second its end 60 s later.
        func next() -> Int64 { lock.locked { calls += 1; return calls == 1 ? 1_700_000_000_000 : 1_700_000_060_000 } }
    }

    private struct Rig {
        let live: LiveHeartRate
        let hrv: HrvSpot
        let stress: StressFeature
    }

    private func rig(caps: DeviceCaps, measureMs: Int64 = 300) -> Rig {
        handle = watch.makeHandle(caps: caps)
        let provider: @Sendable () -> LinkHandle? = { [unowned self] in self.connected ? self.handle : nil }
        let live = LiveHeartRate(handle: provider, settings: settings, events: events)
        let clock = Clock()
        let hrv = HrvSpot(handle: provider, liveHeartRate: live, syncStore: syncStore, events: events, measureMs: measureMs, pollMs: 10, wallClockMs: { clock.next() })
        let stress = StressFeature(handle: provider, settings: settings, hrv: hrv, events: events, answerMs: 1000)
        return Rig(live: live, hrv: hrv, stress: stress)
    }

    private func report(_ rri: [Int], sqi: Int = 100) -> Bytes {
        var container = HuaweiTLV()
        for r in rri {
            var beat = HuaweiTLV()
            beat.put(0x04, short: Int16(truncatingIfNeeded: r))
            beat.put(0x05, byte: UInt8(sqi))
            container.put(0x83, tlv: beat)
        }
        var tlv = HuaweiTLV()
        tlv.put(0x82, tlv: container)
        return ScriptedWatch.tlvFrame(service: 0x19, command: 0x05, tlv)
    }

    /// The watch pushes `rri` in reports of ten intervals when the stream is opened, and answers 20/09 with `code`.
    private func script(rri: [Int], sqi: Int = 100, stressCode: Int32? = nil, answerStress: Bool = true) {
        watch.responder = { r in
            if r.service == 0x19, r.command == 0x01, (try? r.tlv.byte(0x01)) == 3 {
                return stride(from: 0, to: rri.count, by: 10).map { self.report(Array(rri[$0..<min($0 + 10, rri.count)]), sqi: sqi) }
            }
            if r.service == 0x20, r.command == 0x09, answerStress {
                var tlv = HuaweiTLV()
                tlv.put(0x01, byte: 1)
                if let stressCode { tlv.put(0x7f, int: stressCode) }
                return [ScriptedWatch.tlvFrame(service: 0x20, command: 0x09, tlv)]
            }
            return []
        }
    }

    private func requests(_ service: UInt8, _ command: UInt8) -> [ScriptedWatch.Request] { watch.requests.filter { $0.service == service && $0.command == command } }

    // MARK: HRV

    func testAMeasurementStoresTheReadingAndTheIntervalsAndClosesTheStream() async throws {
        let rri = (0..<80).map { 800 + (($0 * 7) % 41 - 20) + ($0 % 2 == 0 ? 15 : -15) }
        script(rri: rri)
        let r = rig(caps: caps())
        let reading = try await r.hrv.measure()
        XCTAssertEqual(reading.start, 1_700_000_000)
        XCTAssertEqual(reading.end, 1_700_000_060)
        XCTAssertEqual(reading.beats, 80)
        XCTAssertEqual(reading.heartRate, Int((60_000.0 / reading.meanRr + 0.5).rounded(.down)))
        XCTAssertGreaterThan(reading.rmssd, 0)

        let open = try XCTUnwrap(requests(0x19, 0x01).first)
        XCTAssertEqual(try open.tlv.byte(0x01), 3)
        XCTAssertEqual(try requests(0x19, 0x01).last?.tlv.byte(0x01), 4, "the stream is closed afterwards")
        XCTAssertFalse(r.hrv.isRunning)

        let (samples, readings) = try syncStore.read { db in
            (
                try db.query("SELECT ts_ms, rri, sqi FROM rri_samples ORDER BY ts_ms") { ($0.int64(0), $0.int(1), $0.int(2)) },
                try db.query("SELECT start, end, source, beats FROM hrv_readings") { ($0.int64(0), $0.int64(1), $0.text(2), $0.int(3)) }
            )
        }
        XCTAssertEqual(samples.count, 80)
        XCTAssertEqual(samples.first?.0, 1_700_000_000_000 + Int64(rri[0]))
        XCTAssertEqual(samples.map(\.1), rri)
        XCTAssertEqual(readings.count, 1)
        XCTAssertEqual(readings[0].0, 1_700_000_000)
        XCTAssertEqual(readings[0].2, "spot")
        XCTAssertEqual(readings[0].3, 80)
        XCTAssertEqual(events.hrvProgress.last?.secondsLeft, 0)
        XCTAssertEqual(events.hrvProgress.last?.beats, 80)
        XCTAssertTrue(events.hrvProgress.count >= 2)
        XCTAssertTrue(events.messages().contains { $0.hasPrefix("HRV: window 60000 ms, 8 reports, 80 intervals, sqi histogram {100=80}") })
        XCTAssertTrue(events.messages().contains { $0.hasPrefix("HRV spot: RMSSD") })
    }

    func testTooFewCleanBeatsRejectWithTheCountAndStoreNothing() async throws {
        script(rri: Array(repeating: 800, count: 20), sqi: 0)
        let r = rig(caps: caps())
        do {
            _ = try await r.hrv.measure()
            XCTFail("20 unusable beats are no reading")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .hrvTooFewBeats)
            XCTAssertTrue(e.message.contains("Only 0 of 20 beats had a clean signal (at least 40 are needed)"), e.message)
        }
        XCTAssertEqual(try syncStore.read { try $0.query("SELECT 1 FROM hrv_readings") { _ in 1 } }.count, 0)
        XCTAssertEqual(requests(0x19, 0x01).count, 2, "opened and closed")
    }

    func testAWatchThatSendsNothingIsReportedAsSuch() async {
        script(rri: [])
        let r = rig(caps: caps())
        do {
            _ = try await r.hrv.measure()
            XCTFail()
        } catch let e as WearError {
            XCTAssertEqual(e.code, .hrvTooFewBeats)
            XCTAssertTrue(e.message.contains("The watch sent no beat-to-beat data (0 reports)"), e.message)
        } catch { XCTFail("\(error)") }
    }

    func testCancelEndsTheMinuteEarlyAndClosesTheStream() async throws {
        script(rri: [])
        let r = rig(caps: caps(), measureMs: 30_000)
        let task = Task { try await r.hrv.measure() }
        await eventually("running") { r.hrv.isRunning && self.requests(0x19, 0x01).count == 1 }
        r.hrv.cancel()
        do {
            _ = try await task.value
            XCTFail("cancelled")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .hrvCancelled)
        }
        XCTAssertEqual(try requests(0x19, 0x01).last?.tlv.byte(0x01), 4)
        XCTAssertFalse(r.hrv.isRunning)
        r.hrv.cancel()  // nothing running: nothing happens
        XCTAssertFalse(r.hrv.isRunning)
    }

    func testCancellingTheCallerAlsoClosesTheStream() async throws {
        script(rri: [])
        let r = rig(caps: caps(), measureMs: 30_000)
        let task = Task { try await r.hrv.measure() }
        await eventually("running") { r.hrv.isRunning && self.requests(0x19, 0x01).count == 1 }
        task.cancel()
        _ = try? await task.value
        await eventually("closed") { self.requests(0x19, 0x01).count == 2 && !r.hrv.isRunning }
        XCTAssertEqual(try requests(0x19, 0x01).last?.tlv.byte(0x01), 4)
    }

    func testALostLinkEndsTheMeasurement() async {
        script(rri: [])
        let r = rig(caps: caps(), measureMs: 30_000)
        let task = Task { try await r.hrv.measure() }
        await eventually("running") { r.hrv.isRunning && self.requests(0x19, 0x01).count == 1 }
        connected = false
        do {
            _ = try await task.value
            XCTFail("the watch is gone")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .disconnected)
        } catch { XCTFail("\(error)") }
        XCTAssertFalse(r.hrv.isRunning)
    }

    func testAsecondMeasurementWhileOneRunsIsBusy() async throws {
        script(rri: [])
        let r = rig(caps: caps(), measureMs: 30_000)
        let task = Task { try await r.hrv.measure() }
        await eventually("running") { r.hrv.isRunning }
        do {
            _ = try await r.hrv.collect()
            XCTFail("one sensor, one measurement")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .busy)
        }
        r.hrv.cancel()
        _ = try? await task.value
    }

    func testPreconditions() async {
        // Not connected.
        connected = false
        var r = rig(caps: caps())
        connected = false
        do { _ = try await r.hrv.measure(); XCTFail() } catch let e as WearError { XCTAssertEqual(e.code, .notConnected) } catch { XCTFail("\(error)") }
        // No 19/01.
        connected = true
        r = rig(caps: caps(hrv: false))
        do { _ = try await r.hrv.measure(); XCTFail() } catch let e as WearError { XCTAssertEqual(e.code, .unsupported) } catch { XCTFail("\(error)") }
        // A live workout owns the sensor.
        r = rig(caps: caps())
        r.live.setWorkoutActive(true)
        do { _ = try await r.hrv.measure(); XCTFail() } catch let e as WearError { XCTAssertEqual(e.code, .busy) } catch { XCTFail("\(error)") }
        XCTAssertTrue(watch.requests.isEmpty || watch.requests.allSatisfy { $0.service != 0x19 || $0.command != 0x01 || (try? $0.tlv.byte(0x01)) != 3 })
    }

    func testLiveHeartRateIsPausedForTheMinuteAndPutBack() async throws {
        let rri = (0..<80).map { 800 + (($0 * 7) % 41 - 20) + ($0 % 2 == 0 ? 15 : -15) }
        watch.responder = { r in
            if r.service == 0x19, r.command == 0x01, (try? r.tlv.byte(0x01)) == 3 { return [self.report(rri)] }
            if r.service == 0x07, r.command == 0x1C { return [ScriptedWatch.tlvFrame(service: 0x07, command: 0x1C, HuaweiTLV())] }
            return []
        }
        let r = rig(caps: caps(realtime: true))
        await r.live.linkConnected(handle!)
        r.live.setActive(true)
        await eventually("realtime on") { self.requests(0x07, 0x1C).count == 1 }
        _ = try await r.hrv.measure()
        let realtime = requests(0x07, 0x1C).map { try? $0.tlv.bool(0x01) }
        await eventually("live readings back on") { self.requests(0x07, 0x1C).count >= 3 }
        XCTAssertEqual(realtime.first, true)
        XCTAssertEqual(requests(0x07, 0x1C).prefix(3).map { try? $0.tlv.bool(0x01) }, [true, false, true], "on, paused for the minute, back on")
    }

    // MARK: stress

    func testEnablingCalibratesSendsAndStoresTheSwitchAndTheCalibration() async throws {
        script(rri: fixedRri)
        let r = rig(caps: caps())
        let status = try await r.stress.setEnabled(true)
        XCTAssertEqual(status["enabled"] as? Bool, true)
        XCTAssertEqual(status["lastCalibratedAt"] as? Int64, 1_700_000_060)
        XCTAssertEqual(status["supported"] as? Bool, true)
        let sent = try XCTUnwrap(requests(0x20, 0x09).first)
        XCTAssertEqual(try sent.tlv.byte(0x01), 1)
        XCTAssertEqual(try sent.tlv.byte(0x02), 47)
        XCTAssertEqual(try sent.tlv.bytes(0x03).count, 48)
        XCTAssertEqual(try sent.tlv.int(0x04), 1_700_000_060)
        XCTAssertTrue(settings.stressEnabled)
        let stored = try XCTUnwrap(settings.stressCalibration.flatMap { StressData.fromJsonString($0) })
        XCTAssertEqual(stored.score, 47)
        XCTAssertEqual(stored.level, 2)
        XCTAssertTrue(events.messages().contains { $0.hasPrefix("Stress calibration: score 47, level 2") })
        // The same minute is a valid spot reading and is kept.
        XCTAssertEqual(try syncStore.read { try $0.query("SELECT source FROM hrv_readings") { $0.text(0) } }, ["spot"])
    }

    func testDisablingSendsStatusTwoAndKeepsTheCalibration() async throws {
        script(rri: fixedRri)
        let r = rig(caps: caps())
        _ = try await r.stress.setEnabled(true)
        let status = try await r.stress.setEnabled(false)
        XCTAssertEqual(status["enabled"] as? Bool, false)
        XCTAssertNotNil(status["lastCalibratedAt"] as? Int64, "the last calibration stays for the next switch on")
        XCTAssertEqual(try requests(0x20, 0x09).last?.tlv.serialize(), [0x01, 0x01, 0x02])
        XCTAssertFalse(settings.stressEnabled)
    }

    func testAMinuteTheModelCannotScoreIsAnErrorAndSendsNothing() async throws {
        script(rri: Array(repeating: 800, count: 70))  // flat: no variability to score
        let r = rig(caps: caps())
        do {
            _ = try await r.stress.setEnabled(true)
            XCTFail("no score, no switch")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .stressCalibration)
            XCTAssertTrue(e.message.contains("could not be scored"), e.message)
        }
        XCTAssertTrue(requests(0x20, 0x09).isEmpty)
        XCTAssertFalse(settings.stressEnabled)
        XCTAssertNil(settings.stressCalibration)
    }

    func testARefusalByTheWatchLeavesTheStoredSwitchAlone() async throws {
        script(rri: fixedRri, stressCode: 100_001)
        let r = rig(caps: caps())
        do {
            _ = try await r.stress.setEnabled(true)
            XCTFail("refused")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .stressRejected)
        }
        XCTAssertFalse(settings.stressEnabled)
        XCTAssertNil(settings.stressCalibration)
    }

    func testPreconditionsOfTheSwitch() async {
        connected = false
        var r = rig(caps: caps())
        connected = false
        for on in [true, false] {
            do { _ = try await r.stress.setEnabled(on); XCTFail() } catch let e as WearError { XCTAssertEqual(e.code, .notConnected) } catch { XCTFail("\(error)") }
        }
        XCTAssertEqual(r.stress.status()["supported"] as? Bool, false)
        connected = true
        r = rig(caps: caps(stress: false))
        do { _ = try await r.stress.setEnabled(true); XCTFail() } catch let e as WearError { XCTAssertEqual(e.code, .unsupported) } catch { XCTFail("\(error)") }
        XCTAssertEqual(r.stress.status()["supported"] as? Bool, false)
        XCTAssertTrue(watch.requests.isEmpty)
    }

    func testTheStatusBeforeAnyCalibrationHasNoTime() {
        let status = rig(caps: caps()).stress.status()
        XCTAssertEqual(status["enabled"] as? Bool, false)
        XCTAssertTrue(status["lastCalibratedAt"] is NSNull)
        XCTAssertTrue(status["knownSupported"] is NSNull, "nothing is known before the first connect")
        XCTAssertEqual(Set(status.keys), ["enabled", "lastCalibratedAt", "supported", "knownSupported"], "same shape as StressStatus")
    }

    func testConnectingRecordsWhetherTheWatchListsAutomaticStressAndLogsOnlyChanges() async {
        let listing = rig(caps: caps())
        XCTAssertNil(settings.autoStressListed)
        await listing.stress.linkConnected(handle!)
        XCTAssertEqual(settings.autoStressListed, true)
        XCTAssertEqual(listing.stress.status()["knownSupported"] as? Bool, true)
        XCTAssertEqual(events.messages().filter { $0 == "Automatic stress (20/09) is listed by this watch" }.count, 1)
        await listing.stress.linkConnected(handle!)
        XCTAssertEqual(events.messages().filter { $0.hasPrefix("Automatic stress (20/09) is ") }.count, 1, "unchanged: not stored and not logged again")

        // The answer outlives the connection: a watch that is away still reports what it listed last time.
        connected = false
        XCTAssertEqual(listing.stress.status()["supported"] as? Bool, false)
        XCTAssertEqual(listing.stress.status()["knownSupported"] as? Bool, true)

        // The same phone paired with a watch that does not list it.
        connected = true
        let lacking = rig(caps: caps(stress: false))
        await lacking.stress.linkConnected(handle!)
        XCTAssertEqual(settings.autoStressListed, false)
        XCTAssertEqual(lacking.stress.status()["knownSupported"] as? Bool, false)
        XCTAssertTrue(events.messages().contains("Automatic stress (20/09) is not listed by this watch"))
        XCTAssertTrue(watch.requests.isEmpty, "nothing is sent: the switch is off")
    }

    func testTheStoredSwitchIsPutBackOnTheWatchWhenItReconnects() async throws {
        script(rri: fixedRri)
        let r = rig(caps: caps())
        _ = try await r.stress.setEnabled(true)
        let before = requests(0x20, 0x09).count
        await r.stress.linkConnected(handle!)
        XCTAssertEqual(requests(0x20, 0x09).count, before + 1)
        let again = try XCTUnwrap(requests(0x20, 0x09).last)
        XCTAssertEqual(try again.tlv.byte(0x01), 1)
        XCTAssertEqual(try again.tlv.byte(0x02), 47)
    }

    func testNothingIsResentWhenTheSwitchIsOffOrThereIsNoCalibration() async throws {
        let r = rig(caps: caps())
        await r.stress.linkConnected(handle!)
        settings.stressEnabled = true  // switch on, but no calibration stored
        await r.stress.linkConnected(handle!)
        XCTAssertTrue(watch.requests.isEmpty)
    }

    func testAResendTheWatchDoesNotAnswerIsLoggedNotFatal() async throws {
        script(rri: fixedRri)
        let r = rig(caps: caps())
        _ = try await r.stress.setEnabled(true)
        watch.responder = { _ in [] }
        await r.stress.linkConnected(handle!)
        XCTAssertTrue(events.messages().contains { $0.contains("the watch did not answer within 1 s") })
    }
}

import XCTest
@testable import HuaweiWearLogic

final class WatchfaceCustomizerTests: XCTestCase {
    private let face = WatchfaceEntry(id: "400001", version: "1.0.0", name: "Night", type: 0b1000, expandedType: 0)

    private func report(_ config: FaceCustomization) -> Bytes {
        DataSyncRig.eventFrame(
            src: FaceCustomWire.watchPkg, wear: FaceCustomWire.phonePkg, id: FaceCustomWire.eventReport, data: try! FaceCustomWire.encodeConfig(config)
        )
    }

    /// A rig with the customizer on it; the watch holds `held` for the face and answers a query with it, and takes an apply when `takes`.
    private func make(
        bits: [Int] = [83, 84], connected: Bool = true, faces: [WatchfaceEntry]? = nil, held: FaceCustomization? = nil, takes: Bool = true,
        echoes: Bool = true, answers: Bool = true
    ) -> (DataSyncRig, WatchfaceCustomizer, Held) {
        let rig = DataSyncRig(bits: bits, connected: connected)
        let list = faces ?? [face]
        let customizer = WatchfaceCustomizer(events: rig.events, faces: { list }, queryTimeoutMs: 300, echoWaitMs: 150)
        rig.service.register(customizer)
        let state = Held(held ?? FaceCustomization(marketId: "400001", styles: [FaceStyleChoice(mode: 0, index: 1)], colourIndex: 2, widgets: [0, 1]))
        rig.watch.responder = { sent in
            guard sent.service == 0x37, sent.command == 0x02, let id = try? sent.tlv.int(0x03) else { return [] }
            if Int(id) == FaceCustomWire.eventQuery {
                return answers ? [self.report(state.config)] : []
            }
            if Int(id) == FaceCustomWire.eventReport, let data = try? sent.tlv.bytes(0x05), let wanted = FaceCustomWire.decode(data) {
                if takes {
                    var merged = state.config
                    for style in wanted.styles {
                        merged.styles.removeAll { $0.mode == style.mode }
                        merged.styles.append(style)
                    }
                    if let colour = wanted.colourIndex { merged.colourIndex = colour }
                    if !wanted.widgets.isEmpty { merged.widgets = wanted.widgets }
                    state.config = merged
                }
                return echoes ? [self.report(state.config)] : []
            }
            return []
        }
        return (rig, customizer, state)
    }

    final class Held: @unchecked Sendable {
        var config: FaceCustomization
        init(_ config: FaceCustomization) { self.config = config }
    }

    private func expect(_ code: ErrorCode, _ body: () async throws -> Void) async -> WearError? {
        do {
            try await body()
            XCTFail("expected \(code.rawValue)")
            return nil
        } catch let e as WearError {
            XCTAssertEqual(e.code, code)
            return e
        } catch {
            XCTFail("\(error)")
            return nil
        }
    }

    func testQueryReturnsWhatTheWatchReports() async throws {
        let (rig, customizer, state) = make()
        await rig.attach()

        let config = try await customizer.query("400001")

        XCTAssertEqual(config, state.config)
        let sent = try XCTUnwrap(rig.watch.sent.first)
        XCTAssertEqual(try sent.tlv.string(0x01), FaceCustomWire.phonePkg)
        XCTAssertEqual(try sent.tlv.string(0x02), FaceCustomWire.watchPkg)
        XCTAssertEqual(Int(try sent.tlv.int(0x03)), 800_100_008)
        XCTAssertEqual(try sent.tlv.bytes(0x05), FaceCustomWire.encodeQuery("400001"))
        XCTAssertTrue(rig.events.contains("FaceCustom: query 400001: ExpandCapability 84 (DataSync events) set"))
        XCTAssertTrue(rig.events.contains("in the face list as 'Night'"))
        
    }

    func testQueryNeedsAConnectedWatchTheCapabilityAndAnInstalledFace() async {
        let (offline, c1, _) = make(connected: false)
        _ = await expect(.notConnected) { _ = try await c1.query("400001") }
        XCTAssertTrue(offline.watch.sent.isEmpty)

        let (noBit, c2, _) = make(bits: [83])
        await noBit.attach()
        let e = await expect(.unsupported) { _ = try await c2.query("400001") }
        XCTAssertTrue(e?.message.contains("ExpandCapability 84") == true)
        XCTAssertTrue(noBit.watch.sent.isEmpty)

        let (other, c3, _) = make(faces: [face])
        await other.attach()
        _ = await expect(.invalidArgument) { _ = try await c3.query("999") }
        _ = await expect(.invalidArgument) { _ = try await c3.query("") }
        XCTAssertTrue(other.watch.sent.isEmpty)
    }

    func testAnUnreadableFaceListDoesNotStopAQuery() async throws {
        let rig = DataSyncRig()
        let customizer = WatchfaceCustomizer(events: rig.events, faces: { nil }, queryTimeoutMs: 300, echoWaitMs: 100)
        rig.service.register(customizer)
        rig.watch.responder = { _ in [self.report(FaceCustomization(marketId: "1"))] }
        await rig.attach()
        let config = try await customizer.query("1")
        XCTAssertEqual(config.marketId, "1")
        XCTAssertTrue(rig.events.contains("face list unreadable, not checked"))
    }

    func testASilentWatchTimesOutWithAnExplanation() async {
        let (rig, customizer, _) = make(answers: false)
        await rig.attach()
        let e = await expect(.timeout) { _ = try await customizer.query("400001") }
        XCTAssertTrue(e?.message.contains("editable options") == true)
        XCTAssertTrue(rig.events.containsError("no report within 300 ms"))
    }

    func testApplyWritesTheEventAndReadsBackWhatTheWatchHolds() async throws {
        let (rig, customizer, state) = make()
        await rig.attach()
        let wanted = FaceCustomization(marketId: "400001", styles: [FaceStyleChoice(mode: 1, index: 3)], colourIndex: 7, widgets: [1, 1])

        let result = try await customizer.apply("400001", wanted)

        XCTAssertTrue(result.ok)
        XCTAssertTrue(result.echoed)
        XCTAssertEqual(result.mismatches, [])
        XCTAssertEqual(result.message, "The watch now reports the requested configuration.")
        XCTAssertEqual(result.config, state.config)
        let applies = rig.watch.sent.filter { (try? $0.tlv.int(0x03)).map(Int.init) == FaceCustomWire.eventReport }
        XCTAssertEqual(applies.count, 1)
        XCTAssertEqual(try applies[0].tlv.bytes(0x05), try FaceCustomWire.encodeConfig(wanted))
        let js = result.toJS()
        XCTAssertEqual(js["ok"] as? Bool, true)
        XCTAssertEqual((js["config"] as? [String: Any])?["marketId"] as? String, "400001")
    }

    func testApplyReportsWhatDidNotStick() async throws {
        let (rig, customizer, _) = make(takes: false, echoes: false)
        await rig.attach()
        let wanted = FaceCustomization(marketId: "400001", styles: [FaceStyleChoice(mode: 1, index: 3)])

        let result = try await customizer.apply("400001", wanted)

        XCTAssertFalse(result.ok)
        XCTAssertFalse(result.echoed)
        XCTAssertEqual(result.mismatches, ["background is not reported, wanted 3"])
        XCTAssertEqual(result.message, "The watch did not take: background is not reported, wanted 3.")
        XCTAssertNotNil(result.config)
    }

    func testApplyWithoutAReadBackAnswerConfirmsNothing() async throws {
        let rig = DataSyncRig()
        let customizer = WatchfaceCustomizer(events: rig.events, faces: { [self.face] }, queryTimeoutMs: 150, echoWaitMs: 50)
        rig.service.register(customizer)
        await rig.attach()

        let result = try await customizer.apply("400001", FaceCustomization(marketId: "400001", colourIndex: 1))

        XCTAssertFalse(result.ok)
        XCTAssertNil(result.config)
        XCTAssertEqual(result.message, "Sent, but the watch did not answer the read-back, so nothing is confirmed.")
        XCTAssertEqual(result.toJS()["config"] is NSNull, true)
    }

    func testApplyRefusesWhatCannotBeEncodedBeforeSendingAnything() async {
        let (rig, customizer, _) = make()
        await rig.attach()
        _ = await expect(.invalidArgument) { _ = try await customizer.apply("400001", FaceCustomization(marketId: "400001", widgets: [256])) }
        let e = await expect(.invalidArgument) { _ = try await customizer.apply("400001", FaceCustomization(marketId: "other")) }
        XCTAssertTrue(e?.message.contains("not 400001") == true)
        XCTAssertTrue(rig.watch.sent.isEmpty)
    }

    func testAReportNobodyAskedForIsForwardedToJS() async {
        let (rig, _, _) = make()
        await rig.attach()

        rig.session.onData(report(FaceCustomization(marketId: "400001", styles: [FaceStyleChoice(mode: 2, index: 4)], colourIndex: nil, widgets: [3])))

        await eventually { !rig.events.faces.isEmpty }
        XCTAssertEqual(rig.events.faces[0]["marketId"] as? String, "400001")
        XCTAssertEqual((rig.events.faces[0]["widgets"] as? [Int]), [3])
        XCTAssertTrue(rig.events.contains("pushed, nobody asked"))
    }

    func testAReportThatCannotBeReadIsLoggedAsAnError() async {
        let (rig, _, _) = make()
        await rig.attach()
        rig.session.onData(DataSyncRig.eventFrame(src: FaceCustomWire.watchPkg, wear: FaceCustomWire.phonePkg, id: FaceCustomWire.eventReport, data: [0x06, 0x01, 0x05]))
        await eventually { rig.events.containsError("report from the watch could not be read") }
        rig.session.onData(DataSyncRig.eventFrame(src: FaceCustomWire.watchPkg, wear: FaceCustomWire.phonePkg, id: FaceCustomWire.eventReport, data: nil))
        await eventually { rig.events.contains("report from the watch has no data") }
        XCTAssertTrue(rig.events.faces.isEmpty)
    }
}

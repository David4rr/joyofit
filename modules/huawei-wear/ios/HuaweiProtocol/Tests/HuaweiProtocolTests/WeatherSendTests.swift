import XCTest
@testable import HuaweiProtocol

/// The weather push over a real `HuaweiSession` and a scripted watch: the request chain of GB's HuaweiWeatherManager.sendWeather, the capability
/// gates, what is read from the watch's answers and how a refusal or a missing answer ends the chain.
final class WeatherSendTests: XCTestCase {
    private let zone = TimeZone(identifier: "Asia/Jakarta")!
    private var now: Int64 {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        return Int64(c.date(from: DateComponents(year: 2026, month: 10, day: 14, hour: 10, minute: 30))!.timeIntervalSince1970)
    }

    private func dayStart(_ offset: Int) -> Int64 {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        return Int64(c.date(from: DateComponents(year: 2026, month: 10, day: 14 + offset, hour: 0, minute: 0))!.timeIntervalSince1970)
    }

    private func report() -> WeatherReport { WeatherModelTests.report(now: now, day: { self.dayStart($0) }) }

    /// ExpandCapability bitmap with the given bits set.
    private func caps(commands: [Int: Bytes], bits: [Int] = []) -> DeviceCaps {
        let caps = DeviceCaps()
        caps.supportedCommands = commands
        var map = Bytes(repeating: 0, count: 32)
        for bit in bits { map[bit / 8] |= UInt8(1 << (bit % 8)) }
        caps.expandCapabilities = map
        return caps
    }

    private static let all: [Int: Bytes] = [0x0F: [0x01, 0x02, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0C], 0x18: [0x06]]

    private static func ack(_ service: UInt8, _ command: UInt8) -> Bytes {
        var tlv = HuaweiTLV()
        tlv.put(0x7F, int: 0x000186A0)
        return SleepFilesFakeWatch.tlvFrame(service: service, command: command, tlv)
    }

    /// A watch that answers like the Fit 4 Pro: start ok, the support bitmaps given, an ok code for everything else.
    private func installWatch(_ h: SleepFilesHarness, support: UInt8 = 0xFF, extended: UInt16 = 0x07, sunMoon: Int32 = 3, startCode: Int32 = 0x000186A0, silent: Set<String> = []) {
        h.watch.responder = { request in
            let key = String(format: "%02x/%02x", request.service, request.command)
            if silent.contains(key) { return [] }
            var tlv = HuaweiTLV()
            switch (request.service, request.command) {
            case (0x0F, 0x09): tlv.put(0x7F, int: startCode)
            case (0x0F, 0x02): tlv.put(0x01, byte: support)
            case (0x0F, 0x06): tlv.put(0x01, short: Int16(bitPattern: extended))
            case (0x0F, 0x0A): tlv.put(0x01, int: sunMoon)
            default: tlv.put(0x7F, int: 0x000186A0)
            }
            return [SleepFilesFakeWatch.tlvFrame(service: request.service, command: request.command, tlv)]
        }
    }

    private func sender(_ h: SleepFilesHarness, _ caps: DeviceCaps) -> HuaweiWeatherSender {
        HuaweiWeatherSender(session: h.session, caps: caps, log: h.log.sink, answerTimeoutMs: 300)
    }

    private func keys(_ h: SleepFilesHarness) -> [String] { h.watch.requests.map { String(format: "%02x/%02x", $0.service, $0.command) } }

    func testTheFullChainRunsInGbOrderAndCarriesTheReport() async throws {
        let h = SleepFilesHarness()
        installWatch(h)
        let caps = caps(commands: Self.all, bits: [0x2F, 0xC0])
        let outcome = try await sender(h, caps).send(report: report(), unit: .fahrenheit, nowSec: now, zone: zone)

        XCTAssertEqual(keys(h), ["0f/09", "0f/05", "0f/02", "0f/06", "0f/0a", "0f/01", "18/07", "0f/08"])
        XCTAssertTrue(h.watch.requests.allSatisfy { $0.encrypted }, "every request of the chain is encrypted")
        let requests = h.watch.requests
        XCTAssertEqual(try requests[0].tlv.byte(0x01), 3)
        XCTAssertEqual(try requests[1].tlv.byte(0x01), 1, "unit request: Fahrenheit")

        let current = requests[5].tlv
        XCTAssertEqual(try current.string(0x08), "Bandung")
        XCTAssertEqual(try current.byte(0x09), 28)
        XCTAssertEqual(try current.byte(0x0A), 1)
        XCTAssertEqual(try current.string(0x0E), "Open-Meteo")
        XCTAssertEqual(try current.byte(0x0F), 5, "UV index goes out because ExpandCapability 0x2f is set")
        XCTAssertEqual(try current.byte(0x10), 78, "extended hourly values go out because ExpandCapability 0xc0 is set")
        XCTAssertEqual(try current.object(0x81).short(0x03), 0x0203)
        XCTAssertEqual(try current.object(0x85).byte(0x07), 31)

        let gps = requests[6].tlv
        XCTAssertEqual(try gps.int(0x01), Int32(now - 86400))

        let forecast = requests[7].tlv
        XCTAssertEqual(try forecast.object(0x81).objects(0x82).count, 24)
        XCTAssertEqual(try forecast.object(0x90).objects(0x91).count, 8)
        XCTAssertTrue(h.log.contains("Weather support bitmap 0xff"))
        XCTAssertTrue(h.log.contains("Weather extended bitmap 0x0007"))
        XCTAssertTrue(h.log.contains("Weather sun/moon bitmap 0x03"))
        XCTAssertTrue(h.log.contains("Weather current: Bandung 28\u{00B0}C CLOUDY (WMO 2), unit fahrenheit"))
        XCTAssertTrue(h.log.contains("Weather step WeatherGps: answered 0x000186a0 in "))
        XCTAssertTrue(h.log.contains("Weather forecast sent: 24 hours, 8 days"))
        XCTAssertEqual(outcome, ForecastOutcome(state: .sent, hours: 24, days: 8, replyCode: 0x000186A0, atSec: now))
    }

    func testWhatTheWatchDoesNotAnnounceIsNotSent() async throws {
        let h = SleepFilesHarness()
        // Only weather (01), support (02) and start (09): no unit, extended, sun/moon, forecast; no GPS service.
        installWatch(h, support: 0x01 | 0x10, extended: 0, sunMoon: 0)
        let caps = caps(commands: [0x0F: [0x01, 0x02, 0x09]])
        try await sender(h, caps).send(report: report(), unit: .celsius, nowSec: now, zone: zone)

        XCTAssertEqual(keys(h), ["0f/09", "0f/02", "0f/01"])
        let current = h.watch.requests[2].tlv
        XCTAssertEqual(try current.string(0x08), "Bandung", "the support bitmap lists the location name")
        // No 0f/06 is listed, so the icon flag follows bit 0 of the support bitmap; wind (bit 1) is not announced.
        XCTAssertTrue(try current.object(0x81).contains(0x02), "bit 0 of the support bitmap is the icon when the watch lists no 0f/06")
        XCTAssertFalse(try current.object(0x81).contains(0x03), "wind is not announced")
        XCTAssertFalse(current.contains(0x09), "current temperature is not announced")
        XCTAssertFalse(current.contains(0x0F), "UV index needs ExpandCapability 0x2f")
        XCTAssertFalse(current.contains(0x10), "extended values need ExpandCapability 0xc0")
    }

    func testExtendedSupportBitsGateTheirTags() async throws {
        let h = SleepFilesHarness()
        installWatch(h, support: 0xFF, extended: 0x01 | 0x04, sunMoon: 0)
        let caps = caps(commands: Self.all)
        try await sender(h, caps).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
        let current = h.watch.requests.first { $0.service == 0x0F && $0.command == 0x01 }!.tlv
        XCTAssertTrue(current.contains(0x0C), "time supported")
        XCTAssertFalse(current.contains(0x0E), "source not supported")
        XCTAssertTrue(try current.object(0x81).contains(0x02), "icon supported")
        let forecast = h.watch.requests.first { $0.service == 0x0F && $0.command == 0x08 }!.tlv
        let day = try forecast.object(0x90).objects(0x91)[0]
        XCTAssertFalse(day.contains(0x16), "sun times need the sun/moon bit")
        XCTAssertFalse(day.contains(0x1E), "moon phase needs the sun/moon bit")
        XCTAssertTrue(day.contains(0x13))
    }

    func testAWatchWithoutTheWeatherServiceIsNeverSentAnything() async {
        let h = SleepFilesHarness()
        installWatch(h)
        do {
            try await sender(h, caps(commands: [0x0F: [0x02, 0x09]])).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
            XCTFail("sent to a watch that does not list weather")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertTrue(h.watch.requests.isEmpty)
    }

    func testARefusedStartEndsTheChain() async {
        let h = SleepFilesHarness()
        installWatch(h, startCode: 0x000186A1)
        do {
            try await sender(h, caps(commands: Self.all)).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
            XCTFail("the chain went on after a refusal")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .protocolError)
            XCTAssertTrue(e.message.contains("0x000186a1"), e.message)
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertEqual(keys(h), ["0f/09"])
    }

    func testBothSuccessCodesOfStartAreAccepted() async throws {
        for code: Int32 in [0x000186A0, 0x000186A3] {
            let h = SleepFilesHarness()
            installWatch(h, startCode: code)
            try await sender(h, caps(commands: [0x0F: [0x01, 0x02, 0x09]])).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
            XCTAssertEqual(keys(h).last, "0f/01")
        }
    }

    func testAnUnreadableSupportAnswerIsAProtocolError() async {
        let h = SleepFilesHarness()
        h.watch.responder = { request in
            var tlv = HuaweiTLV()
            if request.command == 0x09 { tlv.put(0x7F, int: 0x000186A0) } else { tlv.put(0x05, byte: 1) } // support answer without tag 1
            return [SleepFilesFakeWatch.tlvFrame(service: request.service, command: request.command, tlv)]
        }
        do {
            try await sender(h, caps(commands: [0x0F: [0x01, 0x02, 0x09]])).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
            XCTFail("a support answer without a bitmap was accepted")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .protocolError)
            XCTAssertTrue(e.isParseFailure)
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertEqual(keys(h), ["0f/09", "0f/02"])
    }

    func testAMissingGpsAnswerIsSkippedAndTheForecastStillGoes() async throws {
        let h = SleepFilesHarness()
        installWatch(h, silent: ["18/07"])
        try await sender(h, caps(commands: Self.all)).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
        XCTAssertEqual(keys(h).last, "0f/08")
        XCTAssertTrue(h.log.containsError("Weather step WeatherGps: no answer within 300 ms"))
    }

    func testANonOkReplyCodeIsLoggedNotFatal() async throws {
        let h = SleepFilesHarness()
        installWatch(h)
        let base = h.watch.responder
        h.watch.responder = { request in
            if request.command == 0x01 && request.service == 0x0F {
                var tlv = HuaweiTLV()
                tlv.put(0x7F, int: 0x000186A5)
                return [SleepFilesFakeWatch.tlvFrame(service: 0x0F, command: 0x01, tlv)]
            }
            return base(request)
        }
        try await sender(h, caps(commands: Self.all)).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
        XCTAssertTrue(h.log.contains("Weather step WeatherCurrent: answered 0x000186a5 in "))
        XCTAssertEqual(keys(h).last, "0f/08")
    }

    func testAnUnlistedForecastCommandIsSkippedWithItsLogLine() async throws {
        let h = SleepFilesHarness()
        installWatch(h)
        let outcome = try await sender(h, caps(commands: [0x0F: [0x01, 0x02, 0x09]])).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
        XCTAssertEqual(outcome, ForecastOutcome(state: .unsupported, hours: 0, days: 0, replyCode: nil, atSec: now))
        XCTAssertEqual(keys(h), ["0f/09", "0f/02", "0f/01"])
        XCTAssertTrue(h.log.contains("Weather forecast skipped: the watch does not list 0f/08, so it only gets current weather (GB supportsWeatherForecasts)"))
    }

    func testASilentCurrentAndGpsAnswerDoNotStopTheForecast() async throws {
        let h = SleepFilesHarness()
        installWatch(h, silent: ["0f/01", "18/07"])
        let outcome = try await sender(h, caps(commands: Self.all)).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
        XCTAssertEqual(Array(keys(h).suffix(3)), ["0f/01", "18/07", "0f/08"])
        XCTAssertEqual(outcome.state, .sent)
        XCTAssertEqual(outcome.hours, 24)
        XCTAssertEqual(outcome.days, 8)
        XCTAssertTrue(h.log.containsError("Weather step WeatherCurrent: no answer within 300 ms"))
        XCTAssertTrue(h.log.containsError("Weather step WeatherGps: no answer within 300 ms"))
        XCTAssertEqual(WeatherDiagnostics.last?.steps.filter { $0.contains("no answer") }.count, 2)
    }

    func testASilentForecastIsUnacknowledged() async throws {
        let h = SleepFilesHarness()
        installWatch(h, silent: ["0f/08"])
        let outcome = try await sender(h, caps(commands: Self.all)).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
        XCTAssertEqual(outcome, ForecastOutcome(state: .unacknowledged, hours: 24, days: 8, replyCode: nil, atSec: now))
        XCTAssertTrue(h.log.containsError("Weather forecast sent but never acknowledged"))
        XCTAssertTrue(h.log.containsError("Weather step WeatherForecast: no answer within 300 ms"))
    }

    func testANonOkAnswerCodeOfTheForecastIsRejectedAndAnOkOneIsSent() async throws {
        let rejected = SleepFilesHarness()
        installWatch(rejected)
        let base = rejected.watch.responder
        rejected.watch.responder = { request in
            if request.service == 0x0F && request.command == 0x08 {
                var tlv = HuaweiTLV()
                tlv.put(0x7F, int: 0x000186A5)
                return [SleepFilesFakeWatch.tlvFrame(service: 0x0F, command: 0x08, tlv)]
            }
            return base(request)
        }
        let outcome = try await sender(rejected, caps(commands: Self.all)).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
        XCTAssertEqual(outcome, ForecastOutcome(state: .rejected, hours: 24, days: 8, replyCode: 0x000186A5, atSec: now))
        XCTAssertTrue(rejected.log.containsError("Weather forecast not taken: the watch answered 0x000186a5"))

        // 0x186A3 is the second success code of GB's WeatherStart.Response.
        for code: Int32 in [0x000186A0, 0x000186A3] {
            let accepted = SleepFilesHarness()
            installWatch(accepted)
            let acceptedBase = accepted.watch.responder
            accepted.watch.responder = { request in
                if request.service == 0x0F && request.command == 0x08 {
                    var tlv = HuaweiTLV()
                    tlv.put(0x7F, int: code)
                    return [SleepFilesFakeWatch.tlvFrame(service: 0x0F, command: 0x08, tlv)]
                }
                return acceptedBase(request)
            }
            let sent = try await sender(accepted, caps(commands: Self.all)).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
            XCTAssertEqual(sent, ForecastOutcome(state: .sent, hours: 24, days: 8, replyCode: code, atSec: now))
            XCTAssertTrue(accepted.log.contains("Weather forecast sent: 24 hours, 8 days"))
        }
    }

    func testAMissingStartAnswerStillThrowsAndIsRecorded() async {
        WeatherDiagnostics.last = nil
        let h = SleepFilesHarness()
        installWatch(h, silent: ["0f/09"])
        do {
            try await sender(h, caps(commands: Self.all)).send(report: report(), unit: .celsius, nowSec: now, zone: zone, reason: "app")
            XCTFail("the push went on without an answer to start")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .timeout)
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertEqual(keys(h), ["0f/09"])
        let snapshot = WeatherDiagnostics.last
        XCTAssertEqual(snapshot?.reason, "app")
        XCTAssertEqual(snapshot?.steps, [])
        XCTAssertNil(snapshot?.forecast)
        XCTAssertTrue(snapshot?.failure?.hasPrefix("ERR_TIMEOUT: ") == true, snapshot?.failure ?? "nil")
    }

    func testTheDiagnosticsSnapshotAndSummaryDescribeTheLastPush() async throws {
        WeatherDiagnostics.last = nil
        let watchCaps = caps(commands: Self.all, bits: [0x2F, 0xC0])
        XCTAssertEqual(
            WeatherDiagnostics.summary(enabled: false, caps: DeviceCaps(), nowSec: now),
            [
                "Weather: switch off; gates (last connect) current(0f/01)=no unit(0f/05)=no extended(0f/06)=no forecast(0f/08)=no sunMoon(0f/0a)=no "
                    + "errorSimple(0f/07)=no errorExtended(0f/0c)=no gps(18/06)=no uvIndex(cap 0x2f)=no extendedHourly(cap 0xc0)=no",
                "Weather last push: none in this process",
            ]
        )

        let h = SleepFilesHarness()
        installWatch(h)
        _ = try await sender(h, watchCaps).send(report: report(), unit: .celsius, nowSec: now, zone: zone, reason: "manual")
        XCTAssertTrue(
            h.log.contains(
                "Weather gates: current(0f/01)=yes unit(0f/05)=yes extended(0f/06)=yes forecast(0f/08)=yes sunMoon(0f/0a)=yes "
                    + "errorSimple(0f/07)=yes errorExtended(0f/0c)=yes gps(18/06)=yes uvIndex(cap 0x2f)=yes extendedHourly(cap 0xc0)=yes"
            )
        )
        XCTAssertTrue(
            h.log.contains(
                "Weather flags the packets will follow: icon=true temperatureRange=true currentTemperature=true sunRiseSet=true moonPhase=true extendedHourly=true"
            )
        )

        let snapshot = try XCTUnwrap(WeatherDiagnostics.last)
        XCTAssertEqual(snapshot.atSec, now)
        XCTAssertEqual(snapshot.reason, "manual")
        XCTAssertEqual(snapshot.bitmaps, ["support 0xff", "extended 0x0007", "sunMoon 0x03"])
        XCTAssertEqual(
            snapshot.steps.map { String($0.split(separator: " ")[0]) },
            ["WeatherStart", "WeatherUnit", "WeatherSupport", "WeatherExtendedSupport", "WeatherSunMoonSupport", "WeatherCurrent", "WeatherGps", "WeatherForecast"]
        )
        XCTAssertTrue(snapshot.steps[0].hasPrefix("WeatherStart answered 0x000186a0 in "), snapshot.steps[0])
        XCTAssertTrue(snapshot.steps[0].hasSuffix(" ms"))
        XCTAssertEqual(snapshot.forecast, ForecastOutcome(state: .sent, hours: 24, days: 8, replyCode: 0x000186A0, atSec: now))
        XCTAssertTrue(snapshot.shape?.hasPrefix("24 hours (tags 03 04 05 06 07), 8 days (tags 12 13 14 15") == true, snapshot.shape ?? "nil")
        XCTAssertNil(snapshot.failure)
        XCTAssertTrue(h.log.contains("Weather forecast: \(snapshot.shape!), first hour 2026-10-14T04:00:00Z"))

        let lines = WeatherDiagnostics.summary(enabled: true, caps: watchCaps, nowSec: now + 150)
        XCTAssertTrue(lines[0].hasPrefix("Weather: switch on; gates (last connect) current(0f/01)=yes"))
        XCTAssertEqual(lines[1], "Weather last push: manual, 2 min ago; support 0xff, extended 0x0007, sunMoon 0x03")
        XCTAssertTrue(lines[2].hasPrefix("  steps: WeatherStart answered 0x000186a0 in "), lines[2])
        XCTAssertEqual(lines.count, 4)
        XCTAssertEqual(lines[3], "  forecast: sent reply 0x000186a0, \(snapshot.shape!)")
    }

    func testAWatchWithoutExtendedSupportTakesTheIconFlagFromTheBasicSupportBitmap() async throws {
        // A Fit 2 class answer: no 0f/06 and no 0f/0a listed; bit 0 of the support bitmap is the icon.
        let h = SleepFilesHarness()
        installWatch(h)
        WeatherDiagnostics.last = nil
        _ = try await sender(h, caps(commands: [0x0F: [0x01, 0x08, 0x09, 0x02]])).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
        XCTAssertEqual(WeatherDiagnostics.last?.shape, "24 hours (tags 03 04 05), 8 days (tags 12 13 14 15)")
        XCTAssertEqual(WeatherDiagnostics.last?.bitmaps, ["support 0xff"])
        XCTAssertTrue(h.log.contains("Weather: the watch lists no 0f/06, so the icon flag follows bit 0 of the support bitmap (true)"))
        XCTAssertTrue(h.log.contains("Weather flags the packets will follow: icon=true"))
    }

    func testAWatchWithoutExtendedSupportAndWithoutBitZeroGetsNoIcons() async throws {
        let h = SleepFilesHarness()
        installWatch(h, support: 0xFE)
        _ = try await sender(h, caps(commands: [0x0F: [0x01, 0x08, 0x09, 0x02]])).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
        XCTAssertEqual(WeatherDiagnostics.last?.shape, "24 hours (tags 03 05), 8 days (tags 12 14 15)")
    }

    func testAWatchThatListsExtendedSupportKeepsGbsIconFlag() async throws {
        // Extended support answers bit 2 clear: the icon flag stays off whatever bit 0 of the basic bitmap says.
        let h = SleepFilesHarness()
        installWatch(h, extended: 0x0003)
        _ = try await sender(h, caps(commands: [0x0F: [0x01, 0x02, 0x06, 0x08, 0x09]])).send(report: report(), unit: .celsius, nowSec: now, zone: zone)
        XCTAssertEqual(WeatherDiagnostics.last?.shape, "24 hours (tags 03 05), 8 days (tags 12 14 15)")
        XCTAssertFalse(h.log.contains("lists no 0f/06"))
    }

    func testTheForecastOutcomeIsTheJsShape() {
        let sent = ForecastOutcome(state: .sent, hours: 24, days: 8, replyCode: 0x000186A0, atSec: 1_760_412_600).toJS()
        XCTAssertEqual(Set(sent.keys), ["state", "hours", "days", "replyCode", "at"])
        XCTAssertEqual(sent["state"] as? String, "sent")
        XCTAssertEqual(sent["hours"] as? Int, 24)
        XCTAssertEqual(sent["days"] as? Int, 8)
        XCTAssertEqual(sent["replyCode"] as? Int, 0x000186A0)
        XCTAssertEqual(sent["at"] as? Int64, 1_760_412_600)
        let silent = ForecastOutcome(state: .unacknowledged, hours: 24, days: 8, replyCode: nil, atSec: 5).toJS()
        XCTAssertTrue(silent["replyCode"] is NSNull)
        XCTAssertEqual(
            [ForecastState.sent, .unsupported, .unacknowledged, .rejected].map(\.wire),
            ["sent", "unsupported", "unacknowledged", "rejected"]
        )
    }

    func testErrorsGoOutOnTheExtendedOrTheSimpleCommand() async throws {
        let extended = SleepFilesHarness()
        installWatch(extended)
        let sentExtended = try await sender(extended, caps(commands: Self.all)).sendError(.gpsPermissionError)
        XCTAssertTrue(sentExtended)
        XCTAssertEqual(keys(extended), ["0f/0c"])
        XCTAssertEqual(try extended.watch.requests[0].tlv.object(0x81).byte(0x02), 1)

        let simple = SleepFilesHarness()
        installWatch(simple)
        let sentSimple = try await sender(simple, caps(commands: [0x0F: [0x01, 0x07]])).sendError(.networkError)
        XCTAssertTrue(sentSimple)
        XCTAssertEqual(keys(simple), ["0f/07"])
        XCTAssertEqual(try simple.watch.requests[0].tlv.byte(0x01), 0)

        let none = SleepFilesHarness()
        installWatch(none)
        let sentNone = try await sender(none, caps(commands: [0x0F: [0x01]])).sendError(.weatherDisabled)
        XCTAssertFalse(sentNone, "a watch that lists neither error command is told nothing")
        XCTAssertTrue(none.watch.requests.isEmpty)
    }

    func testAcknowledgeIsAnUnencryptedDeviceRequest() async throws {
        let h = SleepFilesHarness()
        installWatch(h)
        try await sender(h, caps(commands: Self.all)).acknowledge()
        let request = h.watch.requests[0]
        XCTAssertEqual(request.service, 0x0F)
        XCTAssertEqual(request.command, 0x04)
        XCTAssertFalse(request.encrypted)
        XCTAssertEqual(try request.tlv.int(0x01), 0x000186A0)
    }
}

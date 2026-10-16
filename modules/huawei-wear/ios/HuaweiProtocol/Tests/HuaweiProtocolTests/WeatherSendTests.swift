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
        HuaweiWeatherSender(session: h.session, caps: caps, log: h.log.sink)
    }

    private func keys(_ h: SleepFilesHarness) -> [String] { h.watch.requests.map { String(format: "%02x/%02x", $0.service, $0.command) } }

    func testTheFullChainRunsInGbOrderAndCarriesTheReport() async throws {
        let h = SleepFilesHarness()
        installWatch(h)
        let caps = caps(commands: Self.all, bits: [0x2F, 0xC0])
        try await sender(h, caps).send(report: report(), unit: .fahrenheit, nowSec: now, zone: zone)

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
        XCTAssertTrue(h.log.contains("Weather current sent: Bandung 28\u{00B0}C CLOUDY (WMO 2), unit fahrenheit"))
        XCTAssertTrue(h.log.contains("Weather position sent to the watch"))
        XCTAssertTrue(h.log.contains("Weather forecast sent: 8 days, hourly from 2026-10-14T03:30:00Z"))
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
        XCTAssertFalse(current.contains(0x81), "neither icon nor wind is announced")
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
        XCTAssertTrue(h.log.containsError("Weather position skipped"))
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
        XCTAssertTrue(h.log.contains("WeatherCurrent: reply code 0x000186a5"))
        XCTAssertEqual(keys(h).last, "0f/08")
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

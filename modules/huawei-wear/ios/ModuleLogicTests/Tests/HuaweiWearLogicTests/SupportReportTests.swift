import XCTest
@testable import HuaweiWearLogic

final class SupportReportTests: XCTestCase {
    func testConnectLinesSurviveADayOfSyncChatter() {
        let log = SupportLog()
        log.connectStarted()
        for i in 0..<10 { log.add("connect \(i)", atMs: Int64(i)) }
        for i in 0..<1_000 { log.add("sync \(i)", atMs: Int64(100 + i)) }
        let lines = log.lines()
        // The connect part (first 600 lines since connectStarted) and the tail (last 400) are kept, each line once, oldest first.
        XCTAssertEqual(lines.count, 600 + 400)
        XCTAssertEqual(lines.first?.text, "connect 0")
        XCTAssertEqual(lines.last?.text, "sync 999")
        XCTAssertEqual(lines.map(\.seq), lines.map(\.seq).sorted())
        XCTAssertEqual(Set(lines.map(\.seq)).count, lines.count)
    }

    func testAnEarlierConnectIsForgottenWhenANewOneStarts() {
        let log = SupportLog()
        log.add("old connect")
        log.connectStarted()
        log.add("new connect")
        XCTAssertEqual(log.lines().map(\.text), ["old connect", "new connect"], "short logs fit the tail entirely")
        for _ in 0..<500 { log.add("x") }
        XCTAssertTrue(log.lines().map(\.text).contains("new connect"))
        XCTAssertFalse(log.lines().map(\.text).contains("old connect"), "old connect fell out of the tail and is not in the new connect part")
    }

    func testRedactionRemovesAddressesSerialAndIdentifiers() {
        let id = "6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77"
        let text = "mac aa:bb:cc:dd:ee:ff and AA:BB:CC:DD:EE:FF, serial=ABC123XYZ end, SN-1234-5678 id \(id.lowercased()) also \(id)"
        let out = SupportReport.redact(text, serial: "SN-1234-5678", identifiers: [id])
        XCTAssertFalse(out.contains("aa:bb"))
        XCTAssertFalse(out.contains("AA:BB"))
        XCTAssertFalse(out.contains("ABC123XYZ"))
        XCTAssertFalse(out.contains("SN-1234-5678"))
        XCTAssertFalse(out.lowercased().contains(id.lowercased()))
        XCTAssertTrue(out.contains("XX:XX:XX:XX:XX:XX"))
        XCTAssertTrue(out.contains("serial=(left out)"))
        XCTAssertTrue(out.contains("(serial left out)"))
        XCTAssertTrue(out.contains("(device id left out)"))
    }

    func testAShortSerialIsNotRedactedEverywhere() {
        XCTAssertEqual(SupportReport.redact("abc 123", serial: "abc", identifiers: []), "abc 123")
    }

    func testReportShape() {
        let caps = DeviceCaps()
        caps.supportedCommands = [0x07: [0x01, 0x0c], 0x01: [0x01]]
        caps.expandCapabilities = [0x0A, 0xFF]
        let info = WatchDeviceInfo(
            address: "6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77", name: "HUAWEI WATCH FIT 4 Pro-40A", productModel: "ALT-B19", softwareVersion: "6.1.0", hardwareVersion: "hw",
            serialNumber: "SERIAL12345", batteryLevel: 71, authMode: .hichain3, model: "Huawei Watch Fit 4 Pro", support: .tested
        )
        let lines = [
            SupportLog.Line(seq: 0, atMs: 1_000, text: "STATE connecting"),
            SupportLog.Line(seq: 5, atMs: 2_000, text: "INFO connected to 6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77 SERIAL12345"),
        ]
        let report = SupportReport.build(
            environment: .init(app: "com.joyodigitama.joyofit 1.2.3 (45)", phone: "Apple iPhone15,2, iOS 18.1"),
            watchName: nil, device: info, linkState: "connected", log: lines, caps: caps, transport: .le,
            identifiers: [info.address], nowMs: 1_700_000_000_000
        )
        let summary = report["summary"] as! String
        XCTAssertTrue(summary.hasPrefix("JoyoFit support report\nCreated: "))
        XCTAssertTrue(summary.contains("App: com.joyodigitama.joyofit 1.2.3 (45)\nPhone: Apple iPhone15,2, iOS 18.1\n"))
        XCTAssertTrue(summary.contains("Watch: HUAWEI WATCH FIT 4 Pro-40A\nModel: Huawei Watch Fit 4 Pro (tested)\n"))
        XCTAssertTrue(summary.contains("Product: ALT-B19, software 6.1.0, hardware hw, auth hichain3\n"))
        XCTAssertTrue(summary.contains("Transport: Bluetooth LE (GATT)\nLink: connected\n"))
        XCTAssertTrue(summary.contains("Supported commands (last connect, service: commands):\n  01: 01\n  07: 01 0c\n"))
        XCTAssertTrue(summary.contains("ExpandCapability: 0AFF\n"))
        XCTAssertTrue(summary.hasSuffix("Bluetooth addresses and the serial number are left out."))
        let log = report["log"] as! String
        XCTAssertTrue(log.hasPrefix("Log, oldest first (2 lines):\n"))
        XCTAssertTrue(log.contains("... 4 lines left out ...\n"))
        XCTAssertFalse(log.contains("SERIAL12345"))
        XCTAssertFalse(log.contains("6B1C2A55"))
        XCTAssertEqual(report["watch"] as? String, "HUAWEI WATCH FIT 4 Pro-40A")
        XCTAssertEqual(report["model"] as? String, "Huawei Watch Fit 4 Pro")
        XCTAssertEqual(report["support"] as? String, "tested")
    }

    func testReportBeforeAnyConnect() {
        let report = SupportReport.build(
            environment: .init(app: "app", phone: "phone"), watchName: nil, device: nil, linkState: "disconnected", log: [], caps: nil, transport: nil
        )
        let summary = report["summary"] as! String
        XCTAssertTrue(summary.contains("Watch: none yet\nModel: not in the list (unknown)\nTransport: none yet\nLink: disconnected\nExpandCapability: none\n"))
        XCTAssertTrue(report["watch"] is NSNull)
        XCTAssertTrue(report["model"] is NSNull)
        XCTAssertEqual(report["support"] as? String, "unknown")
    }
}

import XCTest
@testable import HuaweiProtocol

final class NotificationPacketsTests: XCTestCase {
    func testNotificationStateRequestMatchesJava() throws {
        let cases = try Golden.load("notifications").list("requests")
        XCTAssertEqual(cases.count, 2)
        for c in cases {
            let name = c.str("name")
            let packet = Notifications.NotificationState.request(enabled: c.bool("enabled"))
            XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name)
            XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name)
            XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name)
            XCTAssertEqual(packet.isSliced, c.bool("sliced"), name)
            XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), name)
            XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], name)
        }
    }
}

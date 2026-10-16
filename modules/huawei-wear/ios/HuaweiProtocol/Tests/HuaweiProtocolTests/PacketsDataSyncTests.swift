import XCTest
@testable import HuaweiProtocol

final class PacketsDataSyncTests: XCTestCase {
    let g = try! Golden.load("packetsDataSync")

    private func items(_ list: [[String: Any]]) -> [DataSync.ConfigData] {
        list.map {
            DataSync.ConfigData(
                configId: Int32(truncatingIfNeeded: $0.int("configId")), configAction: Int8(truncatingIfNeeded: $0.int("configAction")),
                configData: $0.optBytes("configData"), configUnknown: Int64(truncating: ($0["configUnknown"] as? NSNumber) ?? -1)
            )
        }
    }

    func testConfigRequestsMatchJava() throws {
        let requests = g.list("requests")
        XCTAssertGreaterThanOrEqual(requests.count, 6)
        for c in requests {
            let name = c.str("name")
            let packet = DataSync.ConfigCommand.request(srcPackage: c.str("src"), dstPackage: c.str("dst"), configs: items(c.list("items")))
            XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name)
            XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name)
            XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name)
            XCTAssertEqual(packet.isSliced, c.bool("sliced"), name)
            XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), name)
            XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], name)
        }
    }

    func testConfigResponsesMatchJava() throws {
        let responses = g.list("responses")
        XCTAssertEqual(responses.count, 12)
        var failures = 0
        for c in responses {
            let name = c.str("name")
            let packet = try PacketsKit.tlvPacket(c.int("service"), c.int("command"), c.str("tlv"))
            do {
                let r = try DataSync.ConfigCommand.Response(packet: packet)
                guard c.bool("ok") else {
                    XCTFail("\(name): Java failed with \(c.str("exception")) but Swift parsed")
                    continue
                }
                let f = (c["fields"] as? [String: Any]) ?? [:]
                XCTAssertEqual(r.srcPackage, f.str("srcPackage"), name)
                XCTAssertEqual(r.dstPackage, f.str("dstPackage"), name)
                XCTAssertEqual(Int(r.code), f.int("code"), name)
                XCTAssertEqual(r.configs, items(f.list("configs")), name)
            } catch {
                guard !c.bool("ok") else {
                    XCTFail("\(name): Java parsed but Swift failed with \(error)")
                    continue
                }
                failures += 1
                let (swiftName, swiftParse) = PacketsKit.exceptionClass(error)
                XCTAssertEqual(swiftParse, c.bool("parseException"), "\(name): Java \(c.str("exception")), Swift \(swiftName)")
                if c.bool("parseException") { XCTAssertEqual(swiftName, c.str("exception"), name) }
            }
        }
        XCTAssertGreaterThanOrEqual(failures, 4)
    }

    func testFindDeviceStartAndStopAreTheDocumentedConfig() throws {
        let start = DataSync.ConfigCommand.request(
            srcPackage: DataSync.findDeviceSrcPackage, dstPackage: DataSync.findDeviceDstPackage,
            configs: [DataSync.ConfigData(configId: DataSync.findDeviceConfigId, configAction: 2)]
        )
        let sub = try start.tlv!.object(0x83).objects(0x84)
        XCTAssertEqual(sub.count, 1)
        XCTAssertEqual(try sub[0].int(0x05), 900_100_002)
        XCTAssertEqual(try sub[0].byte(0x06), 2)
    }
}

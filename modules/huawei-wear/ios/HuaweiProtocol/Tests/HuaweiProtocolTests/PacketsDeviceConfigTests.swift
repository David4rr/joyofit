import XCTest
@testable import HuaweiProtocol

/// Helpers shared by the Packets*Tests files.
enum PacketsKit {
    static func hex(_ b: Bytes?) -> Any { b.map { $0.hexLower as Any } ?? NSNull() }

    /// Sorted-key JSON text: two structures are equal when this is.
    static func canonical(_ value: Any) -> String {
        let wrapped: [String: Any] = ["v": value]
        let data = try! JSONSerialization.data(withJSONObject: wrapped, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }

    static func tlvPacket(_ service: Int, _ command: Int, _ tlvHex: String) throws -> HuaweiPacket {
        HuaweiPacket(serviceId: UInt8(service), commandId: UInt8(command), tlv: try HuaweiTLV(parsing: Bytes(hex: tlvHex)!))
    }

    /// Frames with encryption off, as the Java golden produced them.
    static func frames(_ packet: HuaweiPacket, sliceSize: Int = 0xf4) throws -> [String] {
        let params = ParamsProvider()
        params.transactionsCrypted = false
        params.sliceSize = sliceSize
        return try packet.serialize(params: params).map { $0.hexLower }
    }

    /// The Java exception class a Swift failure stands for.
    static func exceptionClass(_ error: Error) -> (name: String, isParse: Bool) {
        if let e = error as? PacketError {
            switch e {
            case .missingTag: return ("MissingTagException", true)
            case .json: return ("JsonException", true)
            case .crypto: return ("CryptoException", true)
            case .supportedCommandsList: return ("SupportedCommandsListException", true)
            default: return ("\(e)", true)
            }
        }
        if let e = error as? WearError { return ("runtime: \(e.message)", e.isParseFailure) }
        return ("\(error)", false)
    }
}

final class PacketsDeviceConfigTests: XCTestCase {
    let g = try! Golden.load("packetsDeviceConfig")

    override func tearDown() {
        Entropy.provider = Entropy.systemProvider
    }

    // MARK: requests

    private func tlv(_ c: [String: Any]) throws -> HuaweiTLV { try HuaweiTLV(parsing: c.bytes("tlv")) }

    /// Rebuilds a request from the inputs the Java TLV carries and returns the Swift packet.
    private func swiftRequest(_ name: String, _ java: HuaweiTLV) throws -> HuaweiPacket? {
        func bytes(_ tag: Int) -> Bytes { (try? java.bytes(tag)) ?? [] }
        switch name {
        case "LinkParams AW": return DeviceConfig.LinkParams.request(deviceType: .aw)
        case "LinkParams BLE": return DeviceConfig.LinkParams.request(deviceType: .ble)
        case "LinkParams BR": return DeviceConfig.LinkParams.request(deviceType: .br)
        case "SupportedServices known": return DeviceConfig.SupportedServices.request(allSupportedServices: DeviceConfig.SupportedServices.knownSupportedServices)
        case "ProductInfo AW": return DeviceConfig.ProductInfo.request(deviceType: .aw)
        case "ProductInfo BLE": return DeviceConfig.ProductInfo.request(deviceType: .ble)
        case "ProductInfo BR": return DeviceConfig.ProductInfo.request(deviceType: .br)
        case "Bond": return DeviceConfig.Bond.request(clientSerial: bytes(5), key: bytes(6), iv: bytes(7))
        case "BondParams": return DeviceConfig.BondParams.request(clientSerial: bytes(3), mac: bytes(7))
        case "Auth authMode 0", "Auth authMode 2 algo 1", "Auth authMode 2 algo 0x81":
            let p = ParamsProvider()
            p.authMode = name.contains("authMode 2") ? 2 : 0
            p.authAlgo = name.hasSuffix("0x81") ? 0x81 : 1
            return DeviceConfig.Auth.request(params: p, challenge: bytes(1), nonce: bytes(2))
        case "BatteryLevel": return DeviceConfig.BatteryLevel.request()
        case "DeviceStatus ask": return DeviceConfig.DeviceStatus.request(askStatus: true)
        case "DeviceStatus notify": return DeviceConfig.DeviceStatus.request(askStatus: false)
        case "PinCode": return DeviceConfig.PinCode.request()
        case "SettingRelated": return DeviceConfig.SettingRelated.request()
        case "ConnectStatus": return DeviceConfig.ConnectStatusRequest.request()
        case "ExpandCapability": return DeviceConfig.ExpandCapability.request()
        case "WearStatus": return DeviceConfig.WearStatus.request()
        case "SetUpDeviceStatus main": return DeviceConfig.SetUpDeviceStatusRequest.request(relationShip: 1, deviceName: "HUAWEI WATCH FIT 4 Pro-40A")
        case "SetUpDeviceStatus empty name": return DeviceConfig.SetUpDeviceStatusRequest.request(relationShip: 0, deviceName: "")
        case "SetUpDeviceStatus relationship 300": return DeviceConfig.SetUpDeviceStatusRequest.request(relationShip: 300, deviceName: "Watch \u{e9}")
        case "ReverseCapabilities": return DeviceConfig.ReverseCapabilities.request()
        case "AcceptAgreement":
            // The Java request embeds System.currentTimeMillis(): read it back out of the first agreement.
            let first = try java.object(0x81).objects(0x82)[0]
            return DeviceConfig.AcceptAgreement.request(timestampMillis: Int64(try first.string(0x06))!)
        default:
            if name.hasPrefix("SecurityNegotiation mode ") {
                let parts = name.split(separator: " ")
                let mode = UInt8(parts[2])!
                let p = ParamsProvider()
                p.encryptMethod = UInt8(parts[4])!
                return DeviceConfig.SecurityNegotiation.request(params: p, authMode: mode, deviceUUID: bytes(5), phoneModel: "iPhone17,1")
            }
            if name.hasPrefix("ExtendedAccount") {
                return AccountRelated.SendExtendedAccountToDevice.request(
                    accountPairingOptimization: name.contains("opt=true"),
                    account: name.contains("user@example.com") ? "user@example.com" : ""
                )
            }
            return nil
        }
    }

    func testRequestsMatchJava() throws {
        let requests = g.list("requests")
        XCTAssertGreaterThan(requests.count, 30)
        for c in requests {
            let name = c.str("name")
            let java = try tlv(c)
            guard let packet = try swiftRequest(name, java) else {
                XCTFail("no Swift request for golden '\(name)'")
                continue
            }
            XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name)
            XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name)
            XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), "\(name): isEncrypted")
            XCTAssertEqual(packet.isSliced, c.bool("sliced"), "\(name): isSliced")
            XCTAssertEqual((packet.tlv ?? HuaweiTLV()).serialize().hexLower, c.str("tlv"), "\(name): tlv")
            XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], "\(name): frames")
        }
    }

    // MARK: SupportedCommands

    func testCommandTableAndServiceListMatchJava() {
        let table = (g["commandsPerService"] as? [String: String]) ?? [:]
        XCTAssertEqual(table.count, DeviceConfig.SupportedCommands.commandsPerService.count)
        for (service, commands) in table {
            XCTAssertEqual(DeviceConfig.SupportedCommands.commandsPerService[Int(service)!]?.hexLower, commands, "service \(service)")
        }
        XCTAssertEqual(DeviceConfig.SupportedServices.knownSupportedServices.hexLower, g.str("knownSupportedServices"))
    }

    func testSupportedCommandsPackingMatchesJava() throws {
        let table = DeviceConfig.SupportedCommands.commandsPerService
        for c in g.list("supportedCommandsPacking") {
            let slice = c.int("sliceSize")
            let params = ParamsProvider()
            params.sliceSize = slice
            var request = DeviceConfig.SupportedCommands.Request(params: params)
            var accepted = [Bool]()
            for service in table.keys.sorted() { accepted.append(request.addCommandsForService(UInt8(service), table[service]!)) }
            XCTAssertEqual(accepted, (c["accepted"] as? [Bool]) ?? [], "slice \(slice)")
            let packet = request.packet
            XCTAssertEqual((packet.tlv ?? HuaweiTLV()).serialize().hexLower, c.str("tlv"), "slice \(slice): tlv")
            XCTAssertEqual(try PacketsKit.frames(packet, sliceSize: slice), (c["frames"] as? [String]) ?? [], "slice \(slice): frames")
            XCTAssertTrue(packet.isEncrypted && packet.isSliced)
        }
    }

    func testSupportedCommandsFitsRealSliceSizeInThreeOrFewerRequests() {
        // 1022-byte slices (the Fit 4 Pro): every service's commands are packed, none dropped, and an empty request accepts at least one.
        let params = ParamsProvider()
        params.sliceSize = 1022
        var left = DeviceConfig.SupportedCommands.commandsPerService.keys.sorted()
        var requests = 0
        while !left.isEmpty {
            var request = DeviceConfig.SupportedCommands.Request(params: params)
            var took = 0
            while let next = left.first, request.addCommandsForService(UInt8(next), DeviceConfig.SupportedCommands.commandsPerService[next]!) {
                left.removeFirst()
                took += 1
            }
            XCTAssertGreaterThan(took, 0)
            requests += 1
        }
        XCTAssertLessThanOrEqual(requests, 3)
    }

    // MARK: TimeRequest

    func testTimeAndZoneIdMatchesJava() throws {
        let cases = g.list("timeRequests")
        XCTAssertGreaterThan(cases.count, 20)
        for c in cases {
            let zone = c.str("zone")
            guard let tz = TimeZone(identifier: zone) else { XCTFail("zone \(zone) unknown"); continue }
            let now = Date(timeIntervalSince1970: Double((c["millis"] as? NSNumber)!.int64Value) / 1000)
            let label = "\(zone) @ \((c["millis"] as? NSNumber)!)"
            // The request only uses the first six bytes (time, zone hour and minute); the zone id after them is the platform's name for it
            // (Foundation calls UTC "GMT").
            let id = DeviceConfig.TimeRequest.timeAndZoneId(now: now, timeZone: tz)
            XCTAssertEqual(Array(id.prefix(6)).hexLower, String(c.str("timeAndZoneId").prefix(12)), label)
            if zone != "UTC" { XCTAssertEqual(id.hexLower, c.str("timeAndZoneId"), label) }
            let packet = DeviceConfig.TimeRequest.request(now: now, timeZone: tz)
            XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), label)
            XCTAssertTrue(packet.isEncrypted && packet.isSliced)
        }
    }

    func testTimeRequestForANegativeHalfHourZone() throws {
        // St. John's in January is UTC-3:30: Java encodes the hour as 3 + 128 and the minute as the byte -30.
        let now = Date(timeIntervalSince1970: 1_767_225_600)
        let id = DeviceConfig.TimeRequest.timeAndZoneId(now: now, timeZone: TimeZone(identifier: "America/St_Johns")!)
        XCTAssertEqual(Array(id[4...5]), [131, 0xE2])
        XCTAssertEqual(String(decoding: id[6...], as: UTF8.self), "America/St_Johns")
    }

    // MARK: responses

    private func fields(_ service: Int, _ command: Int, _ packet: HuaweiPacket, entry: [String: Any]) throws -> [String: Any] {
        switch (service, command) {
        case (1, 1):
            let r = try DeviceConfig.LinkParams.Response(packet: packet)
            return ["protocolVersion": Int(r.protocolVersion), "mtu": Int(r.mtu), "sliceSize": Int(r.sliceSize), "authVersion": Int(r.authVersion),
                    "serverNonce": r.serverNonce.hexLower, "deviceSupportType": Int(r.deviceSupportType), "authAlgo": Int(r.authAlgo),
                    "bondState": Int(r.bondState), "interval": Int(r.interval), "encryptMethod": Int(r.encryptMethod)]
        case (1, 2):
            return ["supportedServices": try DeviceConfig.SupportedServices.Response(packet: packet).supportedServices.hexLower]
        case (1, 3):
            let r = try DeviceConfig.SupportedCommands.Response(packet: packet)
            return ["commandsLists": r.commandsLists.map { ["service": $0.service, "commands": $0.commands.hexLower] as [String: Any] }]
        case (1, 5):
            return ["deviceTime": Int(try DeviceConfig.TimeRequest.Response(packet: packet).deviceTime)]
        case (1, 7):
            let r = try DeviceConfig.ProductInfo.Response(packet: packet)
            func s(_ v: String?) -> Any { v ?? NSNull() }
            return ["hardwareVersion": s(r.hardwareVersion), "softwareVersion": s(r.softwareVersion), "serialNumber": s(r.serialNumber),
                    "productModel": s(r.productModel), "packageName": s(r.packageName), "deviceName": s(r.deviceName),
                    "regionCode": Int(r.regionCode), "otaSignatureLength": Int(r.otaSignatureLength)]
        case (1, 0x0F):
            let r = try DeviceConfig.BondParams.Response(packet: packet)
            return ["status": Int(r.status), "encryptionCounter": Int(r.encryptionCounter)]
        case (1, 0x13):
            return ["challengeResponse": try DeviceConfig.Auth.Response(packet: packet).challengeResponse.hexLower]
        case (1, 0x08), (1, 0x27):
            let r = try DeviceConfig.BatteryLevel.Response(packet: packet)
            return ["level": Int(r.level), "multi_level": PacketsKit.hex(r.multiLevel), "status": PacketsKit.hex(r.status)]
        case (1, 0x16):
            return ["status": Int(try DeviceConfig.DeviceStatus.Response(packet: packet).status)]
        case (1, 0x2C):
            let params = ParamsProvider()
            params.authVersion = UInt8(entry.int("authVersion"))
            params.encryptMethod = UInt8(entry.int("encryptMethod"))
            return ["pinCode": try DeviceConfig.PinCode.Response(packet: packet, params: params).pinCode.hexLower]
        case (1, 0x31):
            let r = try DeviceConfig.SettingRelated.Response(packet: packet)
            return ["truSleepNewSync": r.truSleepNewSync, "rriNewSync": r.rriNewSync, "gpsNewSync": r.gpsNewSync]
        case (1, 0x33):
            let r = try DeviceConfig.SecurityNegotiation.Response(packet: packet)
            return ["authType": r.authType, "honorPairType": r.honorPairType, "responseNonce": PacketsKit.hex(r.responseNonce)]
        case (1, 0x37):
            return ["expandCapabilities": PacketsKit.hex(try DeviceConfig.ExpandCapability.Response(packet: packet).expandCapabilities)]
        case (1, 0x3D):
            _ = try DeviceConfig.WearStatus.Response(packet: packet)
            return [:]
        case (1, 0x3F):
            _ = try DeviceConfig.ReverseCapabilities.Response(packet: packet)
            return [:]
        case (1, 0x28):
            let r = try DeviceConfig.HiChain.Response(packet: packet)
            var out: [String: Any] = ["type": Int(r.type), "step": Int(r.step), "errorCode": r.errorCode]
            if let d = r.step1Data {
                out["step1Data"] = ["isoSalt": d.isoSalt.hexLower, "peerAuthId": d.peerAuthId.hexLower, "peerUserType": d.peerUserType, "token": d.token.hexLower] as [String: Any]
            }
            if let d = r.step2Data { out["step2Data"] = ["returnCodeMac": d.returnCodeMac.hexLower] }
            if let d = r.step3Data { out["step3Data"] = ["nonce": d.nonce.hexLower, "encAuthToken": d.encAuthToken.hexLower] }
            if let d = r.step4Data { out["step4Data"] = ["data": d.data.map { $0 as Any } ?? NSNull()] }
            return out
        default:
            throw XCTSkip("no mapping for \(service)/\(command)")
        }
    }

    func testResponsesMatchJava() throws {
        let responses = g.list("responses")
        XCTAssertGreaterThan(responses.count, 200)
        var failuresSeen = 0
        for c in responses {
            let name = c.str("name")
            let packet = try PacketsKit.tlvPacket(c.int("service"), c.int("command"), c.str("tlv"))
            do {
                let actual = try fields(c.int("service"), c.int("command"), packet, entry: c)
                guard c.bool("ok") else {
                    XCTFail("\(name): Java failed with \(c.str("exception")) but Swift parsed \(actual)")
                    continue
                }
                let expected = (c["fields"] as? [String: Any]) ?? [:]
                XCTAssertEqual(PacketsKit.canonical(actual), PacketsKit.canonical(expected), name)
            } catch let skip as XCTSkip {
                throw skip
            } catch {
                guard !c.bool("ok") else {
                    XCTFail("\(name): Java parsed but Swift failed with \(error)")
                    continue
                }
                failuresSeen += 1
                let (swiftName, swiftParse) = PacketsKit.exceptionClass(error)
                XCTAssertEqual(swiftParse, c.bool("parseException"), "\(name): Java \(c.str("exception")), Swift \(swiftName)")
                if c.bool("parseException") {
                    XCTAssertEqual(swiftName, c.str("exception"), name)
                }
            }
        }
        XCTAssertGreaterThan(failuresSeen, 30)
    }

    // MARK: HiChain requests

    func testHiChainRequestsMatchJavaSemantically() throws {
        let cases = g.list("hiChainRequests")
        XCTAssertEqual(cases.count, 8)
        for c in cases {
            let name = c.str("name")
            let request = DeviceConfig.HiChain.Request(
                operationCode: c.int("operationCode"), requestId: Int64(truncating: (c["requestId"] as? NSNumber)!),
                selfAuthId: c.bytes("selfAuthId"), groupId: c.str("groupId")
            )
            let messageId = c.int("messageId")
            let packet: HuaweiPacket
            switch c.str("step") {
            case "StepOne": packet = request.stepOne(messageId: messageId, isoSalt: c.bytes("isoSalt"), seed: c.bytes("seed"))
            case "StepTwo": packet = request.stepTwo(messageId: messageId, token: c.bytes("token"))
            case "StepThree": packet = request.stepThree(messageId: messageId, nonce: c.bytes("nonce"), encData: c.bytes("enc"))
            default: packet = request.stepFour(messageId: messageId, nonce: c.bytes("nonce"), encResult: c.bytes("enc"))
            }
            XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name)
            XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name)
            XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name)
            XCTAssertEqual(packet.isSliced, c.bool("sliced"), name)

            let swiftEntries = packet.tlv!.entries
            let javaEntries = c.list("entries")
            XCTAssertEqual(swiftEntries.map { Int($0.tag) }, javaEntries.map { $0.int("tag") }, "\(name): tags")
            for (s, j) in zip(swiftEntries, javaEntries) where s.tag != 0x01 {
                XCTAssertEqual(s.value.hexLower, j.str("value"), "\(name): tag \(s.tag)")
            }
            let swiftJSON = try JSONSerialization.jsonObject(with: Data(try packet.tlv!.string(0x01).utf8))
            let javaJSON = try JSONSerialization.jsonObject(with: Data(c.str("json").utf8))
            XCTAssertEqual(PacketsKit.canonical(swiftJSON), PacketsKit.canonical(javaJSON), "\(name): json")
        }
    }

    /// The text of tag 0x01 is pinned byte for byte: Android's org.json keeps insertion order. The shape (key order, compact, message 0x10|n
    /// on operationCode 2, trailing isDeviceLevel) is what a real op2 exchange with the Fit 4 Pro showed on the wire (PairingProbe, 2026-10-16).
    func testHiChainJsonTextKeepsInsertionOrder() throws {
        let authId = Array("ABCDEF0123456789ABCDEF0123456789".utf8) // 32 ASCII chars: the android id
        let authIdHex = authId.hexUpper
        let group = "7B0BC0CBCE474F6C238D9661C63400B797B166EA7849B3A370FC73A9A236E989"
        let salt = Bytes(0..<16)
        let seed = Bytes(16..<48)
        let token = Bytes(repeating: 0xAB, count: 32)
        let nonce = Bytes(repeating: 0x01, count: 12)
        let enc = Bytes(repeating: 0xCD, count: 20)
        let version = #"{"minVersion":"1.0.0","currentVersion":"2.0.16"}"#
        func text(_ p: HuaweiPacket) throws -> String { try p.tlv!.string(0x01) }

        let op2 = DeviceConfig.HiChain.Request(operationCode: 2, requestId: 1_700_000_000_123, selfAuthId: authId, groupId: group)
        XCTAssertEqual(
            try text(op2.stepOne(messageId: 1, isoSalt: salt, seed: seed)),
            #"{"authForm":0,"payload":{"version":\#(version),"isoSalt":"\#(salt.hexUpper)","peerAuthId":"\#(authIdHex)","operationCode":2,"seed":"\#(seed.hexUpper)","peerUserType":0,"pkgName":"com.huawei.devicegroupmanage","serviceType":"\#(group)","keyLength":32},"groupAndModuleVersion":"2.0.1","message":17,"isDeviceLevel":false}"#
        )
        XCTAssertEqual(
            try text(op2.stepTwo(messageId: 2, token: token)),
            #"{"authForm":0,"payload":{"version":\#(version),"peerAuthId":"\#(authIdHex)","token":"\#(token.hexUpper)"},"groupAndModuleVersion":"2.0.1","message":18,"isDeviceLevel":false}"#
        )
        XCTAssertEqual(
            try text(op2.stepFour(messageId: 3, nonce: nonce, encResult: enc)),
            #"{"authForm":0,"payload":{"version":\#(version),"nonce":"\#(nonce.hexUpper)","encResult":"\#(enc.hexUpper)","operationCode":2},"groupAndModuleVersion":"2.0.1","message":19}"#
        )

        let op1 = DeviceConfig.HiChain.Request(operationCode: 1, requestId: 1_700_000_000_123, selfAuthId: authId, groupId: group)
        let op1Tail = #","requestId":"1700000000123","groupId":"\#(group)","groupName":"health_group_name","groupOp":2,"groupType":256,"peerDeviceId":"ABCDEF0123456789ABCDEF0123456789","connDeviceId":"ABCDEF0123456789ABCDEF0123456789","appId":"com.huawei.health","ownerName":""}"#
        XCTAssertEqual(
            try text(op1.stepOne(messageId: 1, isoSalt: salt, seed: seed)),
            #"{"authForm":0,"payload":{"version":\#(version),"isoSalt":"\#(salt.hexUpper)","peerAuthId":"\#(authIdHex)","operationCode":1,"seed":"\#(seed.hexUpper)","peerUserType":0},"groupAndModuleVersion":"2.0.1","message":1"# + op1Tail
        )
        XCTAssertEqual(
            try text(op1.stepThree(messageId: 3, nonce: nonce, encData: enc)),
            #"{"authForm":0,"payload":{"version":\#(version),"nonce":"\#(nonce.hexUpper)","encData":"\#(enc.hexUpper)"},"groupAndModuleVersion":"2.0.1","message":3"# + op1Tail
        )
        XCTAssertEqual(try op2.stepOne(messageId: 1, isoSalt: salt, seed: seed).tlv!.bytes(0x03), [0, 0, 1, 0x8B, 0xCF, 0xE5, 0x68, 0x7B])
        XCTAssertEqual(try op2.stepOne(messageId: 1, isoSalt: salt, seed: seed).tlv!.bytes(0x02), [2])
    }

    func testJsonQuotingMatchesAndroid() {
        XCTAssertEqual(HiChainJSON.quote("a/b\"c\\d\n\t\u{1}"), #""a\/b\"c\\d\n\t\u0001""#)
        var o = HiChainJSON()
        o.put("a", .int(1))
        o.put("b", .string("x"))
        o.put("a", .bool(true)) // keeps its first position
        XCTAssertEqual(o.render(), #"{"a":true,"b":"x"}"#)
    }

    func testHiChainResponseIgnoresTheWatchsTrailingNul() throws {
        // The watch ends its JSON with a NUL byte (real wire): org.json ignores it, Foundation would not.
        let json = #"{"authForm":0,"payload":{"isoSalt":"0011","token":"AABB","peerAuthId":"4142","peerUserType":0},"groupAndModuleVersion":"2.0.1","isDeviceLevel":false}"# + "\u{0}"
        var tlv = HuaweiTLV()
        tlv.put(0x01, string: json)
        tlv.put(0x02, byte: 2)
        tlv.put(0x03, bytes: Bytes(repeating: 0, count: 8))
        tlv.put(0x04, byte: 0)
        tlv.put(0x05, byte: 0)
        let r = try DeviceConfig.HiChain.Response(packet: HuaweiPacket(serviceId: 1, commandId: 0x28, tlv: tlv, isEncrypted: false))
        XCTAssertEqual(r.step, 1)
        XCTAssertEqual(r.step1Data?.isoSalt, [0x00, 0x11])
        XCTAssertEqual(r.step1Data?.peerAuthId, [0x41, 0x42])
        XCTAssertEqual(r.step1Data?.token, [0xAA, 0xBB])
        XCTAssertEqual(r.errorCode, 0)
    }

    func testHiChainFinalMessageOfARealOp2Exchange() throws {
        // Real RX of op2 (Fit 4 Pro over BLE): 01="com.huawei.health" 02=02 03=00*8 04=02 05=00 -> the tag-0x04 branch, Step4Data.
        var tlv = HuaweiTLV()
        tlv.put(0x01, string: "com.huawei.health")
        tlv.put(0x02, byte: 2)
        tlv.put(0x03, bytes: Bytes(repeating: 0, count: 8))
        tlv.put(0x04, byte: 2)
        tlv.put(0x05, byte: 0)
        let r = try DeviceConfig.HiChain.Response(packet: HuaweiPacket(serviceId: 1, commandId: 0x28, tlv: tlv, isEncrypted: false))
        XCTAssertEqual(r.type, 2)
        XCTAssertEqual(r.step, 4)
        XCTAssertEqual(r.step4Data?.data, "com.huawei.health")
        XCTAssertEqual(r.errorCode, 0)
    }

    func testHiChainHonorFramingIsRejected() throws {
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: 0x02)
        tlv.put(0x02, string: "{}")
        XCTAssertThrowsError(try DeviceConfig.HiChain.Response(packet: HuaweiPacket(serviceId: 1, commandId: 0x28, tlv: tlv, isEncrypted: false))) { e in
            XCTAssertEqual(e as? PacketError, .json("unsupported Honor PAKE framing"))
        }
    }

    func testFirstObjectTextStopsAtTheClosingBrace() {
        XCTAssertEqual(HiChainJSON.firstObjectText(#"  {"a":"}\"{","b":{"c":1}}tail"#), #"{"a":"}\"{","b":{"c":1}}"#)
        XCTAssertEqual(HiChainJSON.firstObjectText("not json"), "not json")
        XCTAssertEqual(HiChainJSON.firstObjectText(#"{"a":1"#), #"{"a":1"#)
    }
}

import XCTest
@testable import HuaweiProtocol

final class PacketsFitnessTests: XCTestCase {
    let g = try! Golden.load("packetsFitness")

    private func assertRequest(_ name: String, _ packet: HuaweiPacket, _ c: [String: Any], file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name, file: file, line: line)
        XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name, file: file, line: line)
        XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), "\(name): isEncrypted", file: file, line: line)
        XCTAssertEqual(packet.isSliced, c.bool("sliced"), "\(name): isSliced", file: file, line: line)
        XCTAssertEqual((packet.tlv ?? HuaweiTLV()).serialize().hexLower, c.str("tlv"), "\(name): tlv", file: file, line: line)
        XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], "\(name): frames", file: file, line: line)
    }

    // MARK: requests

    func testSimpleRequestsMatchJava() throws {
        let requests = g.list("requests")
        XCTAssertGreaterThan(requests.count, 15)
        for c in requests {
            let name = c.str("name")
            let tlv = try HuaweiTLV(parsing: c.bytes("tlv"))
            let packet: HuaweiPacket
            if name == "FitnessTotals" {
                packet = FitnessData.FitnessTotals.request()
            } else if name.hasPrefix("MessageCount") {
                packet = FitnessData.MessageCount.request(commandId: UInt8(c.int("command")), start: try tlv.int(0x03), end: try tlv.int(0x04))
            } else if name.hasPrefix("MessageData") {
                packet = FitnessData.MessageData.request(commandId: UInt8(c.int("command")), count: try tlv.object(0x81).short(0x02))
            } else {
                XCTFail("unknown request \(name)")
                continue
            }
            try assertRequest(name, packet, c)
        }
    }

    func testMotionGoalMatchesJava() throws {
        let goals = g.list("motionGoals")
        XCTAssertGreaterThan(goals.count, 10)
        for c in goals {
            let packet = FitnessData.MotionGoal.request(
                goalType: UInt8(truncatingIfNeeded: c.int("goalType")), frameType: UInt8(truncatingIfNeeded: c.int("frameType")),
                stepGoal: Int32(truncatingIfNeeded: c.int("stepGoal")), calorieGoal: Int32(truncatingIfNeeded: c.int("calorieGoal")),
                durationGoal: Int16(truncatingIfNeeded: c.int("durationGoal"))
            )
            try assertRequest(c.str("name"), packet, c)
        }
    }

    func testProfileMotionGoalIsTheStepGoalOnly() throws {
        // What ProfileSender sends: goalType 1, frameType 0, step goal, no calorie or duration goal.
        let packet = FitnessData.MotionGoal.request(goalType: 1, frameType: 0, stepGoal: 10000, calorieGoal: 0, durationGoal: 0)
        let sub = try packet.tlv!.object(0x81).object(0x82)
        XCTAssertEqual(sub.entries.map { Int($0.tag) }, [3, 4, 5])
        XCTAssertEqual(try sub.int(0x05), 10000)
    }

    func testUserInfoMatchesJava() throws {
        let infos = g.list("userInfos")
        XCTAssertGreaterThan(infos.count, 140)
        for c in infos {
            let data = FitnessData.UserInfo.UserInfoData(
                height: Int32(truncatingIfNeeded: c.int("height")), weight: Float(bitPattern: UInt32(bitPattern: Int32(truncatingIfNeeded: c.int("weightBits")))),
                age: Int32(truncatingIfNeeded: c.int("age")), birthday: Int32(truncatingIfNeeded: c.int("birthday")), gender: UInt8(truncatingIfNeeded: c.int("gender")),
                unknownGenderSupported: c.bool("unknownGender"), vo2Supported: c.bool("vo2"), vo2Max: Int32(truncatingIfNeeded: c.int("vo2Max")),
                vo2Time: Int32(truncatingIfNeeded: c.int("vo2Time")), precisionWeightSupported: c.bool("precision")
            )
            try assertRequest(c.str("name"), FitnessData.UserInfo.request(info: data), c)
        }
    }

    // MARK: responses

    private func tv(_ t: FitnessData.MessageData.StepResponse.SubContainer.TV) -> [String: Any] {
        ["bitmap": Int(t.bitmap), "tag": Int(t.tag), "value": Int(t.value)]
    }

    private func stepFields(_ r: FitnessData.MessageData.StepResponse) -> [String: Any] {
        var containers = [[String: Any]]()
        for c in r.containers {
            containers.append([
                "timestampOffset": Int(c.timestampOffset), "data": c.data.hexLower, "timestamp": Int(c.timestamp), "parsed": c.parsedData != nil,
                "error": c.parsedDataError, "tvs": (c.parsedData ?? []).map(tv), "steps": Int(c.steps), "calories": Int(c.calories),
                "distance": Int(c.distance), "heartrate": Int(c.heartrate), "spo": Int(c.spo), "restingHeartRate": Int(c.restingHeartRate),
                "unknownTVs": c.unknownTVs.map { $0.map(tv) as Any } ?? NSNull(),
            ])
        }
        return ["number": Int(r.number), "timestamp": Int(r.timestamp), "containers": containers]
    }

    private func fields(_ c: [String: Any]) throws -> [String: Any] {
        let packet = try PacketsKit.tlvPacket(c.int("service"), c.int("command"), c.str("tlv"))
        switch c.int("command") {
        case 0x0A, 0x0C:
            return ["count": Int(try FitnessData.MessageCount.Response(packet: packet).count)]
        case 0x0D:
            let r = try FitnessData.MessageData.SleepResponse(packet: packet)
            return ["number": Int(r.number), "containers": r.containers.map { ["type": Int($0.type), "timestamp": $0.timestamp.hexLower] as [String: Any] }]
        case 0x0B:
            return stepFields(try FitnessData.MessageData.StepResponse(packet: packet))
        case 0x03:
            let r = try FitnessData.FitnessTotals.Response(packet: packet)
            return ["totalSteps": Int(r.totalSteps), "totalCalories": Int(r.totalCalories), "totalDistance": Int(r.totalDistance)]
        default:
            throw XCTSkip("no mapping for command \(c.int("command"))")
        }
    }

    private func compare(_ c: [String: Any]) throws -> Bool {
        let name = c.str("name")
        do {
            let actual = try fields(c)
            guard c.bool("ok") else {
                XCTFail("\(name): Java failed with \(c.str("exception")) but Swift parsed")
                return false
            }
            XCTAssertEqual(PacketsKit.canonical(actual), PacketsKit.canonical((c["fields"] as? [String: Any]) ?? [:]), name)
            return true
        } catch let skip as XCTSkip {
            throw skip
        } catch {
            guard !c.bool("ok") else {
                XCTFail("\(name): Java parsed but Swift failed with \(error)")
                return false
            }
            let (swiftName, swiftParse) = PacketsKit.exceptionClass(error)
            XCTAssertEqual(swiftParse, c.bool("parseException"), "\(name): Java \(c.str("exception")), Swift \(swiftName)")
            if c.bool("parseException") { XCTAssertEqual(swiftName, c.str("exception"), name) }
            return false
        }
    }

    func testResponsesMatchJava() throws {
        let responses = g.list("responses")
        XCTAssertGreaterThan(responses.count, 60)
        var parsed = 0, failed = 0
        for c in responses { if try compare(c) { parsed += 1 } else { failed += 1 } }
        XCTAssertGreaterThan(parsed, 30)
        XCTAssertGreaterThan(failed, 15)
    }

    func testStepDataBitmapWalkMatchesJavaOnRandomisedFrames() throws {
        let fuzz = g.list("stepFuzz")
        XCTAssertEqual(fuzz.count, 600)
        var withTVs = 0, withErrors = 0
        for c in fuzz {
            _ = try compare(c)
            if let containers = (c["fields"] as? [String: Any])?["containers"] as? [[String: Any]], let first = containers.first {
                if (first["parsed"] as? Bool) == true, !((first["tvs"] as? [Any]) ?? []).isEmpty { withTVs += 1 }
                if (first["parsed"] as? Bool) == false { withErrors += 1 }
            }
        }
        // The random frames reach both the success and the error branches.
        XCTAssertGreaterThan(withTVs, 100)
        XCTAssertGreaterThan(withErrors, 100)
    }

    func testStepFrameDecodingByHand() throws {
        // Subcontainer data 4E: bits 02 (steps), 04 (calories), 08 (distance), 40 (single signed byte heart rate).
        var container = HuaweiTLV()
        container.put(0x02, short: 4)
        container.put(0x03, int: 1_792_000_000)
        var sub = HuaweiTLV()
        sub.put(0x05, byte: 0xFF) // offset -1 minute
        sub.put(0x06, bytes: [0x4E, 0x01, 0x00, 0x00, 0x2A, 0x00, 0x64, 0xB4])
        container.put(0x84, tlv: sub)
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: container)
        let r = try FitnessData.MessageData.StepResponse(packet: HuaweiPacket(serviceId: 7, commandId: 0x0B, tlv: tlv))
        XCTAssertEqual(r.number, 4)
        let c = try XCTUnwrap(r.containers.first)
        XCTAssertEqual(c.timestamp, 1_792_000_000 - 60)
        XCTAssertEqual(c.steps, 256)
        XCTAssertEqual(c.calories, 42)
        XCTAssertEqual(c.distance, 100)
        XCTAssertEqual(c.heartrate, -76) // 0xB4 as a signed byte: the Kotlin layer maps it with `& 0xFF`
        XCTAssertEqual(c.spo, -1)
        XCTAssertNotNil(c.parsedData)
    }

    func testNegativeShortStepValueIsKeptSigned() throws {
        var result = FitnessData.MessageData.StepResponse.SubContainer()
        FitnessData.MessageData.StepResponse.parseData(&result, [0x02, 0xFF, 0xFF])
        XCTAssertEqual(result.steps, -1) // the Kotlin layer maps -1 (field absent / 0xFFFF) to 0
        XCTAssertEqual(result.parsedData?.count, 1)
    }
}

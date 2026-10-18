import XCTest
@testable import HuaweiProtocol

/// Workout (service 0x17) packets and the GPS file parser against fixtures the real Java produced (GoldenGen/src/GoldenWorkout.java).
final class WorkoutPacketsTests: XCTestCase {
    let g = try! Golden.load("workout")

    private func i32(_ f: [String: Any], _ key: String) -> Int32 { Int32(truncatingIfNeeded: f.int(key)) }
    private func i16(_ f: [String: Any], _ key: String) -> Int16 { Int16(truncatingIfNeeded: f.int(key)) }
    private func i8(_ f: [String: Any], _ key: String) -> Int8 { Int8(truncatingIfNeeded: f.int(key)) }
    private func optInt32(_ f: [String: Any], _ key: String) -> Int32? { (f[key] as? NSNumber).map { Int32(truncatingIfNeeded: $0.intValue) } }

    // MARK: requests

    func testRequestsMatchJava() throws {
        let requests = g.list("requests")
        XCTAssertGreaterThanOrEqual(requests.count, 40)
        for c in requests {
            let name = c.str("name")
            let a = c.int("a"), b = c.int("b")
            let packet: HuaweiPacket
            switch c.str("kind") {
            case "count": packet = Workout.WorkoutCount.request(start: Int32(truncatingIfNeeded: a), end: Int32(truncatingIfNeeded: b))
            case "totals": packet = Workout.WorkoutTotals.request(number: Int16(truncatingIfNeeded: a))
            case "data": packet = Workout.WorkoutData.request(workoutNumber: Int16(truncatingIfNeeded: a), dataNumber: Int16(truncatingIfNeeded: b), newSteps: c.bool("newSteps"))
            case "pace": packet = Workout.WorkoutPace.request(workoutNumber: Int16(truncatingIfNeeded: a), paceNumber: Int16(truncatingIfNeeded: b))
            case "swim": packet = Workout.WorkoutSwimSegments.request(workoutNumber: Int16(truncatingIfNeeded: a), segmentNumber: Int16(truncatingIfNeeded: b))
            case "spo2": packet = Workout.WorkoutSpO2.request(workoutNumber: Int16(truncatingIfNeeded: a), spO2Number: Int16(truncatingIfNeeded: b))
            case "sections": packet = Workout.WorkoutSections.request(workoutNumber: Int16(truncatingIfNeeded: a), additionalDataNumber: Int16(truncatingIfNeeded: b))
            case "capability": packet = Workout.WorkoutCapability.request()
            default: XCTFail("\(name): unknown kind"); continue
            }
            XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name)
            XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name)
            XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name)
            XCTAssertEqual(packet.isSliced, c.bool("sliced"), name)
            XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), name)
            XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], name)
        }
    }

    // MARK: responses

    /// Runs every case of one group: Swift parses what Java parsed with the same fields, and fails where Java failed, with the same class of failure.
    private func check<R>(
        _ group: String, minFailures: Int, parse: (HuaweiPacket, Bool) throws -> R, compare: (R, [String: Any], String) -> Void
    ) throws {
        let cases = g.list(group)
        XCTAssertGreaterThanOrEqual(cases.count, 4, group)
        var failures = 0
        for c in cases {
            let name = "\(group): \(c.str("name"))"
            let packet = try PacketsKit.tlvPacket(c.int("service"), c.int("command"), c.str("tlv"))
            do {
                let r = try parse(packet, c.bool("aw"))
                guard c.bool("ok") else {
                    XCTFail("\(name): Java failed with \(c.str("exception")) but Swift parsed")
                    continue
                }
                compare(r, (c["fields"] as? [String: Any]) ?? [:], name)
            } catch {
                guard !c.bool("ok") else {
                    XCTFail("\(name): Java parsed but Swift failed with \(error)")
                    continue
                }
                failures += 1
                let (swiftName, swiftParse) = exceptionClass(error)
                XCTAssertEqual(swiftParse, c.bool("parseException"), "\(name): Java \(c.str("exception")), Swift \(swiftName)")
                if c.bool("parseException") { XCTAssertEqual(swiftName, c.str("exception"), name) }
            }
        }
        XCTAssertGreaterThanOrEqual(failures, minFailures, group)
    }

    private func exceptionClass(_ error: Error) -> (String, Bool) {
        if let e = error as? PacketError, case .lengthMismatch = e { return ("LengthMismatchException", true) }
        return PacketsKit.exceptionClass(error)
    }

    func testCountMatchesJava() throws {
        try check("count", minFailures: 4, parse: { p, _ in try Workout.WorkoutCount.Response(packet: p) }) { r, f, name in
            XCTAssertEqual(r.count, i16(f, "count"), name)
            XCTAssertEqual(r.error, optInt32(f, "error"), name)
            if f["workoutNumbers"] is NSNull {
                XCTAssertNil(r.workoutNumbers, name)
            } else {
                let expected = f.list("workoutNumbers")
                XCTAssertEqual(r.workoutNumbers?.count, expected.count, name)
                for (n, e) in zip(r.workoutNumbers ?? [], expected) {
                    XCTAssertEqual(n.rawData.hexLower, e.str("rawData"), name)
                    XCTAssertEqual(n.workoutNumber, i16(e, "workoutNumber"), name)
                    XCTAssertEqual(n.dataCount, i16(e, "dataCount"), name)
                    XCTAssertEqual(n.paceCount, i16(e, "paceCount"), name)
                    XCTAssertEqual(n.segmentsCount, i16(e, "segmentsCount"), name)
                    XCTAssertEqual(n.spO2Count, i16(e, "spO2Count"), name)
                    XCTAssertEqual(n.sectionsCount, i16(e, "sectionsCount"), name)
                    XCTAssertEqual(n.trajectoriesData, i8(e, "trajectoriesData"), name)
                    XCTAssertEqual(n.divingData, i8(e, "divingData"), name)
                }
            }
        }
    }

    func testTotalsMatchJava() throws {
        try check("totals", minFailures: 6, parse: { p, _ in try Workout.WorkoutTotals.Response(packet: p) }) { r, f, name in
            XCTAssertEqual(r.rawData?.hexLower, f.opt("rawData"), name)
            XCTAssertEqual(r.error, optInt32(f, "error"), name)
            XCTAssertEqual(r.number, i16(f, "number"), name)
            XCTAssertEqual(r.status, i8(f, "status"), name)
            XCTAssertEqual(r.startTime, i32(f, "startTime"), name)
            XCTAssertEqual(r.endTime, i32(f, "endTime"), name)
            XCTAssertEqual(r.calories, i32(f, "calories"), name)
            XCTAssertEqual(r.distance, i32(f, "distance"), name)
            XCTAssertEqual(r.stepCount, i32(f, "stepCount"), name)
            XCTAssertEqual(r.totalTime, i32(f, "totalTime"), name)
            XCTAssertEqual(r.duration, i32(f, "duration"), name)
            XCTAssertEqual(r.type, i8(f, "type"), name)
            XCTAssertEqual(r.strokes, i16(f, "strokes"), name)
            XCTAssertEqual(r.avgStrokeRate, i16(f, "avgStrokeRate"), name)
            XCTAssertEqual(r.poolLength, i16(f, "poolLength"), name)
            XCTAssertEqual(r.laps, i16(f, "laps"), name)
            XCTAssertEqual(r.avgSwolf, i16(f, "avgSwolf"), name)
            XCTAssertEqual(r.maxAltitude, optInt32(f, "maxAltitude"), name)
            XCTAssertEqual(r.minAltitude, optInt32(f, "minAltitude"), name)
            XCTAssertEqual(r.elevationGain, optInt32(f, "elevationGain"), name)
            XCTAssertEqual(r.elevationLoss, optInt32(f, "elevationLoss"), name)
            XCTAssertEqual(r.workoutLoad, i32(f, "workoutLoad"), name)
            XCTAssertEqual(r.workoutAerobicEffect, i32(f, "workoutAerobicEffect"), name)
            XCTAssertEqual(r.workoutAnaerobicEffect, i8(f, "workoutAnaerobicEffect"), name)
            XCTAssertEqual(r.recoveryTime, i16(f, "recoveryTime"), name)
            XCTAssertEqual(r.minHeartRatePeak, i8(f, "minHeartRatePeak"), name)
            XCTAssertEqual(r.maxHeartRatePeak, i8(f, "maxHeartRatePeak"), name)
            XCTAssertEqual(r.recoveryHeartRates?.hexLower, f.opt("recoveryHeartRates"), name)
            XCTAssertEqual(r.swimType, i8(f, "swimType"), name)
            XCTAssertEqual(r.maxMET, i32(f, "maxMET"), name)
            XCTAssertEqual(r.hrZoneType, i8(f, "hrZoneType"), name)
            XCTAssertEqual([r.runPaceZone1Min, r.runPaceZone2Min, r.runPaceZone3Min, r.runPaceZone4Min, r.runPaceZone5Min, r.runPaceZone5Max],
                           ["runPaceZone1Min", "runPaceZone2Min", "runPaceZone3Min", "runPaceZone4Min", "runPaceZone5Min", "runPaceZone5Max"].map { i16(f, $0) }, name)
            XCTAssertEqual([r.runPaceZone1Time, r.runPaceZone2Time, r.runPaceZone3Time, r.runPaceZone4Time, r.runPaceZone5Time],
                           ["runPaceZone1Time", "runPaceZone2Time", "runPaceZone3Time", "runPaceZone4Time", "runPaceZone5Time"].map { i16(f, $0) }, name)
            XCTAssertEqual(r.algType, i8(f, "algType"), name)
            XCTAssertEqual(r.trainingPoints, i32(f, "trainingPoints"), name)
            XCTAssertEqual(r.longestStreak, i32(f, "longestStreak"), name)
            XCTAssertEqual(r.tripped, i32(f, "tripped"), name)
            XCTAssertEqual(PacketsKit.canonical(r.additionalValues), PacketsKit.canonical(f["additionalValues"] ?? [:]), name)
        }
    }

    func testDataMatchesJava() throws {
        try check("data", minFailures: 6, parse: { p, aw in try Workout.WorkoutData.Response(packet: p, isAW: aw) }) { r, f, name in
            XCTAssertEqual(r.error, optInt32(f, "error"), name)
            XCTAssertEqual(r.workoutNumber, i16(f, "workoutNumber"), name)
            XCTAssertEqual(r.dataNumber, i16(f, "dataNumber"), name)
            XCTAssertEqual(r.rawHeader.hexLower, f.str("rawHeader"), name)
            XCTAssertEqual(r.rawData.hexLower, f.str("rawData"), name)
            XCTAssertEqual(r.innerBitmap, i32(f, "innerBitmap"), name)
            XCTAssertEqual(r.innerDataLength, i32(f, "innerDataLength"), name)
            if let h = f["header"] as? [String: Any] {
                XCTAssertEqual(r.header?.workoutNumber, i16(h, "workoutNumber"), name)
                XCTAssertEqual(r.header?.dataNumber, i16(h, "dataNumber"), name)
                XCTAssertEqual(r.header?.timestamp, i32(h, "timestamp"), name)
                XCTAssertEqual(r.header?.interval, i8(h, "interval"), name)
                XCTAssertEqual(r.header?.dataCount, i16(h, "dataCount"), name)
                XCTAssertEqual(r.header?.dataLength, i8(h, "dataLength"), name)
                XCTAssertEqual(r.header?.bitmap, i16(h, "bitmap"), name)
            } else {
                XCTAssertNil(r.header, name)
            }
            let expected = f.list("dataList")
            XCTAssertEqual(r.dataList.count, expected.count, name)
            for (d, e) in zip(r.dataList, expected) {
                XCTAssertEqual(d.unknownData?.hexLower, e.opt("unknownData"), name)
                XCTAssertEqual(d.heartRate, i8(e, "heartRate"), name)
                XCTAssertEqual(d.speed, i16(e, "speed"), name)
                XCTAssertEqual(d.stepRate, i8(e, "stepRate"), name)
                XCTAssertEqual(d.cadence, i16(e, "cadence"), name)
                XCTAssertEqual(d.stepLength, i16(e, "stepLength"), name)
                XCTAssertEqual(d.groundContactTime, i16(e, "groundContactTime"), name)
                XCTAssertEqual(d.impact, i8(e, "impact"), name)
                XCTAssertEqual(d.swingAngle, i16(e, "swingAngle"), name)
                XCTAssertEqual(d.foreFootLanding, i8(e, "foreFootLanding"), name)
                XCTAssertEqual(d.midFootLanding, i8(e, "midFootLanding"), name)
                XCTAssertEqual(d.backFootLanding, i8(e, "backFootLanding"), name)
                XCTAssertEqual(d.eversionAngle, i8(e, "eversionAngle"), name)
                XCTAssertEqual(d.hangTime, i16(e, "hangTime"), name)
                XCTAssertEqual(d.impactHangRate, i16(e, "impactHangRate"), name)
                XCTAssertEqual(d.rideCadence, i8(e, "rideCadence"), name)
                XCTAssertEqual(d.ap.bitPattern, UInt32(bitPattern: i32(e, "apBits")), name)
                XCTAssertEqual(d.vo.bitPattern, UInt32(bitPattern: i32(e, "voBits")), name)
                XCTAssertEqual(d.gtb.bitPattern, UInt32(bitPattern: i32(e, "gtbBits")), name)
                XCTAssertEqual(d.vr.bitPattern, UInt32(bitPattern: i32(e, "vrBits")), name)
                XCTAssertEqual(d.ceiling, i8(e, "ceiling"), name)
                XCTAssertEqual(d.temp, i8(e, "temp"), name)
                XCTAssertEqual(d.spo2, i8(e, "spo2"), name)
                XCTAssertEqual(d.cns, i16(e, "cns"), name)
                XCTAssertEqual(d.swolf, i16(e, "swolf"), name)
                XCTAssertEqual(d.strokeRate, i16(e, "strokeRate"), name)
                XCTAssertEqual(d.calories, i16(e, "calories"), name)
                XCTAssertEqual(d.cyclingPower, i16(e, "cyclingPower"), name)
                XCTAssertEqual(d.frequency, i16(e, "frequency"), name)
                XCTAssertEqual(d.altitude, optInt32(e, "altitude"), name)
                XCTAssertEqual(d.timestamp, i32(e, "timestamp"), name)
            }
        }
    }

    func testPaceMatchesJava() throws {
        try check("pace", minFailures: 2, parse: { p, _ in try Workout.WorkoutPace.Response(packet: p) }) { r, f, name in
            XCTAssertEqual(r.error, optInt32(f, "error"), name)
            XCTAssertEqual(r.workoutNumber, i16(f, "workoutNumber"), name)
            XCTAssertEqual(r.paceNumber, i16(f, "paceNumber"), name)
            let expected = f.list("blocks")
            XCTAssertEqual(r.blocks.count, expected.count, name)
            for (b, e) in zip(r.blocks, expected) {
                XCTAssertEqual(b.distance, i16(e, "distance"), name)
                XCTAssertEqual(b.type, i8(e, "type"), name)
                XCTAssertEqual(b.pace, i32(e, "pace"), name)
                XCTAssertEqual(b.pointIndex, i16(e, "pointIndex"), name)
                XCTAssertEqual(b.correction, i16(e, "correction"), name)
                XCTAssertEqual(b.hasCorrection, e.bool("hasCorrection"), name)
            }
        }
    }

    func testSwimMatchesJava() throws {
        try check("swim", minFailures: 1, parse: { p, _ in try Workout.WorkoutSwimSegments.Response(packet: p) }) { r, f, name in
            XCTAssertEqual(r.error, optInt32(f, "error"), name)
            XCTAssertEqual(r.workoutNumber, i16(f, "workoutNumber"), name)
            XCTAssertEqual(r.segmentNumber, i16(f, "segmentNumber"), name)
            let expected = f.list("blocks")
            XCTAssertEqual(r.blocks.count, expected.count, name)
            for (b, e) in zip(r.blocks, expected) {
                XCTAssertEqual(b.distance, i16(e, "distance"), name)
                XCTAssertEqual(b.type, i8(e, "type"), name)
                XCTAssertEqual(b.pace, i32(e, "pace"), name)
                XCTAssertEqual(b.pointIndex, i16(e, "pointIndex"), name)
                XCTAssertEqual(b.segment, i16(e, "segment"), name)
                XCTAssertEqual(b.swimType, i8(e, "swimType"), name)
                XCTAssertEqual(b.strokes, i16(e, "strokes"), name)
                XCTAssertEqual(b.avgSwolf, i16(e, "avgSwolf"), name)
                XCTAssertEqual(b.time, i32(e, "time"), name)
            }
        }
    }

    func testSpO2MatchesJava() throws {
        try check("spo2", minFailures: 2, parse: { p, _ in try Workout.WorkoutSpO2.Response(packet: p) }) { r, f, name in
            XCTAssertEqual(r.error, optInt32(f, "error"), name)
            XCTAssertEqual(r.spO2Number1, i16(f, "spO2Number1"), name)
            XCTAssertEqual(r.spO2Number2, i16(f, "spO2Number2"), name)
            let expected = f.list("blocks")
            XCTAssertEqual(r.blocks.count, expected.count, name)
            for (b, e) in zip(r.blocks, expected) {
                XCTAssertEqual(b.interval, i32(e, "interval"), name)
                XCTAssertEqual(b.value, i32(e, "value"), name)
            }
        }
    }

    func testCapabilityMatchesJava() throws {
        try check("capability", minFailures: 2, parse: { p, _ in try Workout.WorkoutCapability.Response(packet: p) }) { r, f, name in
            XCTAssertEqual(r.supportNewStep, f.bool("supportNewStep"), name)
        }
    }

    func testSectionsMatchJava() throws {
        try check("sections", minFailures: 2, parse: { p, _ in try Workout.WorkoutSections.Response(packet: p) }) { r, f, name in
            XCTAssertEqual(r.error, optInt32(f, "error"), name)
            XCTAssertEqual(r.workoutId, i16(f, "workoutId"), name)
            XCTAssertEqual(r.number, i16(f, "number"), name)
            let expected = f.list("blocks")
            XCTAssertEqual(r.blocks.count, expected.count, name)
            for (b, e) in zip(r.blocks, expected) {
                func l(_ key: String) -> Int64 { (e[key] as? NSNumber)?.int64Value ?? 0 }
                XCTAssertEqual(Int64(b.num), l("num"), name)
                XCTAssertEqual(b.time, l("time"), name)
                XCTAssertEqual(b.distance, l("distance"), name)
                XCTAssertEqual(Int64(b.pace), l("pace"), name)
                XCTAssertEqual(Int64(b.heartRate), l("heartRate"), name)
                XCTAssertEqual(Int64(b.cadence), l("cadence"), name)
                XCTAssertEqual(Int64(b.stepLength), l("stepLength"), name)
                XCTAssertEqual(b.totalRise, l("totalRise"), name)
                XCTAssertEqual(b.totalDescend, l("totalDescend"), name)
                XCTAssertEqual(Int64(b.groundContactTime), l("groundContactTime"), name)
                XCTAssertEqual(Int64(b.groundImpact), l("groundImpact"), name)
                XCTAssertEqual(Int64(b.swingAngle), l("swingAngle"), name)
                XCTAssertEqual(Int64(b.eversion), l("eversion"), name)
                XCTAssertEqual(Int64(b.avgCadence), l("avgCadence"), name)
                XCTAssertEqual(Int64(b.intervalTrainingType), l("intervalTrainingType"), name)
                XCTAssertEqual(Int64(b.divingMaxDepth), l("divingMaxDepth"), name)
                XCTAssertEqual(Int64(b.divingUnderwaterTime), l("divingUnderwaterTime"), name)
                XCTAssertEqual(Int64(b.divingBreakTime), l("divingBreakTime"), name)
            }
        }
    }

    // MARK: GPS file

    func testGpsFileMatchesJava() throws {
        let cases = g.list("gps")
        XCTAssertGreaterThanOrEqual(cases.count, 12)
        var failures = 0
        for c in cases {
            let name = "gps: \(c.str("name"))"
            do {
                let points = try HuaweiGpsParser.parse(c.bytes("data"))
                guard c.bool("ok") else {
                    XCTFail("\(name): Java failed with \(c.str("exception")) but Swift parsed")
                    continue
                }
                let expected = c.list("points")
                XCTAssertEqual(points.count, expected.count, name)
                for (p, e) in zip(points, expected) {
                    XCTAssertEqual(p.timestamp, i32(e, "timestamp"), name)
                    XCTAssertEqual(p.pause, e.bool("pause"), name)
                    XCTAssertEqual(p.altitudeSupported, e.bool("altitudeSupported"), name)
                    sameDouble(p.altitude, e.str("altBits"), exact: true, name)
                    // The latitude is plain arithmetic; the longitude goes through cos(), whose last bit the JVM and libm may disagree on.
                    sameDouble(p.latitude, e.str("latBits"), exact: true, name)
                    sameDouble(p.longitude, e.str("lonBits"), exact: false, name)
                }
            } catch {
                guard !c.bool("ok") else {
                    XCTFail("\(name): Java parsed but Swift failed with \(error)")
                    continue
                }
                failures += 1
                let swiftName: String
                switch error as? SleepFilesParseError {
                case .illegalArgument?: swiftName = "IllegalArgumentException"
                case .bufferUnderflow?: swiftName = "BufferUnderflowException"
                default: swiftName = "\(error)"
                }
                XCTAssertEqual(swiftName, c.str("exception"), name)
            }
        }
        XCTAssertGreaterThanOrEqual(failures, 5)
    }

    private func sameDouble(_ value: Double, _ javaBitsHex: String, exact: Bool, _ name: String) {
        let java = Double(bitPattern: UInt64(javaBitsHex, radix: 16)!)
        if java.isNaN {
            XCTAssertTrue(value.isNaN, "\(name): Java NaN, Swift \(value)")
        } else if exact {
            XCTAssertEqual(value.bitPattern, java.bitPattern, "\(name): \(value) vs \(java)")
        } else if java.isInfinite {
            XCTAssertEqual(value, java, name)
        } else {
            XCTAssertEqual(value, java, accuracy: max(abs(java) * 1e-13, 1e-13), name)
        }
    }
}

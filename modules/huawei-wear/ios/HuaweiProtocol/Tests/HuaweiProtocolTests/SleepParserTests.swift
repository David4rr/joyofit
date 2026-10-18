import XCTest
@testable import HuaweiProtocol

/// The sleep file parsers against the vendored Java (GoldenGen/src/GoldenSleepParsers.java): TruSleepParser, SequenceDataFileParser,
/// TrueSleepSequenceDataParser and the dictionary constants. The inputs include the real watch bytes of TestHuaweiTruSleepParser.java.
final class SleepParserTests: XCTestCase {
    let g = try! Golden.load("sleep_parsers")

    private func canon(_ value: Any) -> String {
        let data = try! JSONSerialization.data(withJSONObject: ["v": value], options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: dictionary constants

    func testDictTypes() {
        XCTAssertEqual(HuaweiDictTypes.sleepDetailsClass, g.int("dictSleepDetailsClass"))
        XCTAssertEqual(HuaweiDictTypes.skinTemperatureClass, g.int("dictSkinTemperatureClass"))
        XCTAssertEqual(HuaweiDictTypes.skinTemperatureValue, g.int("dictSkinTemperatureValue"))
        XCTAssertEqual(HuaweiDictTypes.arrhythmiaClass, g.int("dictArrhythmiaClass"))
    }

    // MARK: HuaweiTruSleepParser.parseState

    func testParseStateMatchesJava() {
        let cases = g.list("state")
        XCTAssertGreaterThan(cases.count, 5)
        for c in cases {
            let input = c.bytes("input")
            let expected = (c["result"] as? [[Int]]) ?? []
            let actual = TruSleepParser.parseState(input).map { [Int($0.startTime), Int($0.endTime)] }
            XCTAssertEqual(actual, expected, c.str("input"))
            if let first = TruSleepParser.parseState(input).first, let javaString = c.opt("toString") {
                XCTAssertEqual(first.description, javaString)
            }
        }
    }

    /// TestHuaweiTruSleepParser.testParseState, verbatim.
    func testParseStateOfTheGadgetbridgeTest() {
        let r = TruSleepParser.parseState(Bytes(hex: "0100000002000000000000000000000003000000050000000000000000000000")!)
        XCTAssertEqual(r, [TruSleepParser.TruSleepStatus(startTime: 1, endTime: 2), TruSleepParser.TruSleepStatus(startTime: 3, endTime: 5)])
    }

    // MARK: HuaweiTruSleepParser.parseData

    func testParseDataMatchesJava() {
        let cases = g.list("data")
        XCTAssertGreaterThan(cases.count, 300)
        var errors = 0
        var withPpg = 0
        var withAcc = 0
        for c in cases {
            let input = c.bytes("input")
            let expected = c["result"] as? [String: Any] ?? [:]
            if expected["error"] != nil {
                errors += 1
                XCTAssertThrowsError(try TruSleepParser.parseData(input), "Java throws \(expected["error"] ?? ""): \(c.str("input"))") { e in
                    guard case SleepFilesParseError.negativeArraySize? = e as? SleepFilesParseError else { return XCTFail("\(e)") }
                }
                continue
            }
            do {
                let r = try TruSleepParser.parseData(input)
                let acc = r.dataACCs.map { [Int($0.startTime), Int($0.flags)] }
                let ppg = r.dataPPGs.map { [Int($0.startTime), Int($0.flags)] }
                XCTAssertEqual(acc, expected["acc"] as? [[Int]] ?? [], c.str("input"))
                XCTAssertEqual(ppg, expected["ppg"] as? [[Int]] ?? [], c.str("input"))
                if !acc.isEmpty { withAcc += 1 }
                if !ppg.isEmpty { withPpg += 1 }
            } catch {
                XCTFail("Swift throws \(error) but Java parses: \(c.str("input"))")
            }
        }
        // the Java only throws for a negative length (a NegativeArraySizeException)
        XCTAssertTrue(cases.compactMap { ($0["result"] as? [String: Any])?["error"] as? String }.allSatisfy { $0 == "NegativeArraySizeException" })
        XCTAssertGreaterThan(errors, 5)
        XCTAssertGreaterThan(withPpg, 30)
        XCTAssertGreaterThan(withAcc, 30)
    }

    /// TestHuaweiTruSleepParser.testParseDataPpg: the first and last sample of each real watch frame, and the sample counts.
    func testParseDataRealPpgFrames() throws {
        let t1 = Bytes(hex: "02B000403B0B672AAADA13C109A915E707BE130C06E3112104F80F84182F0888109900390805121004850E4317EC07C911D4037610C701580E2A02310F6B022B100E0448119B075B154F099916390A07191A0E9B00D10E2D02A7105405AAE8FDE8FDBDDA92B767943B71104EE52AB907EE06AC08BD06BE067C07DB06CC05E2079B06C206E906920639063807E0056406D905E2067807870660074D03720A8406AA0624064005CA07DF062D088706D2084B0A00")!
        let r1 = try TruSleepParser.parseData(t1)
        XCTAssertEqual(r1.dataPPGs.count, 42)
        XCTAssertEqual(r1.dataPPGs.first, TruSleepParser.TruSleepDataPpg(startTime: 1_728_789_362_820, flags: Int16(bitPattern: 0xfde8)))
        XCTAssertEqual(r1.dataPPGs.last, TruSleepParser.TruSleepDataPpg(startTime: 1_728_789_325_640, flags: 0x0a4b))
        let t2 = Bytes(hex: "027500F61E0B6724BB0C016968685756585753545050535354565B595B5B5B5F5C5A5E5B61635D5E5B5756585656AADD401138452F7826FC1D61221F27DD2BFC1A7B248B11260A7A221E1C9128FE185025C827D41C1B206223E31B73126210EC22B620D212B232DC0A93115A322E279B116717F30E2E1500")!
        let r2 = try TruSleepParser.parseData(t2)
        XCTAssertEqual(r2.dataPPGs.count, 36)
        XCTAssertEqual(r2.dataPPGs.first, TruSleepParser.TruSleepDataPpg(startTime: 1_728_782_072_680, flags: 0x40dd))
        XCTAssertEqual(r2.dataPPGs.last, TruSleepParser.TruSleepDataPpg(startTime: 1_728_782_104_140, flags: 0x152e))
        let t3 = Bytes(hex: "025A00B2180B671BBB410174706A726F6D6D747B757B776E6E6D6E6F777D77777670757570AA543D0E52276956406837B63C103EB22C6929C7265326EA2FCC2F743CC9380239673B9739EA2FC92CC526BB2E652D6433DD3506397E2F00")!
        let r3 = try TruSleepParser.parseData(t3)
        XCTAssertEqual(r3.dataPPGs.count, 27)
        XCTAssertEqual(r3.dataPPGs.first, TruSleepParser.TruSleepDataPpg(startTime: 1_728_780_469_210, flags: 0x3d54))
        XCTAssertEqual(r3.dataPPGs.last, TruSleepParser.TruSleepDataPpg(startTime: 1_728_780_499_040, flags: 0x2f7e))
    }

    /// TestHuaweiTruSleepParser.testParseDataAcc, testParsePadding, testParseFailure.
    func testParseDataAccPaddingAndFailures() throws {
        let acc = TruSleepParser.TruSleepDataAcc(startTime: 0x670b_2af0, flags: 0)
        for hex in ["0107F02A0B670000B6", "000107F02A0B670000B6", "00000000000107F02A0B670000B6"] {
            let r = try TruSleepParser.parseData(Bytes(hex: hex)!)
            XCTAssertEqual(r.dataACCs, [acc], hex)
            XCTAssertTrue(r.dataPPGs.isEmpty, hex)
        }
        for hex in [
            "0105F02A0B670000B6", "0100F02A0B670000B6", "0108F02A0B670000B6",
            "027600F61E0B6724BB0C016968685756585753545050535354565B595B5B5B5F5C5A5E5B61635D5E5B5756585656AADD401138452F7826FC1D61221F27DD2BFC1A7B248B11260A7A221E1C9128FE185025C827D41C1B206223E31B73126210EC22B620D212B232DC0A93115A322E279B116717F30E2E1500",
            "027500F61E0B6723BB0C016968685756585753545050535354565B595B5B5B5F5C5A5E5B61635D5E5B5756585656AADD401138452F7826FC1D61221F27DD2BFC1A7B248B11260A7A221E1C9128FE185025C827D41C1B206223E31B73126210EC22B620D212B232DC0A93115A322E279B116717F30E2E1500",
            "025A00B2180B671BCC410174706A726F6D6D747B757B776E6E6D6E6F777D77777670757570AA543D0E52276956406837B63C103EB22C6929C7265326EA2FCC2F743CC9380239673B9739EA2FC92CC526BB2E652D6433DD3506397E2F00",
            "025A00B2180B671BBB410174706A726F6D6D747B757B776E6E6D6E6F777D77777670757570DD543D0E52276956406837B63C103EB22C6929C7265326EA2FCC2F743CC9380239673B9739EA2FC92CC526BB2E652D6433DD3506397E2F00",
            "025A00B2180B671BBB410FFFFFFA726F6D6D747B757B776E6E6D6E6F777D77777670757570AA543D0E52276956406837B63C103EB22C6929C7265326EA2FCC2F743CC9380239673B9739EA2FC92CC526BB2E652D6433DD3506397E2F00",
        ] {
            let r = try TruSleepParser.parseData(Bytes(hex: hex)!)
            XCTAssertTrue(r.dataPPGs.isEmpty, hex)
            XCTAssertTrue(r.dataACCs.isEmpty, hex)
        }
    }

    // MARK: HuaweiSequenceDataFileParser

    func testSequenceFilesMatchJava() {
        let cases = g.list("sequenceFiles")
        XCTAssertGreaterThan(cases.count, 50)
        var errors = 0
        var parsed = 0
        for c in cases {
            let input = c.bytes("input")
            let expected = c["result"] as? [String: Any] ?? [:]
            let label = c.str("input").prefix(80)
            do {
                let file = try SequenceDataFileParser.parseSequenceFileData(input)
                XCTAssertNil(expected["error"], "Swift parses but Java throws \(expected["error"] ?? ""): \(label)")
                guard let file else {
                    XCTAssertEqual(expected["null"] as? Bool, true, "\(label)")
                    continue
                }
                parsed += 1
                XCTAssertEqual(Int(file.dictId), expected.int("dictId"), "\(label)")
                XCTAssertEqual(file.fileType, expected.int("fileType"), "\(label)")
                XCTAssertEqual(file.fileVersion, expected.int("fileVersion"), "\(label)")
                // Java's toString prints every field, including the ones without getters (dataSize, extra data).
                XCTAssertEqual(file.description, expected.str("toString"), "\(label)")
                let records = expected.list("records")
                XCTAssertEqual(file.sequenceDataList.count, records.count, "\(label)")
                for (sd, r) in zip(file.sequenceDataList, records) {
                    XCTAssertEqual(Int(sd.startTime), r.int("start"))
                    XCTAssertEqual(Int(sd.endTime), r.int("end"))
                    XCTAssertEqual(sd.dataVersion, r.int("version"))
                    XCTAssertEqual(sd.summaryType, r.int("summaryType"))
                    XCTAssertEqual(sd.summary?.hexLower, r.opt("summary"))
                    XCTAssertEqual(sd.details?.hexLower, r.opt("details"))
                }
            } catch {
                errors += 1
                XCTAssertNotNil(expected["error"], "Swift throws \(error) but Java parses: \(label)")
                if let name = expected.opt("error") {
                    switch (name, error as? SleepFilesParseError) {
                    case ("BufferUnderflowException", .bufferUnderflow?), ("NegativeArraySizeException", .negativeArraySize?): break
                    default: XCTFail("Java \(name), Swift \(error): \(label)")
                    }
                }
            }
        }
        XCTAssertGreaterThan(errors, 10)
        XCTAssertGreaterThan(parsed, 30)
    }

    // MARK: HuaweiTrueSleepSequenceDataParser

    /// Every stored property by name, as the Java golden dumps them: integers as numbers, doubles as their IEEE bits in hex.
    private func summaryDict(_ s: TrueSleepSequenceDataParser.SleepSummary, onlyChanged: Bool) -> [String: Any] {
        var o = [String: Any]()
        let defaultBits = (-1.0).bitPattern
        for child in Mirror(reflecting: s).children {
            guard let name = child.label else { continue }
            switch child.value {
            case let v as Int64: if !onlyChanged || v != -1 { o[name] = Int(v) }
            case let v as Int32: if !onlyChanged || v != -1 { o[name] = Int(v) }
            case let d as Double: if !onlyChanged || d.bitPattern != defaultBits { o[name] = String(d.bitPattern, radix: 16) }
            default: XCTFail("unexpected field type of \(name)")
            }
        }
        return o
    }

    private func sequenceFileData(fileType: Int) -> SequenceDataFileParser.SequenceFileData {
        var f = SequenceDataFileParser.SequenceFileData()
        f.fileType = fileType
        f.dictId = 700013
        return f
    }

    private func sequenceData(version: Int, summaryType: Int, summary: Bytes?) -> SequenceDataFileParser.SequenceData {
        var d = SequenceDataFileParser.SequenceData()
        d.dataVersion = version
        d.summaryType = summaryType
        d.summary = summary
        d.startTime = 1
        d.endTime = 2
        return d
    }

    private func triplet(_ dictId: Int, _ type: Int, _ value: Bytes) -> HuaweiTLV {
        var t = HuaweiTLV()
        t.put(0x03, int: Int32(dictId))
        t.put(0x04, byte: UInt8(truncatingIfNeeded: type))
        t.put(0x05, bytes: value)
        return t
    }

    private func summaryTLV(_ triplets: [HuaweiTLV]) -> Bytes {
        var mid = HuaweiTLV()
        for t in triplets { mid.put(0x82, tlv: t) }
        var top = HuaweiTLV()
        top.put(0x81, tlv: mid)
        return top.serialize()
    }

    /// Every dictionary id with every data type and a spread of values (one triplet per summary): all 39 `fillData` branches, their
    /// range checks and the int / long / double readers of GB's parser base.
    func testSummarySweepMatchesJava() throws {
        let sweep = try Golden.load("sleep_summaries")
        let cases = sweep["summaries"] as? [[Any]] ?? []
        XCTAssertGreaterThan(cases.count, 3000)
        let parser = TrueSleepSequenceDataParser()
        var stored = 0
        for c in cases {
            let dictId = (c[0] as? NSNumber)?.intValue ?? 0
            let type = (c[1] as? NSNumber)?.intValue ?? 0
            let value = Bytes(hex: c[2] as? String ?? "") ?? []
            let expected = c[3] as? [String: Any] ?? [:]
            let summary = summaryTLV([triplet(dictId, type, value)])
            let label = "dict \(dictId) type \(type) value \(value.hexLower)"
            do {
                guard let s = try parser.parseData(file: sequenceFileData(fileType: 1), data: sequenceData(version: 1, summaryType: 2, summary: summary)) else {
                    XCTFail("nil summary: \(label)")
                    continue
                }
                let raw = summaryDict(s, onlyChanged: true)
                if !raw.isEmpty { stored += 1 }
                XCTAssertEqual(canon(raw), canon(expected["raw"] ?? [:]), label)
            } catch {
                XCTFail("Swift throws \(error): \(label)")
            }
        }
        XCTAssertGreaterThan(stored, 1500)
        XCTAssertEqual(Set(cases.map { ($0[0] as? NSNumber)?.intValue ?? 0 }).count, 39, "all 39 dictionary ids are swept")
    }

    func testSummaryShapesMatchJava() {
        let cases = g.list("summaryShapes")
        XCTAssertGreaterThan(cases.count, 25)
        let parser = TrueSleepSequenceDataParser()
        for c in cases {
            let name = c.str("name")
            let expected = c["result"] as? [String: Any] ?? [:]
            let summary = c.optBytes("summary")
            do {
                let s = try parser.parseData(file: sequenceFileData(fileType: c.int("fileType")), data: sequenceData(version: c.int("version"), summaryType: c.int("summaryType"), summary: summary))
                XCTAssertNil(expected["error"], "\(name): Swift parses, Java throws \(expected["error"] ?? "")")
                guard var s else {
                    XCTAssertEqual(expected["null"] as? Bool, true, name)
                    continue
                }
                XCTAssertEqual(canon(summaryDict(s, onlyChanged: false)), canon(expected["raw"] ?? [:]), "\(name): raw")
                if Self.javaFormattingMatches(s) {
                    XCTAssertEqual(s.description, expected.str("toString"), "\(name): toString")
                }
                TrueSleepSequenceDataParser.correctSummary(&s)
                XCTAssertEqual(canon(summaryDict(s, onlyChanged: false)), canon(expected["corrected"] ?? [:]), "\(name): corrected")
            } catch {
                XCTAssertNotNil(expected["error"], "\(name): Swift throws \(error), Java parses")
            }
        }
    }

    /// Java's and Swift's `Double` printing agree on plain decimals; skip the rest (a log line only).
    private static func javaFormattingMatches(_ s: TrueSleepSequenceDataParser.SleepSummary) -> Bool {
        [s.minOxygenSaturation, s.maxOxygenSaturation, s.minBreathRate, s.maxBreathRate].allSatisfy { d in
            d.isFinite && abs(d) < 1e7 && (abs(d) >= 1e-3 || d == 0)
        }
    }

    func testShapeErrorsAreSleepFilesParseErrors() {
        let parser = TrueSleepSequenceDataParser()
        XCTAssertThrowsError(try parser.parseData(file: sequenceFileData(fileType: 1), data: sequenceData(version: 1, summaryType: 2, summary: nil))) { e in
            guard case SleepFilesParseError.missingInput? = e as? SleepFilesParseError else { return XCTFail("\(e)") }
        }
        XCTAssertThrowsError(try parser.parseData(file: sequenceFileData(fileType: 1), data: sequenceData(version: 1, summaryType: 2, summary: [0x81, 0x50, 1, 2]))) { e in
            guard case SleepFilesParseError.malformedTLV? = e as? SleepFilesParseError else { return XCTFail("\(e)") }
        }
    }

    func testGetTimeMatchesJava() {
        let cases = g.list("getTime")
        XCTAssertGreaterThan(cases.count, 1000)
        for c in cases {
            let fall = (c["fall"] as? NSNumber)?.int64Value ?? 0
            let bed = (c["bed"] as? NSNumber)?.int64Value ?? 0
            let valid = Int32(truncatingIfNeeded: c.int("valid"))
            let supports = c.bool("supportsBedTime")
            let expected = (c["result"] as? NSNumber)?.int64Value ?? 0
            XCTAssertEqual(TrueSleepSequenceDataParser.getTime(fallAsleepTime: fall, bedTime: bed, validData: valid, supportsBedTime: supports), expected, "\(fall) \(bed) \(valid) \(supports)")
        }
    }

    func testSleepDetailsMatchJava() {
        let cases = g.list("sleepDetails")
        XCTAssertGreaterThan(cases.count, 100)
        var thrown = 0
        var nils = 0
        var stagesCount = 0
        for c in cases {
            let input = c.bytes("input")
            let time = (c["time"] as? NSNumber)?.int64Value ?? 0
            let expected = c["result"] as? [String: Any] ?? [:]
            let label = "\(c.str("input").prefix(60)) @\(time)"
            do {
                let stages = try TrueSleepSequenceDataParser.parseSleepDetails(input, time: time)
                XCTAssertNil(expected["error"], "Swift parses, Java throws \(expected["error"] ?? ""): \(label)")
                guard let stages else {
                    nils += 1
                    XCTAssertEqual(expected["null"] as? Bool, true, label)
                    continue
                }
                stagesCount += 1
                XCTAssertEqual(expected["contiguous"] as? Bool, true, label)
                XCTAssertEqual(Self.runs(stages), expected["stages"] as? [[Int]] ?? [], label)
                for (i, s) in stages.enumerated() { XCTAssertEqual(s.time, time + 60 * Int64(i), label) }
            } catch {
                thrown += 1
                XCTAssertEqual(expected["error"] as? String, "BufferUnderflowException", "\(label): \(error)")
            }
        }
        XCTAssertGreaterThan(thrown, 5)
        XCTAssertGreaterThan(nils, 3)
        XCTAssertGreaterThan(stagesCount, 50)
    }

    /// Stages as [stage, minutes] runs, the form of the golden.
    static func runs(_ stages: [TrueSleepSequenceDataParser.SleepStage]) -> [[Int]] {
        var out = [[Int]]()
        for s in stages {
            if let last = out.last, last[0] == s.stage { out[out.count - 1][1] += 1 } else { out.append([s.stage, 1]) }
        }
        return out
    }

    /// `details.length % 4 == 0` lets a record of 8 bytes be cut at 4: GB reads a status byte past the end and throws.
    func testSleepDetailsTruncatedRecordThrows() {
        let record = Bytes([60, 0, 0, 0, 1, 0, 0, 0])
        XCTAssertEqual(try TrueSleepSequenceDataParser.parseSleepDetails(record, time: 0)?.count, 1)
        XCTAssertThrowsError(try TrueSleepSequenceDataParser.parseSleepDetails(record + [60, 0, 0, 0], time: 0))
        XCTAssertNil(try TrueSleepSequenceDataParser.parseSleepDetails(record + [60], time: 0))
        XCTAssertEqual(try TrueSleepSequenceDataParser.parseSleepDetails([], time: 5)?.count, 0)
    }
}

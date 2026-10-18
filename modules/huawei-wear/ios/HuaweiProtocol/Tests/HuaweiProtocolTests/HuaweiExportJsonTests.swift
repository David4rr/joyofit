import Foundation
import XCTest
@testable import HuaweiProtocol

/// Translation of HuaweiExportJsonTest.kt, plus the chunk-boundary and parser cases the byte-wise port adds.
final class HuaweiExportJsonTests: XCTestCase {
    private final class Scan {
        var records = [String]()
        var unterminated = [String]()
        var oversized = 0
    }

    private func scan(_ text: String, maxBytes: Int = HuaweiExportJson.maxRecordBytes, pieceSize: Int = 16 * 1024) throws -> Scan {
        let out = Scan()
        try HuaweiExportJson.forEachRecord(
            Bytes(text.utf8), pieceSize: pieceSize, maxRecordBytes: maxBytes,
            onRecord: { out.records.append(String(decoding: $0, as: UTF8.self)) },
            onUnterminated: { out.unterminated.append(String(decoding: $0, as: UTF8.self)) },
            onOversized: { out.oversized += 1 }
        )
        return out
    }

    func testSplitsTopLevelArrayIntoRecords() throws {
        for piece in [1, 2, 3, 7, 16 * 1024] {
            let out = try scan("\u{FEFF}[ {\"a\":1}, {\"b\":[1,2,{\"c\":3}]} ,\n{\"d\":\"x\"} ]", pieceSize: piece)
            XCTAssertEqual(out.records, ["{\"a\":1}", "{\"b\":[1,2,{\"c\":3}]}", "{\"d\":\"x\"}"], "piece \(piece)")
            XCTAssertEqual(out.unterminated.count, 0)
        }
    }

    func testSingleObjectFileIsOneRecord() throws {
        XCTAssertEqual(try scan("{\"sportType\":4,\"attribute\":\"x\"}").records.count, 1)
    }

    func testBracesAndQuotesInsideStringsDoNotEndARecord() throws {
        let record = #"{"v":"a } b \" } c { d","w":2}"#
        for piece in [1, 4, 16 * 1024] {
            XCTAssertEqual(try scan("[\(record),\(record)]", pieceSize: piece).records, [record, record], "piece \(piece)")
        }
    }

    func testRecordOpenAtTheEndIsReportedWithItsText() throws {
        for piece in [1, 5, 16 * 1024] {
            let out = try scan(#"[{"a":1},{"b":"never closed"#, pieceSize: piece)
            XCTAssertEqual(out.records, ["{\"a\":1}"])
            XCTAssertEqual(out.unterminated, [#"{"b":"never closed"#])
        }
    }

    func testOversizedRecordIsSkippedAndTheNextOneStillRead() throws {
        let big = "{\"x\":\"" + String(repeating: "a", count: 100) + "\"}"
        for piece in [1, 30, 16 * 1024] {
            let out = try scan("[\(big),{\"y\":1}]", maxBytes: 50, pieceSize: piece)
            XCTAssertEqual(out.oversized, 1, "piece \(piece)")
            XCTAssertEqual(out.records, ["{\"y\":1}"], "piece \(piece)")
        }
    }

    func testOversizedRecordLeftOpenAtTheEndIsCountedNotReported() throws {
        let out = try scan("[{\"x\":\"" + String(repeating: "a", count: 100), maxBytes: 50)
        XCTAssertEqual(out.oversized, 1)
        XCTAssertTrue(out.unterminated.isEmpty)
    }

    func testMultibyteTextSurvivesChunking() throws {
        let record = "{\"n\":\"Zürich ✓ 心拍\"}"
        XCTAssertEqual(try scan("[\(record)]", pieceSize: 1).records, [record])
    }

    func testParseObjectRepairsBareNumericKeys() throws {
        let obj = try XCTUnwrap(HuaweiExportJson.parseObject(#"{"partTimeMap":{1.0:439.0,2.0:451.0},"n":3}"#))
        XCTAssertEqual(HuaweiExportJson.number(obj["n"]), 3)
        XCTAssertEqual(HuaweiExportJson.number(obj.optObject("partTimeMap")?["1.0"]), 439.0)
        XCTAssertEqual(HuaweiExportJson.number(obj.optObject("partTimeMap")?["2.0"]), 451.0)
    }

    func testParseObjectReturnsNilForGarbage() {
        XCTAssertNil(HuaweiExportJson.parseObject("{\"a\": }"))
        XCTAssertNil(HuaweiExportJson.parseObject("not json"))
        XCTAssertNil(HuaweiExportJson.parseObject(""))
        XCTAssertNil(HuaweiExportJson.parseObject("[1,2]"))
    }

    func testParserKeepsWhatOrgJsonKeeps() throws {
        let obj = try XCTUnwrap(
            HuaweiExportJson.parseObject(
                "{\"s\":\"a\\nb\\u00e9\\ud83d\\ude00\\/\",\"raw\":\"tab\there\",\"t\":true,\"nul\":null,\"arr\":[1,-2.5e2,\"x\",],\"o\":{},} trailing"
            ))
        XCTAssertEqual(obj["s"], .string("a\nbé😀/"))
        XCTAssertEqual(obj["raw"], .string("tab\there"))
        XCTAssertEqual(obj["t"], .bool(true))
        XCTAssertEqual(obj["nul"], .null)
        XCTAssertEqual(obj["arr"], .array([.number(1), .number(-250), .string("x")]))
        XCTAssertEqual(obj["o"], .object([:]))
        XCTAssertNil(obj["absent"])
    }

    func testNumbersMayBeStrings() {
        XCTAssertEqual(HuaweiExportJson.number(.string("82.0")), 82.0)
        XCTAssertEqual(HuaweiExportJson.number(.number(7)), 7.0)
        XCTAssertNil(HuaweiExportJson.number(.string("abc")))
        XCTAssertNil(HuaweiExportJson.number(nil))
        XCTAssertNil(HuaweiExportJson.number(.string("NaN")))
        XCTAssertNil(HuaweiExportJson.number(.null))
        XCTAssertNil(HuaweiExportJson.number(.bool(true)))
        XCTAssertEqual(HuaweiExportJson.number(.string(" 1.75000002E9 ")), 1.75000002e9)
        XCTAssertEqual(HuaweiExportJson.number(.string("-.5")), -0.5)
        XCTAssertEqual(HuaweiExportJson.number(.string("5.")), 5.0)
        XCTAssertEqual(HuaweiExportJson.number(.string("3f")), 3.0)
        XCTAssertNil(HuaweiExportJson.number(.string("inf")))
        XCTAssertNil(HuaweiExportJson.number(.string("0x10")))
        XCTAssertNil(HuaweiExportJson.number(.string("1e")))
    }

    func testEmbeddedObjectReadsAJsonStringValue() throws {
        let obj = try XCTUnwrap(HuaweiExportJson.embeddedObject(.string(#"{"avgSaturation":97}"#)))
        XCTAssertEqual(HuaweiExportJson.number(obj["avgSaturation"]), 97)
        XCTAssertNil(HuaweiExportJson.embeddedObject(.string("82.0")))
        XCTAssertNotNil(HuaweiExportJson.embeddedObject(.object(["a": .null])))
    }

    func testEpochTimesAreMillisecondsWithASecondsFallbackAndASanityRange() {
        XCTAssertEqual(HuaweiExportJson.epochMs(.number(1_750_000_000_000)), 1_750_000_000_000)
        XCTAssertEqual(HuaweiExportJson.epochMs(.string("1750000000")), 1_750_000_000_000)
        XCTAssertNil(HuaweiExportJson.epochMs(.number(0)))
        XCTAssertNil(HuaweiExportJson.epochMs(.number(5_000_000_000_000_000)))
        XCTAssertNil(HuaweiExportJson.epochMs(.string("x")))
        XCTAssertNil(HuaweiExportJson.epochMs(.number(1e300)))
    }

    func testKotlinRounding() {
        XCTAssertEqual(KotlinNumbers.roundToInt(57.4), 57)
        XCTAssertEqual(KotlinNumbers.roundToInt(2.5), 3)
        XCTAssertEqual(KotlinNumbers.roundToInt(-2.5), -2)
        XCTAssertEqual(KotlinNumbers.roundToInt(0.49999999999999994), 0)
        XCTAssertEqual(KotlinNumbers.roundToInt(1e30), Int(Int32.max))
        XCTAssertEqual(KotlinNumbers.roundToInt(-1e30), Int(Int32.min))
        XCTAssertEqual(KotlinNumbers.toLong(1e30), Int64.max)
        XCTAssertEqual(KotlinNumbers.toLong(-7.9), -7)
    }
}

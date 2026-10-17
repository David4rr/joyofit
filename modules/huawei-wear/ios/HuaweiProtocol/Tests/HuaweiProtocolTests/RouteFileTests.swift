import XCTest
@testable import HuaweiProtocol

/// The route file against Gadgetbridge's own `HuaweiConvertTrack`: Fixtures/route.json is written by GoldenGen/run.sh (GoldenRoute.java) from the
/// vendored Java; RouteFileTest.kt reads the same file, so both ports and the reference agree to the byte.
final class RouteFileTests: XCTestCase {
    /// route.json read with exact decimal parsing: Foundation's `JSONSerialization` on Linux rounds some 17-digit doubles (`137.65113100000002`) one ulp off,
    /// which moves the altitude profile's interpolated longitude. Java (the reference) and Swift's `Double(_:)` parse them exactly.
    private static func load() throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/route.json")
        var parser = ExactJSON(Array(try Data(contentsOf: url)))
        guard let root = try parser.value() as? [String: Any] else { throw ExactJSON.Failure() }
        return root
    }

    private func hex(_ s: String) -> Bytes { Bytes(hex: s)! }

    private func trackOf(_ c: [String: Any]) -> RouteTrack {
        let points = (c["points"] as? [[NSNumber]]) ?? []
        let fixes = points.map { RouteFix(lat: $0[0].doubleValue, lon: $0[1].doubleValue, alt: $0[2].doubleValue) }
        return RouteTrack(
            id: c.str("id"), name: c.str("name"), fixes: fixes, hasAltitude: c.bool("hasAltitude"),
            totalTimeSec: Int64((c["totalTime"] as? NSNumber)?.int64Value ?? 0), version: c.int("version")
        )
    }

    func testConvertedFilesMatchGadgetbridgeByteForByte() throws {
        let cases = try Self.load().list("cases")
        XCTAssertGreaterThanOrEqual(cases.count, 9)
        for c in cases {
            let actual = RouteFile.convert(trackOf(c), maxPoints: c.int("maxPoints"))
            let expected = hex(c.str("file"))
            let firstDiff = zip(actual, expected).enumerated().first { $0.element.0 != $0.element.1 }?.offset
            XCTAssertTrue(actual == expected, "\(c.str("name")): sizes \(actual.count) vs \(expected.count), first difference at byte \(firstDiff.map(String.init) ?? "none")")
        }
    }

    func testPointCountReadsTheHeader() throws {
        let cases = try Self.load().list("cases")
        XCTAssertEqual(RouteFile.pointCount(file: hex(cases[0].str("file")), version: 1), 2)
        for c in cases {
            let file = hex(c.str("file"))
            let version = c.int("version")
            let count = RouteFile.pointCount(file: file, version: version)
            let expected = version == 1 ? 12 + 40 * count : 0x108 + 0x38 * count + (c.bool("hasAltitude") ? 0xd38 : 0)
            XCTAssertEqual(file.count, expected, c.str("name"))
            XCTAssertLessThanOrEqual(count, c.int("maxPoints"))
        }
    }

    func testHandshakeBodyIsTagFiveWithAVarintLength() throws {
        for h in try Self.load().list("handshakes") {
            XCTAssertEqual(RouteFile.handshakeBody(name: h.str("name")), hex(h.str("body")), h.str("name"))
        }
    }

    func testFileMessageIsHeaderPlusBody() throws {
        let m = try XCTUnwrap(try Self.load()["message"] as? [String: Any])
        XCTAssertEqual(RouteFile.message(businessType: m.int("type"), messageId: m.int("messageId"), payload: m.bytes("body")), m.bytes("bytes"))
    }

    func testAnswersAreLittleEndianCodeAndPointLimit() throws {
        let answer = try XCTUnwrap(RouteFile.parseAnswer(hex("01000000" + "c8000000")))
        XCTAssertEqual(answer.code, 1)
        XCTAssertEqual(answer.maxPoints, 200)
        XCTAssertEqual(RouteFile.pointLimit(answer), 200)
        XCTAssertEqual(RouteFile.pointLimit(RouteFile.parseAnswer(hex("01000000f4010000"))), 500)
        // A limit under 200 is raised to 200 (what Huawei Health and Gadgetbridge do), no limit at all gives 200.
        XCTAssertEqual(RouteFile.pointLimit(RouteFile.parseAnswer(hex("0100000064000000"))), 200)
        let noLimit = try XCTUnwrap(RouteFile.parseAnswer(hex("03000000")))
        XCTAssertEqual(noLimit.code, 3)
        XCTAssertNil(noLimit.maxPoints)
        XCTAssertEqual(RouteFile.pointLimit(noLimit), 200)
        XCTAssertNil(RouteFile.parseAnswer(hex("0100")))
        XCTAssertEqual(RouteFile.pointLimit(nil), 200)
    }

    func testValidationRejectsWhatTheWatchCannotTake() {
        func fixes(_ n: Int) -> [RouteFix] { (0..<n).map { RouteFix(lat: -7.98 + Double($0) * 0.001, lon: 112.63, alt: 0) } }
        func track(_ id: String, _ name: String, _ f: [RouteFix], _ alt: Bool = false, _ version: Int = 2) -> RouteTrack {
            RouteTrack(id: id, name: name, fixes: f, hasAltitude: alt, totalTimeSec: 0, version: version)
        }
        func rejects(_ t: RouteTrack) -> Bool {
            do {
                try RouteFile.validate(t)
                return false
            } catch let e as WearError {
                return e.code == .invalidArgument
            } catch {
                return false
            }
        }
        XCTAssertNoThrow(try RouteFile.validate(track("id", "Lari", fixes(2))))
        XCTAssertTrue(rejects(track("id", " ", fixes(2))))
        XCTAssertTrue(rejects(track("id", String(repeating: "x", count: 101), fixes(2))))
        XCTAssertTrue(rejects(track("id", "Lari", fixes(1))))
        XCTAssertTrue(rejects(track("id", "Lari", [RouteFix(lat: 0, lon: 112, alt: 0), RouteFix(lat: 1, lon: 112, alt: 0)])))
        XCTAssertTrue(rejects(track("id", "Lari", [RouteFix(lat: -7, lon: 181, alt: 0), RouteFix(lat: -7.1, lon: 112, alt: 0)])))
        XCTAssertTrue(rejects(track("id", "Lari", [RouteFix(lat: .nan, lon: 112, alt: 0), RouteFix(lat: -7.1, lon: 112, alt: 0)])))
        XCTAssertTrue(rejects(track("id", "Lari", fixes(2), true, 1)))
        XCTAssertTrue(rejects(track("id", "Lari", fixes(2), false, 3)))
        XCTAssertTrue(rejects(track(String(repeating: "x", count: 37), "Lari", fixes(2))))
    }

    func testAnUnconvertibleRouteGivesAnEmptyFile() {
        let one = RouteTrack(id: "id", name: "Lari", fixes: [RouteFix(lat: -7, lon: 112, alt: 0)], hasAltitude: false, totalTimeSec: 0)
        XCTAssertEqual(RouteFile.convert(one, maxPoints: 200).count, 0)
        let equator = RouteTrack(id: "id", name: "Lari", fixes: [RouteFix(lat: 0, lon: 112, alt: 0), RouteFix(lat: 1, lon: 112, alt: 0)], hasAltitude: false, totalTimeSec: 0)
        XCTAssertEqual(RouteFile.convert(equator, maxPoints: 200).count, 0)
    }
}

/// Just enough JSON for the fixture: objects, arrays, strings (no escapes beyond `\\"`), numbers as `NSNumber(Double)`, booleans.
private struct ExactJSON {
    struct Failure: Error {}
    private let bytes: [UInt8]
    private var at = 0

    init(_ bytes: [UInt8]) { self.bytes = bytes }

    private mutating func skipSpace() { while at < bytes.count, bytes[at] == 0x20 || bytes[at] == 0x0A || bytes[at] == 0x0D || bytes[at] == 0x09 { at += 1 } }

    private mutating func expect(_ c: Character) throws {
        skipSpace()
        guard at < bytes.count, bytes[at] == c.asciiValue else { throw Failure() }
        at += 1
    }

    mutating func value() throws -> Any {
        skipSpace()
        guard at < bytes.count else { throw Failure() }
        switch bytes[at] {
        case UInt8(ascii: "{"):
            at += 1
            var object = [String: Any]()
            skipSpace()
            if bytes[at] == UInt8(ascii: "}") { at += 1; return object }
            while true {
                skipSpace()
                let key = try string()
                try expect(":")
                object[key] = try value()
                skipSpace()
                if bytes[at] == UInt8(ascii: ",") { at += 1; continue }
                try expect("}")
                return object
            }
        case UInt8(ascii: "["):
            at += 1
            var array = [Any]()
            skipSpace()
            if bytes[at] == UInt8(ascii: "]") { at += 1; return array }
            while true {
                array.append(try value())
                skipSpace()
                if bytes[at] == UInt8(ascii: ",") { at += 1; continue }
                try expect("]")
                return array
            }
        case UInt8(ascii: "\""): return try string()
        case UInt8(ascii: "t"): at += 4; return NSNumber(value: true)
        case UInt8(ascii: "f"): at += 5; return NSNumber(value: false)
        case UInt8(ascii: "n"): at += 4; return NSNull()
        default:
            let start = at
            while at < bytes.count, "+-.eE0123456789".utf8.contains(bytes[at]) { at += 1 }
            guard let number = Double(String(decoding: bytes[start..<at], as: UTF8.self)) else { throw Failure() }
            return NSNumber(value: number)
        }
    }

    private mutating func string() throws -> String {
        try expect("\"")
        let start = at
        while at < bytes.count, bytes[at] != UInt8(ascii: "\"") { at += 1 }
        let text = String(decoding: bytes[start..<at], as: UTF8.self)
        at += 1
        return text
    }
}

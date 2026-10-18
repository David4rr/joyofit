import Foundation
import XCTest
@testable import HuaweiProtocol

/// A PNG writer for tests: stored deflate blocks, filter 0 rows, optional extra chunks.
enum TestPng {
    static func chunk(_ type: String, _ body: Bytes) -> Bytes {
        var out = Bytes()
        out.appendBE(UInt32(body.count))
        let typed = Bytes(type.utf8) + body
        out += typed
        out.appendBE(CRC32.checksum(typed))
        return out
    }

    /// `rows` are unfiltered scanlines (already packed for the bit depth).
    static func build(width: Int, height: Int, depth: Int, colorType: Int, rows: [Bytes], extra: [(String, Bytes)] = [], filter: UInt8 = 0) -> Bytes {
        var ihdr = Bytes()
        ihdr.appendBE(UInt32(width))
        ihdr.appendBE(UInt32(height))
        ihdr += [UInt8(depth), UInt8(colorType), 0, 0, 0]
        var raw = Bytes()
        for r in rows { raw += [filter] + r }
        var z: Bytes = [0x78, 0x01]
        var pos = 0
        repeat {
            let n = min(65_535, raw.count - pos)
            let final = pos + n >= raw.count
            z += [final ? 1 : 0, UInt8(n & 0xFF), UInt8(n >> 8), UInt8(~n & 0xFF), UInt8((~n >> 8) & 0xFF)]
            z += raw[pos..<pos + n]
            pos += n
        } while pos < raw.count
        z.appendBE(PngDecoder.adler32(raw))
        var out: Bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        out += chunk("IHDR", ihdr)
        for (t, b) in extra { out += chunk(t, b) }
        out += chunk("IDAT", z)
        out += chunk("IEND", [])
        return out
    }
}

final class PngDecoderTests: XCTestCase {
    func testEveryColourTypeBitDepthAndInterlaceMatchesAnIndependentDecoder() throws {
        XCTAssertEqual(PngVectors.all.count, 19)
        for v in PngVectors.all {
            let image = try PngDecoder.decode(Bytes(hex: v.png)!)
            XCTAssertEqual(image.width, PngVectors.width, v.name)
            XCTAssertEqual(image.height, PngVectors.height, v.name)
            let expected = Bytes(hex: v.rgba)!
            var rgba = Bytes()
            for p in image.argb { rgba += [UInt8((p >> 16) & 0xFF), UInt8((p >> 8) & 0xFF), UInt8(p & 0xFF), UInt8(p >> 24)] }
            XCTAssertEqual(rgba, expected, v.name)
            let size = try PngDecoder.size(of: Bytes(hex: v.png)!)
            XCTAssertEqual(size.width, PngVectors.width)
            XCTAssertEqual(size.height, PngVectors.height)
        }
    }

    func testPackedGrayAtTwoAndFourBits() throws {
        // 2-bit: 0,1,2,3 in one byte, then 4-bit: 0,5,10,15.
        let two = try PngDecoder.decode(TestPng.build(width: 4, height: 1, depth: 2, colorType: 0, rows: [[0b0001_1011]]))
        XCTAssertEqual(two.argb, [0xFF00_0000, 0xFF55_5555, 0xFFAA_AAAA, 0xFFFF_FFFF])
        let four = try PngDecoder.decode(TestPng.build(width: 4, height: 1, depth: 4, colorType: 0, rows: [[0x05, 0xAF]]))
        XCTAssertEqual(four.argb, [0xFF00_0000, 0xFF55_5555, 0xFFAA_AAAA, 0xFFFF_FFFF])
    }

    func testTransparencyChunk() throws {
        let gray = try PngDecoder.decode(TestPng.build(width: 2, height: 1, depth: 8, colorType: 0, rows: [[10, 200]], extra: [("tRNS", [0, 10])]))
        XCTAssertEqual(gray.argb, [0x0000_0A0A | 0x000A_0000, 0xFFC8_C8C8])
        let rgb = try PngDecoder.decode(TestPng.build(width: 2, height: 1, depth: 8, colorType: 2, rows: [[1, 2, 3, 4, 5, 6]], extra: [("tRNS", [0, 1, 0, 2, 0, 3])]))
        XCTAssertEqual(rgb.argb, [0x0001_0203, 0xFF04_0506])
        let palette = try PngDecoder.decode(TestPng.build(width: 3, height: 1, depth: 8, colorType: 3, rows: [[0, 1, 2]], extra: [("PLTE", [255, 0, 0, 0, 255, 0, 0, 0, 255]), ("tRNS", [0, 128])]))
        XCTAssertEqual(palette.argb, [0x00FF_0000, 0x8000_FF00, 0xFF00_00FF])
    }

    func testSixteenBitKeepsTheHighByte() throws {
        let image = try PngDecoder.decode(TestPng.build(width: 1, height: 1, depth: 16, colorType: 6, rows: [[0x12, 0x99, 0x34, 0x00, 0x56, 0xFF, 0x78, 0x01]]))
        XCTAssertEqual(image.argb, [0x7812_3456])
    }

    func testSizeReadsTheHeaderOnly() throws {
        let png = TestPng.build(width: 7, height: 3, depth: 8, colorType: 0, rows: Array(repeating: Bytes(repeating: 0, count: 7), count: 3))
        XCTAssertEqual(try PngDecoder.size(of: png).width, 7)
        XCTAssertEqual(try PngDecoder.size(of: png).height, 3)
        XCTAssertThrowsError(try PngDecoder.size(of: [1, 2, 3]))
    }

    func testRefusals() {
        let good = TestPng.build(width: 2, height: 2, depth: 8, colorType: 0, rows: [[1, 2], [3, 4]])
        XCTAssertNoThrow(try PngDecoder.decode(good))
        XCTAssertThrowsError(try PngDecoder.decode([]))
        XCTAssertThrowsError(try PngDecoder.decode(Bytes(repeating: 1, count: 40)), "no signature")
        var badCrc = good
        badCrc[20] ^= 0xFF // inside IHDR
        XCTAssertThrowsError(try PngDecoder.decode(badCrc))
        XCTAssertThrowsError(try PngDecoder.decode(Array(good.dropLast(30))), "truncated")
        XCTAssertThrowsError(try PngDecoder.decode(TestPng.build(width: 2, height: 2, depth: 8, colorType: 0, rows: [[1, 2]])), "too little data")
        XCTAssertThrowsError(try PngDecoder.decode(TestPng.build(width: 2, height: 1, depth: 3, colorType: 0, rows: [[1, 2]])), "bad depth")
        XCTAssertThrowsError(try PngDecoder.decode(TestPng.build(width: 2, height: 1, depth: 8, colorType: 3, rows: [[0, 1]])), "palette without PLTE")
        XCTAssertThrowsError(try PngDecoder.decode(TestPng.build(width: 2, height: 1, depth: 8, colorType: 0, rows: [[1, 2]], filter: 9)), "bad filter")
        XCTAssertThrowsError(try PngDecoder.decode(TestPng.build(width: 70_000, height: 70_000, depth: 8, colorType: 0, rows: [])), "too many pixels")
        var corruptZ = good
        corruptZ[corruptZ.count - 20] ^= 0x55
        XCTAssertThrowsError(try PngDecoder.decode(corruptZ))
    }

    func testAFullScreenPhotoDecodesQuickly() throws {
        // A 408 x 480 RGB image, every row filter 0, built by the test writer.
        let row = Bytes((0..<408 * 3).map { UInt8(truncatingIfNeeded: $0) })
        let png = TestPng.build(width: 408, height: 480, depth: 8, colorType: 2, rows: Array(repeating: row, count: 480))
        let image = try PngDecoder.decode(png)
        XCTAssertEqual(image.argb.count, 408 * 480)
        XCTAssertEqual(image.argb[0], 0xFF00_0102)
        XCTAssertEqual(image.argb[1], 0xFF03_0405)
    }
}

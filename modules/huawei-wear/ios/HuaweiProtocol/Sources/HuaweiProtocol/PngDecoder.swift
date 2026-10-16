// A PNG decoder (all colour types and bit depths, tRNS transparency, Adam7 interlace) for the photo face: the Android code lets
// `BitmapFactory` decode the picked picture and reads `Bitmap.getPixels`; this gives the same 0xAARRGGBB pixels without an image framework, so
// the conversion to the watch's `.bin` is testable anywhere. Colour management chunks (gAMA, cHRM, iCCP, sRGB) are ignored, as BitmapFactory
// ignores them for the pixel values. Sixteen-bit samples keep their high byte.
import Foundation

public struct PngImage: Equatable, Sendable {
    public let width: Int
    public let height: Int
    /// `width * height` pixels, row by row, as 0xAARRGGBB with straight (not premultiplied) alpha.
    public let argb: [UInt32]
}

public enum PngError: Error, Equatable, CustomStringConvertible {
    case notPng
    case invalid(String)
    case unsupported(String)
    case tooLarge

    public var description: String {
        switch self {
        case .notPng: return "not a PNG file"
        case .invalid(let m): return "invalid PNG: \(m)"
        case .unsupported(let m): return "unsupported PNG: \(m)"
        case .tooLarge: return "the PNG is larger than the limit"
        }
    }
}

public enum PngDecoder {
    /// The most pixels accepted (a 64 MP picture is far beyond anything a watch screen takes).
    public static let maxPixels = 64_000_000

    private static let signature: Bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

    /// Reads the size from the header without decoding the pixels.
    public static func size(of data: Bytes) throws -> (width: Int, height: Int) {
        guard data.count >= 33, Array(data[0..<8]) == signature else { throw PngError.notPng }
        guard data[12..<16].elementsEqual("IHDR".utf8) else { throw PngError.invalid("the first chunk is not IHDR") }
        return (Int(data.u32be(16)), Int(data.u32be(20)))
    }

    public static func decode(_ data: Bytes) throws -> PngImage {
        guard data.count >= 8, Array(data[0..<8]) == signature else { throw PngError.notPng }
        var pos = 8
        var header: (width: Int, height: Int, depth: Int, colorType: Int, interlace: Int)?
        var palette = [UInt32]()
        var transparency: Bytes?
        var idat = Bytes()
        var seenEnd = false
        while pos + 12 <= data.count && !seenEnd {
            let length = Int(data.u32be(pos))
            guard length <= data.count - pos - 12 else { throw PngError.invalid("a chunk runs past the end of the file") }
            let type = String(decoding: data[pos + 4..<pos + 8], as: UTF8.self)
            let body = data[pos + 8..<pos + 8 + length]
            let critical = data[pos + 4] & 0x20 == 0
            if critical && CRC32.checksum(data[pos + 4..<pos + 8 + length]) != data.u32be(pos + 8 + length) {
                throw PngError.invalid("the \(type) chunk fails its checksum")
            }
            switch type {
            case "IHDR":
                guard header == nil, length == 13 else { throw PngError.invalid("bad IHDR") }
                header = (Int(data.u32be(pos + 8)), Int(data.u32be(pos + 12)), Int(data[pos + 16]), Int(data[pos + 17]), Int(data[pos + 20]))
                guard data[pos + 18] == 0, data[pos + 19] == 0 else { throw PngError.unsupported("compression or filter method") }
            case "PLTE":
                guard length % 3 == 0, length <= 768 else { throw PngError.invalid("bad PLTE") }
                palette = stride(from: 0, to: length, by: 3).map { 0xFF00_0000 | UInt32(body[body.startIndex + $0]) << 16 | UInt32(body[body.startIndex + $0 + 1]) << 8 | UInt32(body[body.startIndex + $0 + 2]) }
            case "tRNS": transparency = Array(body)
            case "IDAT": idat += body
            case "IEND": seenEnd = true
            default: break
            }
            pos += 12 + length
        }
        guard let header else { throw PngError.invalid("no IHDR") }
        guard seenEnd || !idat.isEmpty else { throw PngError.invalid("no image data") }
        let (width, height, depth, colorType, interlace) = header
        guard width > 0, height > 0 else { throw PngError.invalid("empty image") }
        guard width.multipliedReportingOverflow(by: height).overflow == false, width * height <= maxPixels else { throw PngError.tooLarge }
        let channels: Int
        switch (colorType, depth) {
        case (0, 1), (0, 2), (0, 4), (0, 8), (0, 16): channels = 1
        case (2, 8), (2, 16): channels = 3
        case (3, 1), (3, 2), (3, 4), (3, 8): channels = 1
        case (4, 8), (4, 16): channels = 2
        case (6, 8), (6, 16): channels = 4
        default: throw PngError.invalid("colour type \(colorType) with bit depth \(depth)")
        }
        guard interlace == 0 || interlace == 1 else { throw PngError.unsupported("interlace method \(interlace)") }
        if colorType == 3 && palette.isEmpty { throw PngError.invalid("a palette image without PLTE") }

        // zlib: two header bytes, deflate, Adler-32.
        guard idat.count >= 6 else { throw PngError.invalid("the image data is too short") }
        guard idat[0] & 0x0F == 8, (Int(idat[0]) << 8 | Int(idat[1])) % 31 == 0, idat[1] & 0x20 == 0 else { throw PngError.invalid("bad zlib header") }
        let bitsPerPixel = channels * depth
        let rowBytes = { (w: Int) in (w * bitsPerPixel + 7) / 8 }
        let passes: [(x0: Int, y0: Int, dx: Int, dy: Int)] =
            interlace == 0 ? [(0, 0, 1, 1)] : [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]
        var expected = 0
        for p in passes {
            let w = (width - p.x0 + p.dx - 1) / p.dx
            let h = (height - p.y0 + p.dy - 1) / p.dy
            if w > 0 && h > 0 { expected += (1 + rowBytes(w)) * h }
        }
        let inflated: (data: Bytes, end: Int)
        do {
            inflated = try Inflate.inflate(idat, at: 2, limit: expected)
        } catch {
            throw PngError.invalid("the image data does not inflate: \(error)")
        }
        guard inflated.data.count == expected else { throw PngError.invalid("the image data is \(inflated.data.count) bytes, \(expected) expected") }
        guard inflated.end + 4 <= idat.count, adler32(inflated.data) == idat.u32be(inflated.end) else { throw PngError.invalid("the image data fails its checksum") }

        var pixels = [UInt32](repeating: 0, count: width * height)
        var offset = 0
        let bpp = max(1, bitsPerPixel / 8)
        for p in passes {
            let w = (width - p.x0 + p.dx - 1) / p.dx
            let h = (height - p.y0 + p.dy - 1) / p.dy
            if w <= 0 || h <= 0 { continue }
            let stride = rowBytes(w)
            var previous = Bytes(repeating: 0, count: stride)
            for row in 0..<h {
                let filter = inflated.data[offset]
                var line = Array(inflated.data[offset + 1..<offset + 1 + stride])
                offset += 1 + stride
                try unfilter(&line, previous, filter, bpp)
                for col in 0..<w {
                    pixels[(p.y0 + row * p.dy) * width + p.x0 + col * p.dx] = pixel(line, col, colorType, depth, palette, transparency)
                }
                previous = line
            }
        }
        return PngImage(width: width, height: height, argb: pixels)
    }

    private static func unfilter(_ line: inout Bytes, _ previous: Bytes, _ filter: UInt8, _ bpp: Int) throws {
        switch filter {
        case 0: break
        case 1:
            for i in bpp..<max(bpp, line.count) { line[i] = line[i] &+ line[i - bpp] }
        case 2:
            for i in 0..<line.count { line[i] = line[i] &+ previous[i] }
        case 3:
            for i in 0..<line.count {
                let left = i >= bpp ? Int(line[i - bpp]) : 0
                line[i] = line[i] &+ UInt8((left + Int(previous[i])) / 2)
            }
        case 4:
            for i in 0..<line.count {
                let a = i >= bpp ? Int(line[i - bpp]) : 0
                let b = Int(previous[i])
                let c = i >= bpp ? Int(previous[i - bpp]) : 0
                let p = a + b - c
                let pa = abs(p - a), pb = abs(p - b), pc = abs(p - c)
                let predictor = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c)
                line[i] = line[i] &+ UInt8(predictor)
            }
        default: throw PngError.invalid("filter type \(filter)")
        }
    }

    /// The sample `index` (in samples, not bytes) of an unfiltered row: depths below 8 are packed MSB first, 16 keeps the high byte unless
    /// `full` asks for the whole value (the tRNS comparison).
    private static func sample(_ line: Bytes, _ index: Int, _ depth: Int, full: Bool = false) -> Int {
        switch depth {
        case 8: return Int(line[index])
        case 16: return full ? Int(line[index * 2]) << 8 | Int(line[index * 2 + 1]) : Int(line[index * 2])
        default:
            let bit = index * depth
            let shift = 8 - depth - (bit % 8)
            return Int(line[bit / 8] >> UInt8(shift)) & ((1 << depth) - 1)
        }
    }

    private static func pixel(_ line: Bytes, _ x: Int, _ colorType: Int, _ depth: Int, _ palette: [UInt32], _ trns: Bytes?) -> UInt32 {
        func argb(_ a: Int, _ r: Int, _ g: Int, _ b: Int) -> UInt32 { UInt32(a) << 24 | UInt32(r) << 16 | UInt32(g) << 8 | UInt32(b) }
        func scaled(_ v: Int) -> Int { depth >= 8 ? v : v * 255 / ((1 << depth) - 1) }
        func trnsValue(_ i: Int) -> Int? { trns.flatMap { $0.count >= i * 2 + 2 ? Int($0[i * 2]) << 8 | Int($0[i * 2 + 1]) : nil } }
        switch colorType {
        case 0:
            let raw = sample(line, x, depth, full: true)
            let v = scaled(depth == 16 ? raw >> 8 : raw)
            let transparent = trnsValue(0).map { $0 == raw } ?? false
            return argb(transparent ? 0 : 255, v, v, v)
        case 2:
            let r = sample(line, x * 3, depth, full: true)
            let g = sample(line, x * 3 + 1, depth, full: true)
            let b = sample(line, x * 3 + 2, depth, full: true)
            let transparent = trns != nil && trnsValue(0) == r && trnsValue(1) == g && trnsValue(2) == b
            let shift = depth == 16 ? 8 : 0
            return argb(transparent ? 0 : 255, r >> shift, g >> shift, b >> shift)
        case 3:
            let index = sample(line, x, depth)
            let entry = index < palette.count ? palette[index] : 0xFF00_0000
            guard let trns, index < trns.count else { return entry }
            return entry & 0x00FF_FFFF | UInt32(trns[index]) << 24
        case 4:
            let v = sample(line, x * 2, depth)
            return argb(sample(line, x * 2 + 1, depth), v, v, v)
        default:
            return argb(sample(line, x * 4 + 3, depth), sample(line, x * 4, depth), sample(line, x * 4 + 1, depth), sample(line, x * 4 + 2, depth))
        }
    }

    static func adler32(_ data: Bytes) -> UInt32 {
        var a: UInt32 = 1
        var b: UInt32 = 0
        for byte in data {
            a = (a + UInt32(byte)) % 65_521
            b = (b + a) % 65_521
        }
        return b << 16 | a
    }
}

// Port of HuaweiGpsParser.java (Gadgetbridge, AGPL-3.0-or-later): the `<n>_gps.bin` file of a workout. Little-endian; 0x20 bytes of trim,
// a type byte, the start values, then one record per fix. Quirks kept: the loop stops while MORE than one record's bytes remain (a final
// record that leaves no bytes after it is dropped), the unknown fields are skipped, and the latitude/longitude conversion is GB's.
import Foundation

public struct GpsPoint: Equatable, Sendable {
    public var timestamp: Int32 = 0
    public var latitude: Double = 0
    public var longitude: Double = 0
    public var pause = false
    public var altitudeSupported = false
    public var altitude: Double = 0
}

public enum HuaweiGpsParser {
    /// A short little-endian `ByteBuffer`; reading past the end or positioning beyond the end throws like Java.
    private struct Buffer {
        let array: Bytes
        var position = 0

        init(_ array: Bytes) { self.array = array }

        var remaining: Int { array.count - position }

        mutating func seek(_ newPosition: Int) throws {
            if newPosition > array.count || newPosition < 0 {
                throw SleepFilesParseError.illegalArgument("IllegalArgumentException: newPosition \(newPosition) > limit \(array.count)")
            }
            position = newPosition
        }

        private func need(_ n: Int) throws {
            if remaining < n { throw SleepFilesParseError.bufferUnderflow("need \(n) bytes at position \(position), limit \(array.count)") }
        }

        private mutating func raw(_ n: Int) throws -> UInt64 {
            try need(n)
            var v: UInt64 = 0
            for i in 0..<n { v |= UInt64(array[position + i]) << UInt64(8 * i) }
            position += n
            return v
        }

        mutating func byte() throws -> Int8 { Int8(truncatingIfNeeded: try raw(1)) }
        mutating func short() throws -> Int16 { Int16(truncatingIfNeeded: try raw(2)) }
        mutating func int() throws -> Int32 { Int32(truncatingIfNeeded: try raw(4)) }
        mutating func float() throws -> Float { Float(bitPattern: UInt32(truncatingIfNeeded: try raw(4))) }
        mutating func double() throws -> Double { Double(bitPattern: try raw(8)) }
    }

    /// `parseHuaweiGps`. Throws `SleepFilesParseError` where Java throws (BufferUnderflowException, IllegalArgumentException).
    public static func parse(_ data: Bytes) throws -> [GpsPoint] {
        var buffer = Buffer(data)

        // Skip trim
        try buffer.seek(0x20)

        let fileType = try buffer.byte()
        let altSupport = (fileType & 0x03) == 0x03
        let timestamp: Int32
        var lonStart: Double
        var latStart: Double
        if !altSupport {
            timestamp = try buffer.int()
            lonStart = try buffer.double()
            latStart = try buffer.double()
            try buffer.seek(62) // Skip past unknown fields/padding
        } else {
            timestamp = try buffer.int()
            lonStart = try buffer.double()
            latStart = try buffer.double()
            _ = try buffer.double() // the start altitude; Java reads it and never uses it
            try buffer.seek(70)
        }

        latStart = latStart * 0.017453292519943
        lonStart = lonStart * 0.017453292519943

        var time = timestamp
        var lat = latStart
        var lon = lonStart

        var dataSize = 15
        if altSupport { dataSize += 4 }

        var points = [GpsPoint]()
        points.reserveCapacity(max(buffer.remaining / dataSize, 0))
        while buffer.remaining > dataSize {
            let timeDelta = try buffer.short()
            _ = try buffer.short() // possible "bearing"
            let lonDelta = try buffer.float()
            let latDelta = try buffer.float()
            _ = try buffer.byte() // possible "accuracy"
            _ = try buffer.byte() // possible "velocity"
            let pause = try buffer.byte()

            time = time &+ Int32(timeDelta)
            lat = lat + Double(latDelta)
            lon = lon + Double(lonDelta)

            var point = GpsPoint()
            point.timestamp = time
            // GB: 6378245.0 (Krassovsky 1940 ellipsoid) instead of 6383807.0; "provides better result".
            point.latitude = (lat / 6378245.0 + latStart) / 0.017453292519943
            point.longitude = (lon / 6378245.0 / cos(latStart) + lonStart) / 0.017453292519943
            point.pause = pause == 1
            point.altitudeSupported = altSupport
            if altSupport {
                let alt = try buffer.short()
                _ = try buffer.short() // related to altitude
                point.altitude = Double(alt)
            }
            points.append(point)
        }
        return points
    }
}

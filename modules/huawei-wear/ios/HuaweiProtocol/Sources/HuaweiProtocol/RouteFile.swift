// Port of RouteFile.kt, itself a port of Gadgetbridge's HuaweiConvertTrack.java / HuaweiRouteTrack.java (AGPL-3.0-or-later; see NOTICE): the file Huawei
// Health sends as business type 6 of the P2P module `fitness` when it puts a route on the watch ("Send to wearable"). The arithmetic is kept exactly as
// Java has it, because the golden vectors (Fixtures/route.json, written from the Java) must agree to the byte: Float slope and intercept, truncating
// saturating `(int)` casts (`javaInt`), `Math.round` (`javaRound`, then the wrapping `Long.toInt()`), Int32 wrapping arithmetic.
import Foundation

/// One fix of a route: degrees, degrees, metres (0 when `RouteTrack.hasAltitude` is false).
public struct RouteFix: Equatable, Sendable {
    public let lat: Double
    public let lon: Double
    public let alt: Double

    public init(lat: Double, lon: Double, alt: Double) {
        self.lat = lat
        self.lon = lon
        self.alt = alt
    }
}

/// `HuaweiRouteTrack`. `id` is 36 characters in Huawei Health (a UUID); the watch lists the route by `name`.
public struct RouteTrack: Equatable, Sendable {
    public let id: String
    public let name: String
    public let fixes: [RouteFix]
    public let hasAltitude: Bool
    public let totalTimeSec: Int64
    /// 2 is the layout with altitude profile (watch sets ExpandCapability 216), 1 the plain line.
    public let version: Int

    public init(id: String, name: String, fixes: [RouteFix], hasAltitude: Bool, totalTimeSec: Int64, version: Int = 2) {
        self.id = id
        self.name = name
        self.fixes = fixes
        self.hasAltitude = hasAltitude
        self.totalTimeSec = totalTimeSec
        self.version = version
    }
}

public enum RouteFile {
    public static let businessRouteHandshake = 5
    public static let businessRouteFile = 6

    /// The route's name field in the version-2 header is 128 bytes; the watch's own limit is not known (it answers code 5 when a name is too long).
    public static let maxNameBytes = 100
    public static let maxIdBytes = 36

    /// Huawei Health asks the converter for `max(watch's point limit, 200)` points.
    public static let minPointLimit = 200

    public static let fileName = "byte.bin"

    private static let degreesToRadians = Double.pi / 180.0
    private static let deg90Radian = Double.pi / 2.0
    private static let metersPerDegree = 1111949.375
    private static let earthRadiusMeters = 6371393.0
    private static let coordinateTolerance: Float = 0.0001
    private static let pointIndexThreshold: Int32 = 30
    private static let pointDistanceThreshold: Int32 = 50
    private static let distanceThreshold: Int32 = 200
    private static let v2HeaderBytes = 0x108
    private static let v2PointBytes = 0x38
    private static let v2ProfileBytes = 3384
    private static let v1HeaderBytes = 0xc
    private static let v1PointBytes = 0x28
    private static let profilePoints = 83

    /// Validates what JS sends; the exception message is shown to the user (Indonesian copy is the app's job, these are the protocol limits).
    public static func validate(_ track: RouteTrack) throws {
        func bad(_ what: String) -> WearError { WearError(.invalidArgument, what) }
        if track.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw bad("Give the route a name") }
        if track.name.utf8.count > maxNameBytes { throw bad("The route name is too long") }
        if track.id.utf8.count > maxIdBytes { throw bad("The route id is too long") }
        if track.fixes.count < 2 { throw bad("A route needs at least 2 points") }
        if track.fixes.count > 20_000 { throw bad("A route has at most 20000 points") }
        for fix in track.fixes {
            if !(fix.lat.isFinite && fix.lon.isFinite && fix.alt.isFinite) { throw bad("A route point is not a number") }
            if isLatLonNotValid(fix.lat, fix.lon) { throw bad("A route point is outside the map") }
        }
        if track.fixes[0].lat == 0.0 { throw bad("The first point of a route cannot be at latitude 0") }
        if track.version != 1 && track.version != 2 { throw bad("Unknown route file version") }
        if track.version == 1 && track.hasAltitude { throw bad("The plain route file has no altitude") }
    }

    private static func isLatLonNotValid(_ lat: Double, _ lon: Double) -> Bool { lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0 }

    /// The 36-byte P2P header (businessType, version 1, totalLength, businessHeadLength 0, messageId; little endian) followed by `payload`.
    public static func message(businessType: Int, messageId: Int, payload: Bytes) -> Bytes {
        CourseProtobuf.message(businessType: businessType, messageId: messageId, payload: payload)
    }

    /// Handshake body: TLV tag 5 = the route's name (GB `HuaweiTLV.put(5, name)`; the length is Huawei's big-endian base-128 varint, `81 48` for 200).
    public static func handshakeBody(name: String) -> Bytes {
        var tlv = HuaweiTLV()
        tlv.put(5, string: name)
        return tlv.serialize()
    }

    /// The watch's answer to the handshake or to the file: `int32 LE` code, then (handshake only) `int32 LE` point limit.
    public struct Answer: Equatable, Sendable {
        public let code: Int
        public let maxPoints: Int?

        public init(code: Int, maxPoints: Int?) {
            self.code = code
            self.maxPoints = maxPoints
        }
    }

    /// Nil for a body shorter than 4 bytes.
    public static func parseAnswer(_ body: Bytes) -> Answer? {
        if body.count < 4 { return nil }
        func int32(_ at: Int) -> Int {
            let raw = UInt32(body[at]) | UInt32(body[at + 1]) << 8 | UInt32(body[at + 2]) << 16 | UInt32(body[at + 3]) << 24
            return Int(Int32(bitPattern: raw))
        }
        return Answer(code: int32(0), maxPoints: body.count >= 8 ? int32(4) : nil)
    }

    public static func pointLimit(_ answer: Answer?) -> Int { max(answer?.maxPoints ?? 0, minPointLimit) }

    /// `HuaweiConvertTrack.convertTrackToBin`: the route file body for at most `maxPoints` simplified points; empty when the route cannot be converted.
    public static func convert(_ track: RouteTrack, maxPoints: Int) -> Bytes { Converter(maxPoints: maxPoints).convert(track) }

    /// How many points a converted file holds (`savePoints` in the header: version 2 at offset 16, version 1 at offset 8).
    public static func pointCount(file: Bytes, version: Int) -> Int {
        let offset = version == 1 ? 8 : 16
        if file.count < offset + 4 { return 0 }
        let raw = UInt32(file[offset]) | UInt32(file[offset + 1]) << 8 | UInt32(file[offset + 2]) << 16 | UInt32(file[offset + 3]) << 24
        return Int(Int32(bitPattern: raw))
    }

    // MARK: Java numeric semantics

    /// Java `(int) double`: truncates toward zero, saturates, NaN is 0.
    private static func javaInt(_ x: Double) -> Int32 {
        if x.isNaN { return 0 }
        if x >= 2147483647.0 { return Int32.max }
        if x <= -2147483648.0 { return Int32.min }
        return Int32(x)
    }

    /// Java `Math.round(double)`: floor(x + 1/2) computed exactly, saturating to `long`, NaN is 0.
    private static func javaRound(_ x: Double) -> Int64 {
        if x.isNaN { return 0 }
        if x >= 9.223372036854775807e18 { return Int64.max }
        if x <= -9.223372036854775808e18 { return Int64.min }
        let f = x.rounded(.down)
        let r = (x - f >= 0.5) ? f + 1 : f
        if r >= 9.223372036854775807e18 { return Int64.max }
        return Int64(r)
    }

    /// Kotlin `Math.round(x).toInt()`: the low 32 bits of the rounded long.
    private static func roundInt(_ x: Double) -> Int32 { Int32(truncatingIfNeeded: javaRound(x)) }

    /// Kotlin `min(a, b)` for doubles: NaN wins.
    private static func javaMin(_ a: Double, _ b: Double) -> Double {
        if a.isNaN || b.isNaN { return .nan }
        return a < b ? a : b
    }

    // MARK: converter

    private struct Pt {
        var lon = 0.0
        var lat = 0.0
        var dx: Int32 = 0
        var dy: Int32 = 0
        var index: Int32 = 0
        var distance: Int32 = 0
        var type: Int32 = 0
    }

    /// `HuaweiConvertTrack`: one instance per conversion (it carries the simplification state).
    private final class Converter {
        let maxPoints: Int
        var simplified = [Pt]()
        var base = Pt()
        var current = Pt()
        var previous = Pt()
        var ref = Pt()
        var intermediate = Pt()
        var maxDeviationFromLine: Int32 = 0
        var slope: Float = 0
        var intercept: Float = 0
        var accumulatedSegmentDistance: Int32 = 0
        var total3d = 0.0
        var totalDistance = 0.0
        var alt = [Double]()
        var cumulative = [Double]()
        var cumulative3d = [Double]()
        var ascent = [Double]()
        var descent = [Double]()
        var profile: Bytes?

        init(maxPoints: Int) { self.maxPoints = maxPoints }

        func calculateLineEquation(_ p1: Pt, _ p2: Pt) {
            let deltaX = p1.dx &- p2.dx
            // Kotlin `abs(Int.MIN_VALUE)` stays negative, so it is also `< 1`.
            if deltaX == Int32.min || (deltaX > -1 && deltaX < 1) {
                slope = Float(tan(RouteFile.deg90Radian))
            } else {
                slope = Float(p1.dy &- p2.dy) / Float(deltaX)
            }
            intercept = Float(p1.dy) - slope * Float(p1.dx)
        }

        func distance(_ x1: Int32, _ y1: Int32, _ x2: Int32, _ y2: Int32) -> Double {
            let dx = Double(x1 &- x2)
            let dy = Double(y1 &- y2)
            return (dx * dx + dy * dy).squareRoot()
        }

        func between(_ p1: Pt, _ p2: Pt) -> Int32 { RouteFile.javaInt(distance(p1.dx, p1.dy, p2.dx, p2.dy)) }

        /// Java `float` arithmetic throughout: `-slope * dx + dy - intercept` is a float expression.
        func distanceFromLine(_ p: Pt) -> Int64 {
            let numerator: Float = abs(-slope * Float(p.dx) + Float(p.dy) - intercept)
            let denominator = (Double(slope * slope) + 1.0).squareRoot()
            return RouteFile.javaRound(Double(numerator) / denominator)
        }

        func addAndSimplify(_ point: Pt, _ type: Int32) {
            var toAdd = point
            toAdd.type = type
            simplified.append(toAdd)
            let size = simplified.count
            if size > maxPoints && size > 3 {
                var selected = -1
                var minDistance = Int32.max
                if size - 2 > 1 {
                    for i in 1..<(size - 2) {
                        let d = between(simplified[i], simplified[i + 1])
                        if d < minDistance {
                            selected = i
                            minDistance = d
                        }
                    }
                }
                if selected > -1 && selected < size - 1 {
                    let p1 = simplified[selected]
                    let p2 = simplified[selected + 1]
                    var merged = p1
                    let mergedType = p1.type == 1 ? p1.type : p2.type
                    merged.lon = (p1.lon + p2.lon) / 2
                    merged.lat = (p1.lat + p2.lat) / 2
                    merged.dx = (p2.dx &+ p1.dx) / 2
                    merged.dy = (p2.dy &+ p1.dy) / 2
                    merged.index = (p1.index &+ p2.index) / 2
                    merged.distance = (p1.distance &+ p2.distance) / 2
                    merged.type = mergedType
                    simplified[selected] = merged
                    simplified.remove(at: selected + 1)
                }
            }
        }

        func processSegment() {
            if current.index &- previous.index > RouteFile.pointIndexThreshold && between(previous, current) > RouteFile.pointDistanceThreshold {
                if between(intermediate, previous) > RouteFile.distanceThreshold {
                    if between(ref, intermediate) > RouteFile.distanceThreshold {
                        calculateLineEquation(ref, intermediate)
                        ref = intermediate
                        addAndSimplify(intermediate, 3)
                    }
                }
                calculateLineEquation(ref, previous)
                ref = previous
                addAndSimplify(ref, 8)
                calculateLineEquation(ref, current)
                ref = current
                addAndSimplify(ref, 9)
                intermediate = current
                maxDeviationFromLine = 0
                return
            }
            let distanceFromReference = between(current, ref)
            if maxDeviationFromLine &- distanceFromReference > RouteFile.distanceThreshold {
                calculateLineEquation(ref, intermediate)
                ref = intermediate
                addAndSimplify(intermediate, 4)
                calculateLineEquation(intermediate, current)
                maxDeviationFromLine = between(intermediate, current)
                intermediate = current
                return
            }
            if maxDeviationFromLine < distanceFromReference {
                intermediate = current
                maxDeviationFromLine = distanceFromReference
            }
            if distanceFromLine(current) <= Int64(RouteFile.pointDistanceThreshold) { return }
            if between(current, intermediate) > RouteFile.pointDistanceThreshold {
                calculateLineEquation(ref, intermediate)
                ref = intermediate
                addAndSimplify(intermediate, 3)
            }
            calculateLineEquation(ref, current)
            ref = current
            addAndSimplify(current, 2)
            intermediate = current
            maxDeviationFromLine = 0
        }

        func convert(_ track: RouteTrack) -> Bytes {
            let fixes = track.fixes
            let n = fixes.count
            if n < 2 { return [] }
            if track.version == 1 && track.hasAltitude { return [] }
            if fixes[0].lat == 0.0 { return [] }
            if RouteFile.isLatLonNotValid(fixes[0].lat, fixes[0].lon) { return [] }

            base.lon = fixes[0].lon
            base.lat = fixes[0].lat
            base.dx = 0
            base.dy = 0
            base.index = 0
            base.distance = 0
            previous = base
            current = base
            accumulatedSegmentDistance = 0
            var state = 1

            for i in 1..<n {
                let lat = fixes[i].lat
                let lon = fixes[i].lon
                if RouteFile.isLatLonNotValid(lat, lon) { continue }
                let lonDiff = abs(lon - previous.lon)
                if RouteFile.javaMin(lonDiff, 360.0 - lonDiff) > 10.0 { continue }

                previous = current
                let deltaLong = lon - base.lon
                let deltaLat = lat - base.lat
                current.lon = lon
                current.lat = lat
                current.dx = RouteFile.javaInt(deltaLong * RouteFile.metersPerDegree * FdLibm.cos(base.lat * RouteFile.degreesToRadians))
                current.dy = RouteFile.javaInt(deltaLat * RouteFile.metersPerDegree)
                current.index = Int32(truncatingIfNeeded: i)
                accumulatedSegmentDistance = accumulatedSegmentDistance &+ between(previous, current)
                current.distance = (accumulatedSegmentDistance &+ 5) / 10

                if state == 1 {
                    // `COORDINATE_TOLERANCE / Math.cos(...)` is float / double in Java: the float widens to double first.
                    if abs(base.lon - lon) <= Double(RouteFile.coordinateTolerance) / FdLibm.cos(lat * RouteFile.degreesToRadians) {
                        if abs(base.lat - lat) <= Double(RouteFile.coordinateTolerance) { continue }
                        slope = Float(tan(RouteFile.deg90Radian))
                    } else {
                        slope = Float((base.lat - lat) / (base.lon - lon))
                    }
                    addAndSimplify(base, 1)
                    intercept = 0
                    maxDeviationFromLine = 0
                    ref = base
                    intermediate = base
                    state = 2
                }
                processSegment()
            }

            if current.index != 0 {
                addAndSimplify(current, 4)
                if !simplified.isEmpty { simplified[simplified.count - 1].distance = current.distance }
            }

            alt = [Double](repeating: 0, count: n)
            cumulative = [Double](repeating: 0, count: n)
            cumulative3d = [Double](repeating: 0, count: n)
            ascent = [Double](repeating: 0, count: n)
            descent = [Double](repeating: 0, count: n)
            var lat = [Double](repeating: 0, count: n)
            var lon = [Double](repeating: 0, count: n)
            var prevLon = 0.0
            var prevLat = 0.0
            for i in 0..<n {
                lat[i] = fixes[i].lat
                lon[i] = fixes[i].lon
                alt[i] = fixes[i].alt
                if i > 0 { cumulative[i] = cumulative[i - 1] + haversine(prevLat, prevLon, lat[i], lon[i]) }
                prevLon = lon[i]
                prevLat = lat[i]
            }
            totalDistance = cumulative[n - 1]
            total3d = totalDistance

            if track.version != 1 && track.hasAltitude {
                for i in 1..<n {
                    let dist = cumulative[i] - cumulative[i - 1]
                    let deltaAlt = alt[i] - alt[i - 1]
                    cumulative3d[i] = cumulative3d[i - 1] + (dist * dist + deltaAlt * deltaAlt).squareRoot()
                    if deltaAlt <= 0.0 {
                        descent[i] = descent[i - 1] + deltaAlt
                    } else {
                        ascent[i] = ascent[i - 1] + deltaAlt
                    }
                }
                total3d = cumulative3d[n - 1]
                profile = elevationProfile(lat: lat, lon: lon)
            }
            return serialize(track)
        }

        /// The 83-point altitude profile after the points of a version-2 file.
        func elevationProfile(lat: [Double], lon: [Double]) -> Bytes {
            let n = lat.count
            let totalAscent = ascent[n - 1]
            let totalDescent = descent[n - 1]
            var buf = Bytes()
            buf.reserveCapacity(RouteFile.v2ProfileBytes)
            buf.putInt(0)
            buf.putInt(RouteFile.javaInt(totalDistance * 10.0))
            buf.putInt(RouteFile.javaInt(total3d * 10.0))
            buf.putInt(RouteFile.javaInt(totalAscent * 10.0))
            buf.putInt(RouteFile.javaInt(totalDescent * -10.0))
            buf.putInt(0)

            buf.putInt(RouteFile.roundInt(alt[0] * 10.0))
            buf.putInt(0)
            buf.putDouble(lon[0])
            buf.putDouble(lat[0])
            buf.putInt(RouteFile.javaInt(cumulative[0] * 10.0))
            buf.putInt(RouteFile.javaInt(cumulative3d[0] * 10.0))
            buf.putInt(RouteFile.javaInt(ascent[0] * 10.0))
            buf.putInt(RouteFile.javaInt(descent[0] * -10.0))

            var currentElevation = RouteFile.roundInt(alt[0] * 10.0)
            var currentDistance = cumulative[0]
            let segmentIncrement = (totalDistance / Double(RouteFile.profilePoints)) / 10.0
            var currentPoint = 1
            var currentLat = lat[0]
            var currentLon = lon[0]
            var currentDist = RouteFile.javaInt(cumulative[0] * 10.0)
            var currentDist3d = RouteFile.javaInt(cumulative3d[0] * 10.0)
            var currentAsc = RouteFile.javaInt(ascent[0] * 10.0)
            var currentDesc = RouteFile.javaInt(descent[0] * -10.0)

            for i in 1..<RouteFile.profilePoints {
                let targetDistance = (totalDistance / Double(RouteFile.profilePoints)) * Double(i)
                var closestIdx = currentPoint
                var nextIdx = n - 1
                if currentPoint < n {
                    var minDiff = Double.greatestFiniteMagnitude
                    for searchIdx in currentPoint..<n {
                        let searchDist = cumulative[searchIdx]
                        let diff = abs(searchDist - targetDistance)
                        if diff < minDiff {
                            closestIdx = searchIdx
                            minDiff = diff
                        }
                        if searchDist > targetDistance {
                            nextIdx = searchIdx
                            break
                        }
                    }
                    currentDistance = cumulative[closestIdx]
                }

                if targetDistance - segmentIncrement > currentDistance || segmentIncrement + targetDistance < currentDistance {
                    let distDiff = cumulative[nextIdx] * 10.0 - Double(currentDist)
                    let ratio = (targetDistance * 10.0 - Double(currentDist)) / distDiff
                    currentLat += (lat[nextIdx] - currentLat) * ratio
                    currentLon += (lon[nextIdx] - currentLon) * ratio
                    currentElevation = currentElevation &+ RouteFile.javaInt((alt[nextIdx] * 10.0 - Double(currentElevation)) * ratio)
                    currentDist = currentDist &+ RouteFile.javaInt(distDiff * ratio)
                    currentDist3d = currentDist3d &+ RouteFile.javaInt(ratio * (cumulative3d[nextIdx] * 10.0 - Double(currentDist3d)))
                    currentAsc = currentAsc &+ RouteFile.javaInt(ratio * (ascent[nextIdx] * 10.0 - Double(currentAsc)))
                    currentDesc = currentDesc &+ RouteFile.javaInt(ratio * (descent[nextIdx] * -10.0 - Double(currentDesc)))
                } else {
                    currentLat = lat[closestIdx]
                    currentLon = lon[closestIdx]
                    currentPoint = closestIdx + 1
                    currentElevation = RouteFile.roundInt(alt[closestIdx] * 10.0)
                    currentDist = RouteFile.javaInt(cumulative[closestIdx] * 10.0)
                    currentDist3d = RouteFile.javaInt(cumulative3d[closestIdx] * 10.0)
                    currentAsc = RouteFile.javaInt(ascent[closestIdx] * 10.0)
                    currentDesc = RouteFile.javaInt(descent[closestIdx] * -10.0)
                }

                buf.putInt(currentElevation)
                buf.putInt(0)
                buf.putDouble(currentLon)
                buf.putDouble(currentLat)
                buf.putInt(currentDist)
                buf.putInt(currentDist3d)
                buf.putInt(currentAsc)
                buf.putInt(currentDesc)
                currentDistance = cumulative[closestIdx]
            }

            buf.putInt(RouteFile.roundInt(alt[n - 1] * 10.0))
            buf.putInt(0)
            buf.putDouble(lon[n - 1])
            buf.putDouble(lat[n - 1])
            buf.putInt(RouteFile.javaInt(totalDistance * 10.0))
            buf.putInt(RouteFile.javaInt(total3d * 10.0))
            buf.putInt(RouteFile.javaInt(totalAscent * 10.0))
            buf.putInt(RouteFile.javaInt(totalDescent * -10.0))
            return buf
        }

        func serialize(_ track: RouteTrack) -> Bytes {
            if track.version != 1 {
                let saved = min(maxPoints, simplified.count)
                var header = Bytes()
                header.reserveCapacity(RouteFile.v2HeaderBytes)
                header.putInt(-1)
                header.putInt(Int32(track.version))
                header.putInt(Int32(truncatingIfNeeded: track.totalTimeSec))
                header.putFloat(Float(totalDistance))
                header.putInt(Int32(truncatingIfNeeded: saved))
                header.putPadded(Array(track.id.utf8), count: 0x24)
                header.putPadded(Array(track.name.utf8), count: 0x80)
                header.putFloat(Float(total3d))
                header.putInt(track.hasAltitude ? 1 : 0)
                header.putInt(0)
                header.putInt(0)
                header.append(0)
                header.append(0)
                header.putShort(0)
                // ByteBuffer.allocate(0x108) is zero filled past the last put.
                if header.count < RouteFile.v2HeaderBytes { header += Bytes(repeating: 0, count: RouteFile.v2HeaderBytes - header.count) }

                var size = saved * RouteFile.v2PointBytes + RouteFile.v2HeaderBytes
                if track.hasAltitude { size += 0xd38 }
                var out = Bytes()
                out.reserveCapacity(size)
                out += header
                for i in 0..<saved {
                    let pt = simplified[i]
                    let index = Int(pt.index)
                    out.putDouble(pt.lon)
                    out.putDouble(pt.lat)
                    out.putInt(pt.dx)
                    out.putInt(pt.dy)
                    out.putInt(pt.index)
                    out.putInt(RouteFile.roundInt(cumulative[index]))
                    out.putShort(0)
                    out.append(UInt8(truncatingIfNeeded: pt.type))
                    out.append(0)
                    out.putInt(RouteFile.roundInt(alt[index]))
                    out.putInt(RouteFile.roundInt(cumulative3d[index]))
                    out.putInt(RouteFile.roundInt(ascent[index]))
                    out.putInt(RouteFile.roundInt(abs(descent[index])))
                    out.putInt(0)
                }
                if track.hasAltitude, let altitudeBlock = profile { out += altitudeBlock }
                if out.count < size { out += Bytes(repeating: 0, count: size - out.count) }
                return out
            }

            let saved = simplified.count
            var out = Bytes()
            out.reserveCapacity(saved * RouteFile.v1PointBytes + RouteFile.v1HeaderBytes)
            out.putInt(Int32(truncatingIfNeeded: track.totalTimeSec))
            out.putFloat(Float(totalDistance))
            out.putInt(Int32(truncatingIfNeeded: saved))
            for pt in simplified {
                out.putDouble(pt.lon)
                out.putDouble(pt.lat)
                out.putInt(pt.dx)
                out.putInt(pt.dy)
                out.putInt(pt.index)
                out.putInt(pt.distance)
                out.putShort(0)
                out.append(UInt8(truncatingIfNeeded: pt.type))
                out.append(0)
                out.append(contentsOf: Bytes(repeating: 0, count: 4))
            }
            return out
        }

        func haversine(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
            let prevLatRad = lat1 * RouteFile.degreesToRadians
            let curLatRad = lat2 * RouteFile.degreesToRadians
            let deltaLatHalfSin = FdLibm.sin((prevLatRad - curLatRad) / 2)
            let deltaLonHalfSin = FdLibm.sin((lon1 * RouteFile.degreesToRadians - lon2 * RouteFile.degreesToRadians) / 2)
            let a = deltaLatHalfSin * deltaLatHalfSin + FdLibm.cos(prevLatRad) * FdLibm.cos(curLatRad) * deltaLonHalfSin * deltaLonHalfSin
            let centralAngle = 2 * FdLibm.atan2(a.squareRoot(), (1 - a).squareRoot())
            return centralAngle * RouteFile.earthRadiusMeters
        }
    }
}

/// Little-endian writers (`ByteBuffer.order(LITTLE_ENDIAN)`).
private extension Array where Element == UInt8 {
    mutating func putInt(_ v: Int32) {
        let u = UInt32(bitPattern: v)
        for s in stride(from: 0, to: 32, by: 8) { append(UInt8((u >> UInt32(s)) & 0xFF)) }
    }

    mutating func putShort(_ v: Int16) {
        let u = UInt16(bitPattern: v)
        append(UInt8(u & 0xFF))
        append(UInt8(u >> 8))
    }

    mutating func putFloat(_ v: Float) { putInt(Int32(bitPattern: v.bitPattern)) }

    mutating func putDouble(_ v: Double) {
        let u = v.bitPattern
        for s in stride(from: 0, to: 64, by: 8) { append(UInt8((u >> UInt64(s)) & 0xFF)) }
    }

    /// Kotlin `bytes.copyOf(count)`: truncated or zero padded.
    mutating func putPadded(_ bytes: Bytes, count: Int) {
        append(contentsOf: bytes.prefix(count))
        if bytes.count < count { append(contentsOf: Bytes(repeating: 0, count: count - bytes.count)) }
    }
}

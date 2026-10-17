// sin, cos and atan2 as Java computes them (`StrictMath`, the Sun fdlibm algorithms; `Math.sin/cos/atan2` give the same results on the vectors of
// `route.json`). glibc / Apple libm round differently in the last bit, which moves the route file's interpolated altitude profile by one ulp, so
// `RouteFile` cannot use Foundation's. Arguments are radians of a coordinate (|x| well under 2^19 * pi/2); a larger one falls back to Foundation.
import Foundation

enum FdLibm {
    private static func hi(_ x: Double) -> Int32 { Int32(bitPattern: UInt32(truncatingIfNeeded: x.bitPattern >> 32)) }
    private static func lo(_ x: Double) -> UInt32 { UInt32(truncatingIfNeeded: x.bitPattern) }
    private static func make(hi: Int32, lo: UInt32) -> Double { Double(bitPattern: UInt64(UInt32(bitPattern: hi)) << 32 | UInt64(lo)) }

    // MARK: kernels

    private static func kernelSin(_ x: Double, _ y: Double, _ iy: Int) -> Double {
        let s1 = -1.66666666666666324348e-01
        let s2 = 8.33333333332248946124e-03
        let s3 = -1.98412698298579493134e-04
        let s4 = 2.75573137070700676789e-06
        let s5 = -2.50507602534068634195e-08
        let s6 = 1.58969099521155010221e-10
        let ix = hi(x) & 0x7fff_ffff
        if ix < 0x3e40_0000 && Int32(x) == 0 { return x }
        let z = x * x
        let v = z * x
        let r = s2 + z * (s3 + z * (s4 + z * (s5 + z * s6)))
        if iy == 0 { return x + v * (s1 + z * r) }
        return x - ((z * (0.5 * y - v * r) - y) - v * s1)
    }

    private static func kernelCos(_ x: Double, _ y: Double) -> Double {
        let c1 = 4.16666666666666019037e-02
        let c2 = -1.38888888888741095749e-03
        let c3 = 2.48015872894767294178e-05
        let c4 = -2.75573143513906633035e-07
        let c5 = 2.08757232129817482790e-09
        let c6 = -1.13596475577881948265e-11
        let ix = hi(x) & 0x7fff_ffff
        if ix < 0x3e40_0000 && Int32(x) == 0 { return 1.0 }
        let z = x * x
        let r = z * (c1 + z * (c2 + z * (c3 + z * (c4 + z * (c5 + z * c6)))))
        if ix < 0x3FD3_3333 { return 1.0 - (0.5 * z - (z * r - x * y)) }
        let qx = ix > 0x3fe9_0000 ? 0.28125 : make(hi: ix - 0x0020_0000, lo: 0)
        let hz = 0.5 * z - qx
        let a = 1.0 - qx
        return a - (hz - (z * r - x * y))
    }

    // MARK: argument reduction (the |x| <= 2^19 * pi/2 branch of __ieee754_rem_pio2)

    /// `npio2_hw[k]`: the high word of `(k + 1) * pi/2`.
    private static let npio2Hw: [Int32] = (1...32).map { hi(Double($0) * (Double.pi / 2)) }

    private static func remPio2(_ x: Double) -> (n: Int, y0: Double, y1: Double)? {
        let invpio2 = 6.36619772367581382433e-01
        let pio2_1 = 1.57079632673412561417e+00
        let pio2_1t = 6.07710050650619224932e-11
        let pio2_2 = 6.07710050630396597660e-11
        let pio2_2t = 2.02226624879595063154e-21
        let pio2_3 = 2.02226624871116645580e-21
        let pio2_3t = 8.47842766036889956997e-32
        let hx = hi(x)
        let ix = hx & 0x7fff_ffff
        if ix <= 0x3fe9_21fb { return (0, x, 0) }
        if ix < 0x4002_d97c {
            if hx > 0 {
                var z = x - pio2_1
                if ix != 0x3ff9_21fb {
                    let y0 = z - pio2_1t
                    return (1, y0, (z - y0) - pio2_1t)
                }
                z -= pio2_2
                let y0 = z - pio2_2t
                return (1, y0, (z - y0) - pio2_2t)
            }
            var z = x + pio2_1
            if ix != 0x3ff9_21fb {
                let y0 = z + pio2_1t
                return (-1, y0, (z - y0) + pio2_1t)
            }
            z += pio2_2
            let y0 = z + pio2_2t
            return (-1, y0, (z - y0) + pio2_2t)
        }
        if ix <= 0x4139_21fb {
            var t = abs(x)
            let n = Int(Int32(t * invpio2 + 0.5))
            let fn = Double(n)
            var r = t - fn * pio2_1
            var w = fn * pio2_1t
            var y0: Double
            if n < 32 && ix != npio2Hw[n - 1] {
                y0 = r - w
            } else {
                let j = ix >> 20
                y0 = r - w
                var i = j - ((hi(y0) >> 20) & 0x7ff)
                if i > 16 {
                    t = r
                    w = fn * pio2_2
                    r = t - w
                    w = fn * pio2_2t - ((t - r) - w)
                    y0 = r - w
                    i = j - ((hi(y0) >> 20) & 0x7ff)
                    if i > 49 {
                        t = r
                        w = fn * pio2_3
                        r = t - w
                        w = fn * pio2_3t - ((t - r) - w)
                        y0 = r - w
                    }
                }
            }
            let y1 = (r - y0) - w
            if hx < 0 { return (-n, -y0, -y1) }
            return (n, y0, y1)
        }
        return nil
    }

    // MARK: sin, cos

    static func sin(_ x: Double) -> Double {
        let ix = hi(x) & 0x7fff_ffff
        if ix <= 0x3fe9_21fb { return kernelSin(x, 0, 0) }
        if ix >= 0x7ff0_0000 { return x - x }
        guard let (n, y0, y1) = remPio2(x) else { return Foundation.sin(x) }
        switch n & 3 {
        case 0: return kernelSin(y0, y1, 1)
        case 1: return kernelCos(y0, y1)
        case 2: return -kernelSin(y0, y1, 1)
        default: return -kernelCos(y0, y1)
        }
    }

    static func cos(_ x: Double) -> Double {
        let ix = hi(x) & 0x7fff_ffff
        if ix <= 0x3fe9_21fb { return kernelCos(x, 0) }
        if ix >= 0x7ff0_0000 { return x - x }
        guard let (n, y0, y1) = remPio2(x) else { return Foundation.cos(x) }
        switch n & 3 {
        case 0: return kernelCos(y0, y1)
        case 1: return -kernelSin(y0, y1, 1)
        case 2: return -kernelCos(y0, y1)
        default: return kernelSin(y0, y1, 1)
        }
    }

    // MARK: atan, atan2

    private static let atanhi = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00]
    private static let atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17]
    private static let aT = [
        3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
        9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
        4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02,
    ]

    private static func atan(_ input: Double) -> Double {
        var x = input
        let hx = hi(x)
        let ix = hx & 0x7fff_ffff
        if ix >= 0x4410_0000 {
            if ix > 0x7ff0_0000 || (ix == 0x7ff0_0000 && lo(x) != 0) { return x + x }
            return hx > 0 ? atanhi[3] + atanlo[3] : -atanhi[3] - atanlo[3]
        }
        var id: Int
        if ix < 0x3fdc_0000 {
            if ix < 0x3e20_0000 && 1.0e300 + x > 1.0 { return x }
            id = -1
        } else {
            x = abs(x)
            if ix < 0x3ff3_0000 {
                if ix < 0x3fe6_0000 {
                    id = 0
                    x = (2.0 * x - 1.0) / (2.0 + x)
                } else {
                    id = 1
                    x = (x - 1.0) / (x + 1.0)
                }
            } else if ix < 0x4003_8000 {
                id = 2
                x = (x - 1.5) / (1.0 + 1.5 * x)
            } else {
                id = 3
                x = -1.0 / x
            }
        }
        let z = x * x
        let w = z * z
        let s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))))
        let s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))))
        if id < 0 { return x - x * (s1 + s2) }
        let r = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x)
        return hx < 0 ? -r : r
    }

    static func atan2(_ y: Double, _ x: Double) -> Double {
        let tiny = 1.0e-300
        let piO4 = 7.8539816339744827900e-01
        let piO2 = 1.5707963267948965580e+00
        let pi = 3.1415926535897931160e+00
        let piLo = 1.2246467991473531772e-16
        let hx = hi(x)
        let ix = hx & 0x7fff_ffff
        let lx = lo(x)
        let hy = hi(y)
        let iy = hy & 0x7fff_ffff
        let ly = lo(y)
        if x.isNaN || y.isNaN { return x + y }
        if (hx &- 0x3ff0_0000) == 0 && lx == 0 { return atan(y) }
        let m = Int((hy >> 31) & 1) | Int((hx >> 30) & 2)
        if iy == 0 && ly == 0 {
            switch m {
            case 0, 1: return y
            case 2: return pi + tiny
            default: return -pi - tiny
            }
        }
        if ix == 0 && lx == 0 { return hy < 0 ? -piO2 - tiny : piO2 + tiny }
        if ix == 0x7ff0_0000 {
            if iy == 0x7ff0_0000 {
                switch m {
                case 0: return piO4 + tiny
                case 1: return -piO4 - tiny
                case 2: return 3.0 * piO4 + tiny
                default: return -3.0 * piO4 - tiny
                }
            }
            switch m {
            case 0: return 0.0
            case 1: return -0.0
            case 2: return pi + tiny
            default: return -pi - tiny
            }
        }
        if iy == 0x7ff0_0000 { return hy < 0 ? -piO2 - tiny : piO2 + tiny }
        let k = (iy &- ix) >> 20
        let z: Double
        if k > 60 {
            z = piO2 + 0.5 * piLo
        } else if hx < 0 && k < -60 {
            z = 0.0
        } else {
            z = atan(abs(y / x))
        }
        switch m {
        case 0: return z
        case 1: return -z
        case 2: return pi - (z - piLo)
        default: return (z - piLo) - pi
        }
    }
}

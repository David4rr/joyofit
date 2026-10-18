// The three pieces of Java number and text formatting the Android weather code depends on, reproduced exactly (Foundation's own would differ at
// ties): `String.format(Locale.US, "%.2f", x)`, `BigDecimal(x).setScale(7, HALF_UP).toDouble()` and `URLEncoder.encode(s, "UTF-8")`.
import Foundation

enum JavaNumbers {
    /// `String.format(Locale.US, "%.2f", value)`. Java rounds HALF_UP on the shortest decimal digits of the double (1.005 gives "1.01", where C's
    /// printf gives "1.00"), and keeps the sign of a value that rounds to zero ("-0.00").
    static func twoDecimals(_ value: Double) -> String {
        if value.isNaN { return "NaN" }
        if value.isInfinite { return value < 0 ? "-Infinity" : "Infinity" }
        let negative = value.sign == .minus
        let (digits, pointPos) = shortestDigits(abs(value))

        func digit(_ index: Int) -> UInt8 { index >= 0 && index < digits.count ? digits[index] : 0 }

        // Integer digits, then two fractional ones; the next digit decides the rounding (>= 5 rounds up).
        var scaled: [UInt8] = (0..<max(pointPos, 0)).map(digit)
        scaled.append(digit(pointPos))
        scaled.append(digit(pointPos + 1))
        if digit(pointPos + 2) >= 5 {
            var index = scaled.count - 1
            while index >= 0 {
                if scaled[index] == 9 {
                    scaled[index] = 0
                    index -= 1
                } else {
                    scaled[index] += 1
                    break
                }
            }
            if index < 0 { scaled.insert(1, at: 0) }
        }
        while scaled.count < 3 { scaled.insert(0, at: 0) }
        var text = scaled.map { String($0) }.joined()
        // Drop redundant leading zeros of the integer part, keeping one.
        while text.count > 3 && text.hasPrefix("0") { text.removeFirst() }
        text.insert(".", at: text.index(text.endIndex, offsetBy: -2))
        return (negative ? "-" : "") + text
    }

    /// The decimal digits of the shortest representation of a positive finite double (Swift prints the same shortest digits as Java for
    /// the doubles this code sees) and the position of the decimal point inside them: the value is `0.d0d1d2...` times ten to `pointPos`.
    private static func shortestDigits(_ value: Double) -> (digits: [UInt8], pointPos: Int) {
        if value == 0 { return ([0], 1) }
        let text = "\(value)"
        var mantissa = text
        var exponent = 0
        if let e = text.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mantissa = String(text[..<e])
            exponent = Int(text[text.index(after: e)...].replacingOccurrences(of: "+", with: "")) ?? 0
        }
        var integerLength = mantissa.count
        if let dot = mantissa.firstIndex(of: ".") { integerLength = mantissa.distance(from: mantissa.startIndex, to: dot) }
        var digits = mantissa.filter { $0 != "." }.compactMap { $0.wholeNumberValue }.map { UInt8($0) }
        var pointPos = integerLength + exponent
        // Leading zeros ("0.005") only move the point.
        while digits.count > 1, digits.first == 0 {
            digits.removeFirst()
            pointPos -= 1
        }
        return (digits, pointPos)
    }

    /// `BigDecimal(value).setScale(7, RoundingMode.HALF_UP).toDouble()`: the exact binary value rounded half away from zero to seven decimals,
    /// then the nearest double. A result of zero loses its sign (BigDecimal has no negative zero).
    static func roundedToSevenDecimals(_ value: Double) -> Double {
        guard value.isFinite else { return value }
        let bits = value.bitPattern
        let exponentBits = Int((bits >> 52) & 0x7FF)
        let fraction = bits & ((1 << 52) - 1)
        let mantissa = exponentBits == 0 ? fraction : fraction | (1 << 52)
        let exponent = exponentBits == 0 ? -1074 : exponentBits - 1075
        if mantissa == 0 { return 0 }
        if exponent >= 0 { return value } // an integer of 2^52 or more: already exact at seven decimals

        // magnitude * 10^7 = mantissa * 10^7 / 2^shift, kept in 128 bits.
        let shift = -exponent
        let product = mantissa.multipliedFullWidth(by: 10_000_000)
        var high = product.high
        var low = product.low
        if shift >= 78 { return 0 } // below one half of 1e-7 for sure (product < 2^77)
        // Add one half (2^(shift-1)), then shift right by `shift`.
        let half = shift - 1
        var addHigh: UInt64 = 0
        var addLow: UInt64 = 0
        if half < 64 { addLow = 1 << UInt64(half) } else { addHigh = 1 << UInt64(half - 64) }
        let (sumLow, carry) = low.addingReportingOverflow(addLow)
        low = sumLow
        high = high &+ addHigh &+ (carry ? 1 : 0)
        let scaled: UInt64
        if shift < 64 {
            scaled = (low >> UInt64(shift)) | (shift == 0 ? 0 : high << UInt64(64 - shift))
        } else {
            scaled = high >> UInt64(shift - 64)
        }
        if scaled == 0 { return 0 }
        let magnitude = Double(scaled) / 1e7
        return value < 0 ? -magnitude : magnitude
    }

    /// `URLEncoder.encode(text, "UTF-8")`: letters, digits and `. - * _` stay, a space is `+`, every other byte is `%XX` in upper case.
    static func urlEncode(_ text: String) -> String {
        var out = ""
        out.reserveCapacity(text.utf8.count)
        let hex = Array("0123456789ABCDEF")
        for byte in text.utf8 {
            switch byte {
            case UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "0")...UInt8(ascii: "9"),
                 UInt8(ascii: "."), UInt8(ascii: "-"), UInt8(ascii: "*"), UInt8(ascii: "_"):
                out.append(Character(UnicodeScalar(byte)))
            case UInt8(ascii: " "):
                out.append("+")
            default:
                out.append("%")
                out.append(hex[Int(byte >> 4)])
                out.append(hex[Int(byte & 0x0F)])
            }
        }
        return out
    }
}

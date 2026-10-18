// AES (FIPS 197) with CBC/PKCS#7 and GCM (NIST SP 800-38D, any IV length, 128-bit tag), matching what Gadgetbridge's
// CryptoUtils asks of Java's `AES/CBC/PKCS5Padding` and `AES/GCM/NoPadding`. Written out because CryptoKit/CommonCrypto are
// not on Linux and CryptoKit's GCM nonce handling is narrower than Java's (the watch sends 16-byte IVs).
import Foundation

public enum CryptoError: Error, Equatable {
    case invalidKeyLength(Int)
    case invalidIVLength(Int)
    case invalidDataLength(Int)
    case badPadding
    case authenticationFailed
    case emptyKey
    case missingKey
}

public struct AES {
    private static let sbox: [UInt8] = {
        // Generate the S-box from the multiplicative inverse in GF(2^8) plus the affine transform.
        var sbox = [UInt8](repeating: 0, count: 256)
        var p: UInt8 = 1
        var q: UInt8 = 1
        repeat {
            p = p ^ (p << 1) ^ ((p & 0x80) != 0 ? 0x1B : 0)
            q ^= q << 1
            q ^= q << 2
            q ^= q << 4
            if q & 0x80 != 0 { q ^= 0x09 }
            let x = q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4)
            sbox[Int(p)] = x ^ 0x63
        } while p != 1
        sbox[0] = 0x63
        return sbox
    }()

    private static let invSbox: [UInt8] = {
        var inv = [UInt8](repeating: 0, count: 256)
        for i in 0..<256 { inv[Int(sbox[i])] = UInt8(i) }
        return inv
    }()

    private static func rotl8(_ x: UInt8, _ n: UInt8) -> UInt8 { (x << n) | (x >> (8 - n)) }

    private static func xtime(_ x: UInt8) -> UInt8 { (x << 1) ^ ((x & 0x80) != 0 ? 0x1B : 0) }

    private static func mul(_ a: UInt8, _ b: UInt8) -> UInt8 {
        var a = a, b = b, r: UInt8 = 0
        while b != 0 {
            if b & 1 != 0 { r ^= a }
            a = xtime(a)
            b >>= 1
        }
        return r
    }

    private static let mul2: [UInt8] = (0..<256).map { xtime(UInt8($0)) }
    private static let mul3: [UInt8] = (0..<256).map { xtime(UInt8($0)) ^ UInt8($0) }
    private static let mul9: [UInt8] = (0..<256).map { mul(UInt8($0), 9) }
    private static let mul11: [UInt8] = (0..<256).map { mul(UInt8($0), 11) }
    private static let mul13: [UInt8] = (0..<256).map { mul(UInt8($0), 13) }
    private static let mul14: [UInt8] = (0..<256).map { mul(UInt8($0), 14) }

    private let roundKeys: [UInt8]
    private let rounds: Int

    public init(key: Bytes) throws {
        guard key.count == 16 || key.count == 24 || key.count == 32 else { throw CryptoError.invalidKeyLength(key.count) }
        let nk = key.count / 4
        rounds = nk + 6
        var w = key
        w.reserveCapacity(16 * (rounds + 1))
        var rcon: UInt8 = 1
        var i = nk
        while i < 4 * (rounds + 1) {
            var t = Array(w[(i - 1) * 4..<i * 4])
            if i % nk == 0 {
                t = [AES.sbox[Int(t[1])] ^ rcon, AES.sbox[Int(t[2])], AES.sbox[Int(t[3])], AES.sbox[Int(t[0])]]
                rcon = AES.xtime(rcon)
            } else if nk > 6 && i % nk == 4 {
                t = t.map { AES.sbox[Int($0)] }
            }
            let prev = Array(w[(i - nk) * 4..<(i - nk + 1) * 4])
            w += (0..<4).map { prev[$0] ^ t[$0] }
            i += 1
        }
        roundKeys = w
    }

    public func encryptBlock(_ input: Bytes) -> Bytes {
        var s = input
        addRoundKey(&s, 0)
        for round in 1..<rounds {
            subBytesShiftRows(&s)
            mixColumns(&s)
            addRoundKey(&s, round)
        }
        subBytesShiftRows(&s)
        addRoundKey(&s, rounds)
        return s
    }

    public func decryptBlock(_ input: Bytes) -> Bytes {
        var s = input
        addRoundKey(&s, rounds)
        for round in stride(from: rounds - 1, through: 1, by: -1) {
            invShiftRowsSubBytes(&s)
            addRoundKey(&s, round)
            invMixColumns(&s)
        }
        invShiftRowsSubBytes(&s)
        addRoundKey(&s, 0)
        return s
    }

    @inline(__always) private func addRoundKey(_ s: inout Bytes, _ round: Int) {
        let base = round * 16
        for i in 0..<16 { s[i] ^= roundKeys[base + i] }
    }

    // State is column-major: byte index = 4 * column + row.
    private func subBytesShiftRows(_ s: inout Bytes) {
        let t = s
        for c in 0..<4 {
            for r in 0..<4 {
                s[4 * c + r] = AES.sbox[Int(t[4 * ((c + r) % 4) + r])]
            }
        }
    }

    private func invShiftRowsSubBytes(_ s: inout Bytes) {
        let t = s
        for c in 0..<4 {
            for r in 0..<4 {
                s[4 * ((c + r) % 4) + r] = AES.invSbox[Int(t[4 * c + r])]
            }
        }
    }

    private func mixColumns(_ s: inout Bytes) {
        for c in 0..<4 {
            let a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]
            s[4 * c] = AES.mul2[Int(a0)] ^ AES.mul3[Int(a1)] ^ a2 ^ a3
            s[4 * c + 1] = a0 ^ AES.mul2[Int(a1)] ^ AES.mul3[Int(a2)] ^ a3
            s[4 * c + 2] = a0 ^ a1 ^ AES.mul2[Int(a2)] ^ AES.mul3[Int(a3)]
            s[4 * c + 3] = AES.mul3[Int(a0)] ^ a1 ^ a2 ^ AES.mul2[Int(a3)]
        }
    }

    private func invMixColumns(_ s: inout Bytes) {
        for c in 0..<4 {
            let a0 = Int(s[4 * c]), a1 = Int(s[4 * c + 1]), a2 = Int(s[4 * c + 2]), a3 = Int(s[4 * c + 3])
            s[4 * c] = AES.mul14[a0] ^ AES.mul11[a1] ^ AES.mul13[a2] ^ AES.mul9[a3]
            s[4 * c + 1] = AES.mul9[a0] ^ AES.mul14[a1] ^ AES.mul11[a2] ^ AES.mul13[a3]
            s[4 * c + 2] = AES.mul13[a0] ^ AES.mul9[a1] ^ AES.mul14[a2] ^ AES.mul11[a3]
            s[4 * c + 3] = AES.mul11[a0] ^ AES.mul13[a1] ^ AES.mul9[a2] ^ AES.mul14[a3]
        }
    }

    // MARK: CBC with PKCS#7 padding (Java's "PKCS5Padding" on 16-byte blocks)

    public static func encryptCBC(_ data: Bytes, key: Bytes, iv: Bytes) throws -> Bytes {
        guard iv.count == 16 else { throw CryptoError.invalidIVLength(iv.count) }
        let aes = try AES(key: key)
        let padLength = 16 - data.count % 16
        let padded = data + Bytes(repeating: UInt8(padLength), count: padLength)
        var out = Bytes()
        out.reserveCapacity(padded.count)
        var previous = iv
        var offset = 0
        while offset < padded.count {
            var block = Array(padded[offset..<offset + 16])
            for i in 0..<16 { block[i] ^= previous[i] }
            previous = aes.encryptBlock(block)
            out += previous
            offset += 16
        }
        return out
    }

    public static func decryptCBC(_ data: Bytes, key: Bytes, iv: Bytes) throws -> Bytes {
        guard iv.count == 16 else { throw CryptoError.invalidIVLength(iv.count) }
        guard !data.isEmpty, data.count % 16 == 0 else { throw CryptoError.invalidDataLength(data.count) }
        let aes = try AES(key: key)
        var out = Bytes()
        out.reserveCapacity(data.count)
        var previous = iv
        var offset = 0
        while offset < data.count {
            let block = Array(data[offset..<offset + 16])
            var plain = aes.decryptBlock(block)
            for i in 0..<16 { plain[i] ^= previous[i] }
            out += plain
            previous = block
            offset += 16
        }
        guard let pad = out.last, pad >= 1, pad <= 16, Int(pad) <= out.count,
              out.suffix(Int(pad)).allSatisfy({ $0 == pad })
        else { throw CryptoError.badPadding }
        out.removeLast(Int(pad))
        return out
    }

    // MARK: GCM (128-bit tag appended to the ciphertext, as Java does)

    public static func encryptGCM(_ data: Bytes, key: Bytes, iv: Bytes, aad: Bytes? = nil) throws -> Bytes {
        guard !iv.isEmpty else { throw CryptoError.invalidIVLength(0) }
        let aes = try AES(key: key)
        let h = aes.encryptBlock(Bytes(repeating: 0, count: 16))
        let j0 = gcmInitialCounter(aes: aes, h: h, iv: iv)
        let cipher = gcmCTR(aes: aes, counter: j0, data: data)
        let tag = gcmTag(aes: aes, h: h, j0: j0, aad: aad ?? [], cipher: cipher)
        return cipher + tag
    }

    public static func decryptGCM(_ data: Bytes, key: Bytes, iv: Bytes, aad: Bytes? = nil) throws -> Bytes {
        guard !iv.isEmpty else { throw CryptoError.invalidIVLength(0) }
        guard data.count >= 16 else { throw CryptoError.invalidDataLength(data.count) }
        let aes = try AES(key: key)
        let cipher = Array(data[0..<data.count - 16])
        let tag = Array(data[data.count - 16..<data.count])
        let h = aes.encryptBlock(Bytes(repeating: 0, count: 16))
        let j0 = gcmInitialCounter(aes: aes, h: h, iv: iv)
        let expected = gcmTag(aes: aes, h: h, j0: j0, aad: aad ?? [], cipher: cipher)
        var diff: UInt8 = 0
        for i in 0..<16 { diff |= tag[i] ^ expected[i] }
        guard diff == 0 else { throw CryptoError.authenticationFailed }
        return gcmCTR(aes: aes, counter: j0, data: cipher)
    }

    private static func gcmInitialCounter(aes: AES, h: Bytes, iv: Bytes) -> Bytes {
        if iv.count == 12 { return iv + [0, 0, 0, 1] }
        var input = iv
        while input.count % 16 != 0 { input.append(0) }
        input += Bytes(repeating: 0, count: 8)
        input.appendBE(UInt64(iv.count) * 8)
        return ghash(h: h, data: input)
    }

    private static func incrementCounter(_ counter: inout Bytes) {
        var i = 15
        while i >= 12 {
            counter[i] &+= 1
            if counter[i] != 0 { break }
            i -= 1
        }
    }

    private static func gcmCTR(aes: AES, counter j0: Bytes, data: Bytes) -> Bytes {
        var counter = j0
        var out = Bytes()
        out.reserveCapacity(data.count)
        var offset = 0
        while offset < data.count {
            incrementCounter(&counter)
            let stream = aes.encryptBlock(counter)
            let n = min(16, data.count - offset)
            for i in 0..<n { out.append(data[offset + i] ^ stream[i]) }
            offset += n
        }
        return out
    }

    private static func gcmTag(aes: AES, h: Bytes, j0: Bytes, aad: Bytes, cipher: Bytes) -> Bytes {
        var input = aad
        while input.count % 16 != 0 { input.append(0) }
        input += cipher
        while input.count % 16 != 0 { input.append(0) }
        input.appendBE(UInt64(aad.count) * 8)
        input.appendBE(UInt64(cipher.count) * 8)
        let s = ghash(h: h, data: input)
        let mask = aes.encryptBlock(j0)
        return (0..<16).map { s[$0] ^ mask[$0] }
    }

    /// GHASH over whole 16-byte blocks of `data` with the bitwise GF(2^128) multiply of the spec.
    private static func ghash(h: Bytes, data: Bytes) -> Bytes {
        let hHi = h.u64be(0), hLo = h.u64be(8)
        var yHi: UInt64 = 0, yLo: UInt64 = 0
        var offset = 0
        while offset < data.count {
            yHi ^= data.u64be(offset)
            yLo ^= data.u64be(offset + 8)
            var zHi: UInt64 = 0, zLo: UInt64 = 0
            var vHi = hHi, vLo = hLo
            for i in 0..<128 {
                let bit = i < 64 ? (yHi >> UInt64(63 - i)) & 1 : (yLo >> UInt64(127 - i)) & 1
                if bit == 1 { zHi ^= vHi; zLo ^= vLo }
                let lsb = vLo & 1
                vLo = (vLo >> 1) | (vHi << 63)
                vHi >>= 1
                if lsb == 1 { vHi ^= 0xE100_0000_0000_0000 }
            }
            yHi = zHi
            yLo = zLo
            offset += 16
        }
        var out = Bytes()
        out.appendBE(yHi)
        out.appendBE(yLo)
        return out
    }
}

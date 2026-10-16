// What reading an encrypted ZIP needs, without CryptoKit or CommonCrypto (neither is on Linux): SHA-1 / HMAC-SHA1 / PBKDF2 for the WinZip AES
// key derivation and authentication code, AES in counter mode with WinZip's little-endian counter, the PKWARE "traditional" stream cipher, and a
// running CRC-32. All of it works on chunks, so a multi-GB member is decrypted without being held in memory.
import Foundation

/// A CRC-32 (IEEE 802.3, the zip one) that is fed chunk by chunk.
struct RunningCRC32 {
    static let table: [UInt32] = (0..<256).map { n -> UInt32 in
        var c = UInt32(n)
        for _ in 0..<8 { c = c & 1 == 1 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    private var value: UInt32 = 0xFFFF_FFFF

    mutating func update(_ data: Bytes) {
        RunningCRC32.table.withUnsafeBufferPointer { t in
            data.withUnsafeBufferPointer { p in
                var c = value
                for b in p { c = t[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
                value = c
            }
        }
    }

    var checksum: UInt32 { value ^ 0xFFFF_FFFF }
}

/// SHA-1 (FIPS 180-4), incremental. Only used for the zip AES authentication code and key derivation, which the format fixes to HMAC-SHA1.
struct SHA1Hasher {
    private var h: [UInt32] = [0x6745_2301, 0xEFCD_AB89, 0x98BA_DCFE, 0x1032_5476, 0xC3D2_E1F0]
    private var pending = Bytes()
    private var length: UInt64 = 0
    private var w = [UInt32](repeating: 0, count: 80)

    init() { pending.reserveCapacity(64) }

    mutating func update(_ data: Bytes) {
        length &+= UInt64(data.count)
        var offset = 0
        if !pending.isEmpty {
            let take = min(64 - pending.count, data.count)
            pending += data[0..<take]
            offset = take
            if pending.count == 64 {
                let block = pending
                block.withUnsafeBufferPointer { compress($0.baseAddress!) }
                pending.removeAll(keepingCapacity: true)
            }
        }
        if data.count - offset >= 64 {
            data.withUnsafeBufferPointer { p in
                while data.count - offset >= 64 {
                    compress(p.baseAddress! + offset)
                    offset += 64
                }
            }
        }
        if offset < data.count { pending += data[offset...] }
    }

    func finalized() -> Bytes {
        var copy = self
        let bits = length &* 8
        var tail = Bytes([0x80])
        while (copy.pending.count + tail.count) % 64 != 56 { tail.append(0) }
        for shift in stride(from: 56, through: 0, by: -8) { tail.append(UInt8(truncatingIfNeeded: bits >> UInt64(shift))) }
        let savedLength = copy.length
        copy.update(tail)
        copy.length = savedLength
        var out = Bytes()
        out.reserveCapacity(20)
        for v in copy.h { out.appendBE(v) }
        return out
    }

    private mutating func compress(_ p: UnsafePointer<UInt8>) {
        w.withUnsafeMutableBufferPointer { w in
            for i in 0..<16 {
                w[i] = UInt32(p[i * 4]) << 24 | UInt32(p[i * 4 + 1]) << 16 | UInt32(p[i * 4 + 2]) << 8 | UInt32(p[i * 4 + 3])
            }
            for i in 16..<80 {
                let x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
                w[i] = (x << 1) | (x >> 31)
            }
            var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4]
            for i in 0..<80 {
                let f: UInt32
                let k: UInt32
                switch i {
                case 0..<20: f = (b & c) | (~b & d); k = 0x5A82_7999
                case 20..<40: f = b ^ c ^ d; k = 0x6ED9_EBA1
                case 40..<60: f = (b & c) | (b & d) | (c & d); k = 0x8F1B_BCDC
                default: f = b ^ c ^ d; k = 0xCA62_C1D6
                }
                let t = ((a << 5) | (a >> 27)) &+ f &+ e &+ k &+ w[i]
                e = d; d = c; c = (b << 30) | (b >> 2); b = a; a = t
            }
            h[0] = h[0] &+ a; h[1] = h[1] &+ b; h[2] = h[2] &+ c; h[3] = h[3] &+ d; h[4] = h[4] &+ e
        }
    }

    static func hash(_ data: Bytes) -> Bytes {
        var s = SHA1Hasher()
        s.update(data)
        return s.finalized()
    }
}

/// HMAC-SHA1 (RFC 2104), incremental over the message.
struct HMACSHA1Stream {
    private var inner = SHA1Hasher()
    private var outerKey: Bytes

    init(key: Bytes) {
        var k = key.count > 64 ? SHA1Hasher.hash(key) : key
        k += Bytes(repeating: 0, count: 64 - k.count)
        inner.update(k.map { $0 ^ 0x36 })
        outerKey = k.map { $0 ^ 0x5C }
    }

    mutating func update(_ data: Bytes) { inner.update(data) }

    func finalized() -> Bytes {
        var outer = SHA1Hasher()
        outer.update(outerKey)
        outer.update(inner.finalized())
        return outer.finalized()
    }

    static func mac(key: Bytes, message: Bytes) -> Bytes {
        var s = HMACSHA1Stream(key: key)
        s.update(message)
        return s.finalized()
    }
}

/// PBKDF2-HMAC-SHA1 (RFC 8018), the key derivation of WinZip AES (1000 iterations).
enum PBKDF2SHA1 {
    static func derive(password: Bytes, salt: Bytes, iterations: Int, length: Int) -> Bytes {
        var out = Bytes()
        var block: UInt32 = 1
        while out.count < length {
            var u = HMACSHA1Stream.mac(key: password, message: salt + [UInt8(block >> 24), UInt8(block >> 16 & 0xFF), UInt8(block >> 8 & 0xFF), UInt8(block & 0xFF)])
            var t = u
            if iterations > 1 {
                for _ in 1..<iterations {
                    u = HMACSHA1Stream.mac(key: password, message: u)
                    for i in 0..<t.count { t[i] ^= u[i] }
                }
            }
            out += t
            block += 1
        }
        return Array(out.prefix(length))
    }
}

/// AES (128/192/256) in counter mode the way WinZip uses it: the 16-byte counter block is a little-endian integer that starts at 1 and the
/// keystream is XORed onto the data, so encrypting and decrypting are the same call. Table driven so a GB of data takes seconds, not minutes.
struct ZipAESCTR {
    private static let sbox: [UInt8] = {
        var sbox = [UInt8](repeating: 0, count: 256)
        var p: UInt8 = 1
        var q: UInt8 = 1
        repeat {
            p = p ^ (p << 1) ^ ((p & 0x80) != 0 ? 0x1B : 0)
            q ^= q << 1
            q ^= q << 2
            q ^= q << 4
            if q & 0x80 != 0 { q ^= 0x09 }
            let r = { (x: UInt8, n: UInt8) in (x << n) | (x >> (8 - n)) }
            sbox[Int(p)] = q ^ r(q, 1) ^ r(q, 2) ^ r(q, 3) ^ r(q, 4) ^ 0x63
        } while p != 1
        sbox[0] = 0x63
        return sbox
    }()

    private static let te0: [UInt32] = sbox.map { s in
        let x2 = (s << 1) ^ ((s & 0x80) != 0 ? 0x1B : 0)
        let x3 = x2 ^ s
        return UInt32(x2) << 24 | UInt32(s) << 16 | UInt32(s) << 8 | UInt32(x3)
    }
    private static let te1: [UInt32] = te0.map { ($0 >> 8) | ($0 << 24) }
    private static let te2: [UInt32] = te0.map { ($0 >> 16) | ($0 << 16) }
    private static let te3: [UInt32] = te0.map { ($0 >> 24) | ($0 << 8) }

    private let roundKeys: [UInt32]
    private let rounds: Int
    private var counter: UInt64 = 1
    private var stream = [UInt8](repeating: 0, count: 16)
    private var used = 16

    init(key: Bytes) throws {
        guard key.count == 16 || key.count == 24 || key.count == 32 else { throw CryptoError.invalidKeyLength(key.count) }
        let nk = key.count / 4
        rounds = nk + 6
        var w = [UInt32](repeating: 0, count: 4 * (rounds + 1))
        for i in 0..<nk { w[i] = key.u32be(i * 4) }
        var rcon: UInt32 = 1
        func sub(_ x: UInt32) -> UInt32 {
            UInt32(ZipAESCTR.sbox[Int(x >> 24)]) << 24 | UInt32(ZipAESCTR.sbox[Int(x >> 16 & 0xFF)]) << 16
                | UInt32(ZipAESCTR.sbox[Int(x >> 8 & 0xFF)]) << 8 | UInt32(ZipAESCTR.sbox[Int(x & 0xFF)])
        }
        for i in nk..<w.count {
            var t = w[i - 1]
            if i % nk == 0 {
                t = sub((t << 8) | (t >> 24)) ^ (rcon << 24)
                rcon = rcon << 1 ^ (rcon & 0x80 != 0 ? 0x11B : 0)
            } else if nk > 6 && i % nk == 4 {
                t = sub(t)
            }
            w[i] = w[i - nk] ^ t
        }
        roundKeys = w
    }

    /// Encrypts/decrypts `data` in place, continuing the keystream of the previous call.
    mutating func apply(_ data: inout Bytes) {
        data.withUnsafeMutableBufferPointer { buffer in
            var i = 0
            let n = buffer.count
            while i < n {
                if used == 16 { nextBlock() }
                let take = min(16 - used, n - i)
                for j in 0..<take { buffer[i + j] ^= stream[used + j] }
                used += take
                i += take
            }
        }
    }

    private mutating func nextBlock() {
        // The counter block is `counter` as 16 little-endian bytes; AES reads its bytes as big-endian words.
        var s0 = UInt32(truncatingIfNeeded: counter).byteSwapped ^ roundKeys[0]
        var s1 = UInt32(truncatingIfNeeded: counter >> 32).byteSwapped ^ roundKeys[1]
        var s2 = roundKeys[2]
        var s3 = roundKeys[3]
        counter &+= 1
        var t0: UInt32 = 0, t1: UInt32 = 0, t2: UInt32 = 0, t3: UInt32 = 0
        ZipAESCTR.te0.withUnsafeBufferPointer { te0 in
            ZipAESCTR.te1.withUnsafeBufferPointer { te1 in
                ZipAESCTR.te2.withUnsafeBufferPointer { te2 in
                    ZipAESCTR.te3.withUnsafeBufferPointer { te3 in
                        for r in 1..<rounds {
                            t0 = te0[Int(s0 >> 24)] ^ te1[Int(s1 >> 16 & 0xFF)] ^ te2[Int(s2 >> 8 & 0xFF)] ^ te3[Int(s3 & 0xFF)] ^ roundKeys[4 * r]
                            t1 = te0[Int(s1 >> 24)] ^ te1[Int(s2 >> 16 & 0xFF)] ^ te2[Int(s3 >> 8 & 0xFF)] ^ te3[Int(s0 & 0xFF)] ^ roundKeys[4 * r + 1]
                            t2 = te0[Int(s2 >> 24)] ^ te1[Int(s3 >> 16 & 0xFF)] ^ te2[Int(s0 >> 8 & 0xFF)] ^ te3[Int(s1 & 0xFF)] ^ roundKeys[4 * r + 2]
                            t3 = te0[Int(s3 >> 24)] ^ te1[Int(s0 >> 16 & 0xFF)] ^ te2[Int(s1 >> 8 & 0xFF)] ^ te3[Int(s2 & 0xFF)] ^ roundKeys[4 * r + 3]
                            s0 = t0; s1 = t1; s2 = t2; s3 = t3
                        }
                    }
                }
            }
        }
        let sb = ZipAESCTR.sbox
        let k = 4 * rounds
        let o0 = (UInt32(sb[Int(s0 >> 24)]) << 24 | UInt32(sb[Int(s1 >> 16 & 0xFF)]) << 16 | UInt32(sb[Int(s2 >> 8 & 0xFF)]) << 8 | UInt32(sb[Int(s3 & 0xFF)])) ^ roundKeys[k]
        let o1 = (UInt32(sb[Int(s1 >> 24)]) << 24 | UInt32(sb[Int(s2 >> 16 & 0xFF)]) << 16 | UInt32(sb[Int(s3 >> 8 & 0xFF)]) << 8 | UInt32(sb[Int(s0 & 0xFF)])) ^ roundKeys[k + 1]
        let o2 = (UInt32(sb[Int(s2 >> 24)]) << 24 | UInt32(sb[Int(s3 >> 16 & 0xFF)]) << 16 | UInt32(sb[Int(s0 >> 8 & 0xFF)]) << 8 | UInt32(sb[Int(s1 & 0xFF)])) ^ roundKeys[k + 2]
        let o3 = (UInt32(sb[Int(s3 >> 24)]) << 24 | UInt32(sb[Int(s0 >> 16 & 0xFF)]) << 16 | UInt32(sb[Int(s1 >> 8 & 0xFF)]) << 8 | UInt32(sb[Int(s2 & 0xFF)])) ^ roundKeys[k + 3]
        for (index, word) in [o0, o1, o2, o3].enumerated() {
            stream[index * 4] = UInt8(word >> 24)
            stream[index * 4 + 1] = UInt8(word >> 16 & 0xFF)
            stream[index * 4 + 2] = UInt8(word >> 8 & 0xFF)
            stream[index * 4 + 3] = UInt8(word & 0xFF)
        }
        used = 0
    }
}

/// The PKWARE "traditional" encryption (ZipCrypto): three 32-bit keys seeded by the password, a keystream byte per data byte. It is weak, and
/// it is what `zip -P` and old tools write; zip4j reads it, so the importer does as well.
struct ZipCryptoCipher {
    private var key0: UInt32 = 0x1234_5678
    private var key1: UInt32 = 0x2345_6789
    private var key2: UInt32 = 0x3456_7890

    init(password: Bytes) {
        for b in password { update(b) }
    }

    private mutating func update(_ c: UInt8) {
        key0 = RunningCRC32.table[Int((key0 ^ UInt32(c)) & 0xFF)] ^ (key0 >> 8)
        key1 = (key1 &+ (key0 & 0xFF)) &* 134_775_813 &+ 1
        key2 = RunningCRC32.table[Int((key2 ^ (key1 >> 24)) & 0xFF)] ^ (key2 >> 8)
    }

    mutating func decrypt(_ data: inout Bytes) {
        for i in 0..<data.count {
            let temp = (key2 | 2) & 0xFFFF
            let plain = data[i] ^ UInt8(truncatingIfNeeded: (temp &* (temp ^ 1)) >> 8)
            data[i] = plain
            update(plain)
        }
    }
}

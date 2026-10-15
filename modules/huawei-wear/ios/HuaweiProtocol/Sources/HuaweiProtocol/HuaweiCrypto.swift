// Port of HuaweiCrypto.java and the parts of CryptoUtils.java it uses.
import Foundation

public struct HuaweiCrypto {
    public static let secretKey1V1: Bytes = [0x6F, 0x75, 0x6A, 0x79, 0x6D, 0x77, 0x71, 0x34, 0x63, 0x6C, 0x76, 0x39, 0x33, 0x37, 0x38, 0x79]
    public static let secretKey2V1: Bytes = [0x62, 0x31, 0x30, 0x6A, 0x67, 0x66, 0x64, 0x39, 0x79, 0x37, 0x76, 0x73, 0x75, 0x64, 0x61, 0x39]
    public static let secretKey1V23: Bytes = [0x55, 0x53, 0x86, 0xFC, 0x63, 0x20, 0x07, 0xAA, 0x86, 0x49, 0x35, 0x22, 0xB8, 0x6A, 0xE2, 0x5C]
    public static let secretKey2V23: Bytes = [0x33, 0x07, 0x9B, 0xC5, 0x7A, 0x88, 0x6D, 0x3C, 0xF5, 0x61, 0x37, 0x09, 0x6F, 0x22, 0x80, 0x00]

    public static let digestSecretV1: Bytes = [0x70, 0xFB, 0x6C, 0x24, 0x03, 0x5F, 0xDB, 0x55, 0x2F, 0x38, 0x89, 0x8A, 0xEE, 0xDE, 0x3F, 0x69]
    public static let digestSecretV2: Bytes = [0x93, 0xAC, 0xDE, 0xF7, 0x6A, 0xCB, 0x09, 0x85, 0x7D, 0xBF, 0xE5, 0x26, 0x1A, 0xAB, 0xCD, 0x78]
    public static let digestSecretV3: Bytes = [0x9C, 0x27, 0x63, 0xA9, 0xCC, 0xE1, 0x34, 0x76, 0x6D, 0xE3, 0xFF, 0x61, 0x18, 0x20, 0x05, 0x53]

    public static let messageResponse: Bytes = [0x01, 0x10]
    public static let messageChallenge: Bytes = [0x01, 0x00]
    public static let messageChallengeV4: Bytes = [0x04, 0x00]

    public var authVersion: Int
    public var deviceSupportType: Int
    public var authAlgo: UInt8
    public var authMode: UInt8

    public init(authVersion: Int, authAlgo: UInt8 = 0, deviceSupportType: Int = 0, authMode: UInt8 = 0) {
        self.authVersion = authVersion
        self.authAlgo = authAlgo
        self.deviceSupportType = deviceSupportType
        self.authMode = authMode
    }

    /// 16 random bytes (GB: "While technically not a nonce, we need it to be random").
    public static func generateNonce() -> Bytes { Entropy.bytes(16) }

    /// Java's `ByteBuffer.allocate(0x40).put(..).array()` is always 0x40 bytes: the version 2 digest is only 50 and the rest stays zero.
    private static func padded(_ value: Bytes, to size: Int) -> Bytes { value + Bytes(repeating: 0, count: max(0, size - value.count)) }

    private func digestSecret() -> Bytes {
        if authVersion == 1 || authVersion == 4 { return HuaweiCrypto.digestSecretV1 }
        if authVersion == 2 { return HuaweiCrypto.digestSecretV2 }
        return HuaweiCrypto.digestSecretV3
    }

    /// `HuaweiCrypto.computeDigest(message, nonce)`: 0x40 bytes, `HMAC(HMAC(secret||message, nonce) , nonce) || HMAC(secret||message, nonce)`.
    /// Java's `calcHmacSha256(key, message)` takes the key first: here the digest input is the *key* and the nonce the message.
    public func computeDigest(message: Bytes, nonce: Bytes) throws -> Bytes {
        let msgToDigest = digestSecret() + message
        let step1 = HMACSHA256.mac(key: msgToDigest, message: nonce)
        return HMACSHA256.mac(key: step1, message: nonce) + step1
    }

    public func computeDigestHiChainLite(message: Bytes, key: Bytes, nonce: Bytes) throws -> Bytes {
        let hashKey = SHA256.hash(Array(key.hexUpper.utf8))
        var secret = digestSecret()
        for i in 0..<secret.count { secret[i] = hashKey[i] ^ secret[i] }
        // Java allocates 18 bytes: the 16-byte secret then the 2-byte message.
        let msgToDigest = secret + message
        let step1: Bytes
        if authAlgo == 0x01 {
            step1 = PBKDF2SHA256.derive(
                password: Array(msgToDigest.hexUpper.utf8),
                salt: Array(nonce.hexUpper.utf8),
                iterations: 0x3e8,
                keyBits: 0x100
            )
        } else {
            step1 = HMACSHA256.mac(key: msgToDigest, message: nonce)
        }
        return HMACSHA256.mac(key: step1, message: nonce) + step1
    }

    /// `digestChallenge`; nil when GB returns null (HiChain Lite without a key).
    public func digestChallenge(secretKey: Bytes?, nonce: Bytes) throws -> Bytes? {
        if authMode == 0x02 {
            guard let secretKey else { return nil }
            if authVersion == 0x02 {
                let key = secretKey + HuaweiCrypto.messageChallenge
                return HuaweiCrypto.padded(HMACSHA256.mac(key: key, message: nonce) + key, to: 0x40)
            }
            return try computeDigestHiChainLite(message: HuaweiCrypto.messageChallenge, key: secretKey, nonce: nonce)
        }
        if authVersion == 4 { return try computeDigest(message: HuaweiCrypto.messageChallengeV4, nonce: nonce) }
        return try computeDigest(message: HuaweiCrypto.messageChallenge, nonce: nonce)
    }

    public func digestResponse(secretKey: Bytes?, nonce: Bytes) throws -> Bytes? {
        if authMode == 0x02 {
            guard let secretKey else { return nil }
            if authVersion == 0x02 {
                let key = secretKey + HuaweiCrypto.messageResponse
                return HuaweiCrypto.padded(HMACSHA256.mac(key: key, message: nonce) + key, to: 0x40)
            }
            return try computeDigestHiChainLite(message: HuaweiCrypto.messageResponse, key: secretKey, nonce: nonce)
        }
        return try computeDigest(message: HuaweiCrypto.messageResponse, nonce: nonce)
    }

    /// `initializationVector(counter)`: 16 bytes, 12 random then the incremented counter in the last 4 (big endian).
    /// Returns the IV and the counter now in force (GB reads it back from the IV). GB's wrap-around check compares against the Java
    /// literal `0xFFFFFFFF`, which is -1 as a long and never matches an unsigned counter, so 0xFFFFFFFF wraps to 0, not 1.
    public static func initializationVector(counter: UInt32) -> (iv: Bytes, counter: UInt32) {
        let next = counter &+ 1
        var iv = Entropy.bytes(16)
        iv[12] = UInt8(next >> 24)
        iv[13] = UInt8(next >> 16 & 0xFF)
        iv[14] = UInt8(next >> 8 & 0xFF)
        iv[15] = UInt8(next & 0xFF)
        return (iv, next)
    }

    /// `createSecretKey(macAddress)`.
    public func createSecretKey(macAddress: String) -> Bytes {
        var key1 = HuaweiCrypto.secretKey1V23
        var key2 = HuaweiCrypto.secretKey2V23
        if authVersion == 1 {
            key1 = HuaweiCrypto.secretKey1V1
            key2 = HuaweiCrypto.secretKey2V1
        }
        // Java reads 16 characters of "<mac without colons>0000": a MAC of 12 hex digits. Anything shorter is zero filled instead of trapping.
        let macAddressKey = Array((Array((macAddress.replacingOccurrences(of: ":", with: "") + "0000").utf8) + Bytes(repeating: 0x30, count: 16)).prefix(16))
        var mixed = Bytes(repeating: 0, count: 16)
        for i in 0..<16 { mixed[i] = UInt8(truncatingIfNeeded: (Int(key1[i]) << 4) ^ Int(key2[i])) }
        let mixedHash = SHA256.hash(mixed)
        var finalMixed = Bytes(repeating: 0, count: 16)
        for i in 0..<16 { finalMixed[i] = (mixedHash[i] >> 6) ^ macAddressKey[i] }
        return Array(SHA256.hash(finalMixed).prefix(16))
    }

    public func encryptBondingKey(encryptMethod: UInt8, data: Bytes, key: Bytes, iv: Bytes) throws -> Bytes {
        if encryptMethod == 0x01 { return try AES.encryptGCM(data, key: key, iv: iv, aad: nil) }
        return try AES.encryptCBC(data, key: key, iv: iv)
    }

    public func decryptBondingKey(encryptMethod: UInt8, data: Bytes, key: Bytes, iv: Bytes) throws -> Bytes {
        if encryptMethod == 0x01 { return try AES.decryptGCM(data, key: key, iv: iv, aad: nil) }
        return try AES.decryptCBC(data, key: key, iv: iv)
    }

    public func decryptPinCode(encryptMethod: UInt8, message: Bytes, iv: Bytes) throws -> Bytes {
        let secret = digestSecret()
        if encryptMethod == 0x01 { return try AES.decryptGCM(message, key: secret, iv: iv, aad: nil) }
        return try AES.decryptCBC(message, key: secret, iv: iv)
    }

    public static func encrypt(useGCM: Bool, message: Bytes, key: Bytes, iv: Bytes) throws -> Bytes {
        if useGCM { return try AES.encryptGCM(message, key: key, iv: iv, aad: nil) }
        return try AES.encryptCBC(message, key: key, iv: iv)
    }

    public static func decrypt(useGCM: Bool, message: Bytes, key: Bytes, iv: Bytes) throws -> Bytes {
        if useGCM { return try AES.decryptGCM(message, key: key, iv: iv, aad: nil) }
        return try AES.decryptCBC(message, key: key, iv: iv)
    }
}

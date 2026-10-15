// The identity the watch binds to (Android `DeviceStore`/`DeviceIdentity`, GB `HuaweiSupportProvider.createSecretKey` & co):
// the stored auth key, the fake MAC and fake "android id" the app presents, and whether a bind has completed.
import Foundation

public protocol DeviceIdentity: AnyObject {
    /// The watch's Bluetooth address as GB's `getDeviceMac()`. CoreBluetooth hides it: iOS passes the peripheral UUID string, which only
    /// the normal-mode Bond key (`createSecretKey(macAddress:)`) ever reads, and the Fit 4 Pro never uses that mode.
    var deviceAddress: String { get }
    /// GB `initializeDevice()`: creates the fake MAC and android id before the first request.
    func ensureCreated()
    /// `FF:FF:FF:xx:xx:xx` as ASCII.
    var macAddressBytes: Bytes { get }
    /// 32 hex characters (16 random bytes, upper case) as ASCII.
    var androidIdBytes: Bytes { get }
    /// The last three bytes of the fake MAC as 6 hex characters, as ASCII.
    var serialBytes: Bytes { get }
    /// The stored auth key; HiChain op 1 sets it mid-bind.
    var authKey: Bytes? { get set }
    /// GB `createSecretKey()`: a random 16-byte auth key if none is stored; returns the key.
    func createSecretKey() -> Bytes
    /// True until a bind completed; a stored key alone does not count (HiChain writes the key before the bind ends).
    var isFirstConnection: Bool { get }
    func markBonded()
}

/// Volatile identity for tests and for a transient connect; production uses a Keychain-backed implementation.
public final class InMemoryDeviceIdentity: DeviceIdentity {
    public let deviceAddress: String
    private var mac: String?
    private var androidId: String?
    private var bonded = false
    public var authKey: Bytes?

    public init(deviceAddress: String, macAddress: String? = nil, androidId: String? = nil, authKey: Bytes? = nil, bonded: Bool = false) {
        self.deviceAddress = deviceAddress
        self.mac = macAddress
        self.androidId = androidId
        self.authKey = authKey
        self.bonded = bonded
    }

    public func ensureCreated() {
        _ = macString
        _ = androidIdString
    }

    public var macString: String {
        if let mac, !mac.isEmpty { return mac }
        // GB createRandomMacAddress: FF:FF:FF then three random bytes in 0...254.
        let random = Entropy.bytes(3).map { String(format: ":%02X", Int($0) % 255) }.joined()
        let created = "FF:FF:FF" + random
        mac = created
        return created
    }

    public var androidIdString: String {
        if let androidId, !androidId.isEmpty { return androidId }
        let created = HuaweiCrypto.generateNonce().hexUpper
        androidId = created
        return created
    }

    public var macAddressBytes: Bytes { Array(macString.utf8) }
    public var androidIdBytes: Bytes { Array(androidIdString.utf8) }
    public var serialBytes: Bytes {
        let compact = macString.replacingOccurrences(of: ":", with: "")
        return Array(compact.dropFirst(6).prefix(6).utf8)
    }

    public func createSecretKey() -> Bytes {
        if let authKey { return authKey }
        let created = HuaweiCrypto.generateNonce()
        authKey = created
        return created
    }

    public var isFirstConnection: Bool { !bonded || authKey == nil }
    public func markBonded() { bonded = true }
}

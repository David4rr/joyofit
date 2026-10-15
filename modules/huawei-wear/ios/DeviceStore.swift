// The identity the watch binds to, kept per watch: auth key, the fake MAC and fake "android id" the app presents, and whether a bind has
// completed. Port of DeviceStore.kt (Gadgetbridge HuaweiSupportProvider.createSecretKey / getSecretKey / setSecretKey /
// createRandomMacAddress / createAndroidID). The Keychain replaces the private SharedPreferences file; items are
// kSecAttrAccessibleAfterFirstUnlock so a background reconnect works while the phone is locked, and they survive an app reinstall like the
// watch's own bond does.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif
#if canImport(Security)
import Security
#endif

/// Where the identity values live. The Keychain in the app, memory in the logic tests.
public protocol SecretStore: AnyObject, Sendable {
    func get(_ key: String) -> String?
    /// A nil value removes the item.
    func set(_ value: String?, for key: String)
}

public final class MemorySecretStore: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: String] = [:]

    public init() {}

    public func get(_ key: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return values[key]
    }

    public func set(_ value: String?, for key: String) {
        lock.lock()
        defer { lock.unlock() }
        values[key] = value
    }

    public var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return values.count
    }
}

#if canImport(Security)
/// Generic-password Keychain items, `kSecAttrAccessibleAfterFirstUnlock`, not synchronized to iCloud.
public final class KeychainSecretStore: SecretStore, @unchecked Sendable {
    private let service: String

    public init(service: String = "com.joyodigitama.joyofit.huaweiwear") {
        self.service = service
    }

    private func query(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrSynchronizable as String: false,
        ]
    }

    public func get(_ key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func set(_ value: String?, for key: String) {
        guard let value else {
            SecItemDelete(query(key) as CFDictionary)
            return
        }
        let data = Data(value.utf8)
        let update = SecItemUpdate(query(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecItemNotFound {
            var add = query(key)
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(add as CFDictionary, nil)
        }
    }
}
#endif

public final class DeviceStore: @unchecked Sendable {
    fileprivate enum Key {
        static let auth = "authkey"
        static let mac = "fake_mac_address"
        static let androidId = "fake_android_id"
        static let bonded = "bonded"
        static let all = [auth, mac, androidId, bonded]
    }

    private let secrets: SecretStore

    public init(secrets: SecretStore) {
        self.secrets = secrets
    }

    /// `address` is the watch's identifier, trimmed and upper case like Android's MAC (a peripheral UUID string on iOS).
    public static func normalize(_ address: String) -> String {
        address.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    public func forDevice(_ address: String) -> StoredDeviceIdentity {
        StoredDeviceIdentity(address: DeviceStore.normalize(address), secrets: secrets)
    }

    /// Drops the auth key, fake identity and bond flag so the next connect is a first-time bind.
    public func forget(_ address: String) {
        let normalized = DeviceStore.normalize(address)
        for key in Key.all { secrets.set(nil, for: StoredDeviceIdentity.itemKey(normalized, key)) }
    }
}

public final class StoredDeviceIdentity: DeviceIdentity, @unchecked Sendable {
    public let deviceAddress: String
    private let secrets: SecretStore

    fileprivate init(address: String, secrets: SecretStore) {
        self.deviceAddress = address
        self.secrets = secrets
    }

    fileprivate static func itemKey(_ address: String, _ key: String) -> String { "\(address)|\(key)" }

    private func read(_ key: String) -> String? { secrets.get(StoredDeviceIdentity.itemKey(deviceAddress, key)) }
    private func write(_ value: String?, _ key: String) { secrets.set(value, for: StoredDeviceIdentity.itemKey(deviceAddress, key)) }

    /// GB initializeDevice(): create the fake MAC and android id before the first request.
    public func ensureCreated() {
        _ = macString
        _ = androidIdString
    }

    /// Fake `FF:FF:FF:xx:xx:xx` address, as GB `createRandomMacAddress`: three random bytes in 0...254.
    public var macString: String {
        if let stored = read(DeviceStore.Key.mac), !stored.isEmpty { return stored }
        var created = "FF:FF:FF"
        for b in Entropy.bytes(3) {
            let hex = String(Int(b) % 255, radix: 16, uppercase: true)
            created += ":" + (hex.count < 2 ? "0" + hex : hex)
        }
        write(created, DeviceStore.Key.mac)
        return created
    }

    /// Fake Android id, as GB `createAndroidID`: hex of 16 random bytes.
    public var androidIdString: String {
        if let stored = read(DeviceStore.Key.androidId), !stored.isEmpty { return stored }
        let created = HuaweiCrypto.generateNonce().hexUpper
        write(created, DeviceStore.Key.androidId)
        return created
    }

    public var macAddressBytes: Bytes { Array(macString.utf8) }
    public var androidIdBytes: Bytes { Array(androidIdString.utf8) }

    /// GB `getSerial()`: the last three bytes of the fake MAC as 6 hex characters.
    public var serialBytes: Bytes {
        let compact = macString.replacingOccurrences(of: ":", with: "")
        return Array(compact.dropFirst(6).prefix(6).utf8)
    }

    /// The stored auth key (GB `getSecretKey()` without the NPE on a missing key).
    public var authKey: Bytes? {
        get {
            guard let stored = read(DeviceStore.Key.auth), !stored.isEmpty else { return nil }
            return Bytes(hex: stored)
        }
        set { write(newValue?.hexUpper, DeviceStore.Key.auth) }
    }

    /// GB `createSecretKey()`: a random 16-byte auth key if none is stored; returns the key.
    public func createSecretKey() -> Bytes {
        if let key = authKey { return key }
        let created = HuaweiCrypto.generateNonce()
        authKey = created
        return created
    }

    /// GB's `firstConnection` flag: true until a bind has completed. A stored key alone does not count because the HiChain bind writes the
    /// key mid-way (operationCode 1 step 3) before it has finished.
    public var isFirstConnection: Bool { read(DeviceStore.Key.bonded) != "true" || authKey == nil }

    public func markBonded() { write("true", DeviceStore.Key.bonded) }
}

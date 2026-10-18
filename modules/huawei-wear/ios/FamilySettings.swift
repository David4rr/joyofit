// Family monitoring, monitored side: what the app stores natively so an upload can run with no JS (HuaweiWearFamily.types.ts, docs/family-monitoring.md
// section 10). The config is UserDefaults (suite `joyofit_family`) with the bearer token in the Keychain (`SecretStore`, after-first-unlock, so a
// background wake on a locked phone can still sign the request). Foundation only, so the logic tests run it on Linux.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

/// What the monitored person agreed to share (`FamilyScopes`). `sync` (watch seen time, battery, newest sample time) is required once consented.
public struct FamilyScopes: Equatable, Sendable {
    public var sync: Bool
    public var steps: Bool
    public var sleep: Bool
    public var restingHr: Bool
    public var spo2: Bool

    public init(sync: Bool, steps: Bool, sleep: Bool, restingHr: Bool, spo2: Bool) {
        self.sync = sync
        self.steps = steps
        self.sleep = sleep
        self.restingHr = restingHr
        self.spo2 = spo2
    }
}

/// `FamilyConfig` of the TS contract.
public struct FamilyConfig: Equatable, Sendable {
    /// The Worker origin without a trailing slash.
    public var baseUrl: String
    public var token: String
    public var scopes: FamilyScopes
    public var enabled: Bool

    public init(baseUrl: String, token: String, scopes: FamilyScopes, enabled: Bool) {
        self.baseUrl = baseUrl
        self.token = token
        self.scopes = scopes
        self.enabled = enabled
    }

    /// The config from the JS object; a missing or mistyped field is an invalid argument.
    public static func parse(_ raw: [String: Any]) throws -> FamilyConfig {
        func bad(_ field: String) -> WearError { WearError(.invalidArgument, "The family config needs \(field)") }
        guard let rawBase = raw["baseUrl"] as? String else { throw bad("baseUrl (a string)") }
        var base = rawBase.trimmingCharacters(in: .whitespacesAndNewlines)
        while base.hasSuffix("/") { base.removeLast() }
        guard let url = URL(string: base), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http", url.host != nil else {
            throw WearError(.invalidArgument, "The family baseUrl must be an http(s) origin, got '\(rawBase)'")
        }
        guard let token = raw["token"] as? String, !token.isEmpty else { throw bad("token (a non-empty string)") }
        guard let scopes = raw["scopes"] as? [String: Any] else { throw bad("scopes (an object)") }
        func flag(_ name: String) throws -> Bool {
            guard let value = scopes[name] as? Bool else { throw bad("scopes.\(name) (a boolean)") }
            return value
        }
        guard let enabled = raw["enabled"] as? Bool else { throw bad("enabled (a boolean)") }
        return FamilyConfig(
            baseUrl: base, token: token,
            scopes: FamilyScopes(
                sync: try flag("sync"), steps: try flag("steps"), sleep: try flag("sleep"), restingHr: try flag("restingHr"), spo2: try flag("spo2")
            ),
            enabled: enabled
        )
    }
}

/// `FamilyUploadResult` of the TS contract.
public struct FamilyUploadResult: Equatable, Sendable {
    public enum Outcome: String, Sendable {
        case sent, skipped, rejected, failed
    }

    public let outcome: Outcome
    /// The HTTP status when a request was answered.
    public let status: Int?
    /// Unix ms of the attempt.
    public let at: Int64

    public init(_ outcome: Outcome, status: Int? = nil, at: Int64) {
        self.outcome = outcome
        self.status = status
        self.at = at
    }

    public func toJS() -> [String: Any] {
        ["outcome": outcome.rawValue, "status": status ?? NSNull(), "at": at]
    }
}

/// The last request that was made: when, and the watch sync time it carried. Drives the throttle.
public struct FamilyAttempt: Equatable, Sendable {
    public let atMs: Int64
    public let watchSyncAt: Int64?

    public init(atMs: Int64, watchSyncAt: Int64?) {
        self.atMs = atMs
        self.watchSyncAt = watchSyncAt
    }
}

public final class FamilySettings: @unchecked Sendable {
    private static let suiteName = "joyofit_family"
    private static let tokenKey = "family_token"
    private let defaults: UserDefaults
    private let secrets: SecretStore

    private enum Key {
        static let baseUrl = "base_url"
        static let enabled = "enabled"
        static let scopeSync = "scope_sync"
        static let scopeSteps = "scope_steps"
        static let scopeSleep = "scope_sleep"
        static let scopeRestingHr = "scope_resting_hr"
        static let scopeSpo2 = "scope_spo2"
        static let lastOutcome = "last_outcome"
        static let lastStatus = "last_status"
        static let lastAt = "last_at_ms"
        static let lastPayload = "last_payload"
        static let attemptAt = "attempt_at_ms"
        static let attemptWatchSync = "attempt_watch_sync_at_ms"
    }

    private static let configKeys = [
        Key.baseUrl, Key.enabled, Key.scopeSync, Key.scopeSteps, Key.scopeSleep, Key.scopeRestingHr, Key.scopeSpo2,
    ]

    public init(defaults: UserDefaults? = nil, secrets: SecretStore) {
        self.defaults = defaults ?? UserDefaults(suiteName: FamilySettings.suiteName) ?? .standard
        self.secrets = secrets
    }

    /// The stored config; nil while none was set, or when the token is gone from the Keychain.
    public var config: FamilyConfig? {
        get {
            guard let baseUrl = defaults.string(forKey: Key.baseUrl), let token = secrets.get(FamilySettings.tokenKey) else { return nil }
            return FamilyConfig(
                baseUrl: baseUrl, token: token,
                scopes: FamilyScopes(
                    sync: defaults.bool(forKey: Key.scopeSync), steps: defaults.bool(forKey: Key.scopeSteps), sleep: defaults.bool(forKey: Key.scopeSleep),
                    restingHr: defaults.bool(forKey: Key.scopeRestingHr), spo2: defaults.bool(forKey: Key.scopeSpo2)
                ),
                enabled: defaults.bool(forKey: Key.enabled)
            )
        }
        set {
            guard let c = newValue else {
                for key in FamilySettings.configKeys { defaults.removeObject(forKey: key) }
                secrets.set(nil, for: FamilySettings.tokenKey)
                return
            }
            secrets.set(c.token, for: FamilySettings.tokenKey)
            defaults.set(c.baseUrl, forKey: Key.baseUrl)
            defaults.set(c.enabled, forKey: Key.enabled)
            defaults.set(c.scopes.sync, forKey: Key.scopeSync)
            defaults.set(c.scopes.steps, forKey: Key.scopeSteps)
            defaults.set(c.scopes.sleep, forKey: Key.scopeSleep)
            defaults.set(c.scopes.restingHr, forKey: Key.scopeRestingHr)
            defaults.set(c.scopes.spo2, forKey: Key.scopeSpo2)
        }
    }

    /// The result of the last upload attempt (foreground or background).
    public var last: FamilyUploadResult? {
        get {
            guard let raw = defaults.string(forKey: Key.lastOutcome), let outcome = FamilyUploadResult.Outcome(rawValue: raw) else { return nil }
            let status = defaults.object(forKey: Key.lastStatus) == nil ? nil : defaults.integer(forKey: Key.lastStatus)
            return FamilyUploadResult(outcome, status: status, at: Int64(defaults.double(forKey: Key.lastAt)))
        }
        set {
            guard let result = newValue else {
                for key in [Key.lastOutcome, Key.lastStatus, Key.lastAt] { defaults.removeObject(forKey: key) }
                return
            }
            defaults.set(result.outcome.rawValue, forKey: Key.lastOutcome)
            if let status = result.status { defaults.set(status, forKey: Key.lastStatus) } else { defaults.removeObject(forKey: Key.lastStatus) }
            defaults.set(Double(result.at), forKey: Key.lastAt)
        }
    }

    /// The exact JSON body of the last accepted upload.
    public var lastPayload: String? {
        get { defaults.string(forKey: Key.lastPayload) }
        set { if let newValue { defaults.set(newValue, forKey: Key.lastPayload) } else { defaults.removeObject(forKey: Key.lastPayload) } }
    }

    public var attempt: FamilyAttempt? {
        get {
            guard defaults.object(forKey: Key.attemptAt) != nil else { return nil }
            let watchSync = defaults.object(forKey: Key.attemptWatchSync) == nil ? nil : Int64(defaults.double(forKey: Key.attemptWatchSync))
            return FamilyAttempt(atMs: Int64(defaults.double(forKey: Key.attemptAt)), watchSyncAt: watchSync)
        }
        set {
            guard let a = newValue else {
                for key in [Key.attemptAt, Key.attemptWatchSync] { defaults.removeObject(forKey: key) }
                return
            }
            defaults.set(Double(a.atMs), forKey: Key.attemptAt)
            if let watchSync = a.watchSyncAt { defaults.set(Double(watchSync), forKey: Key.attemptWatchSync) } else { defaults.removeObject(forKey: Key.attemptWatchSync) }
        }
    }

    /// `familyConfigure(null)`: the config, the token, the last result and payload, and the throttle state.
    public func clearAll() {
        config = nil
        last = nil
        lastPayload = nil
        attempt = nil
    }
}

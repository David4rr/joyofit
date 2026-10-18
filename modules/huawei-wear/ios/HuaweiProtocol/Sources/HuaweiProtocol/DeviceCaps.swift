// What the connected watch reported during init (GB HuaweiState): shared by the initializer (writer) and the sync code (readers).
import Foundation

public final class DeviceCaps: @unchecked Sendable {
    private let lock = NSLock()
    private var _supportedCommands: [Int: Bytes] = [:]
    private var _expandCapabilities: Bytes?
    private var _truSleepNewSync = false
    private var _rriNewSync = false
    private var _gpsNewSync = false

    public init() {}

    /// Commands per service from SupportedCommands (GB `commandsPerService`).
    public var supportedCommands: [Int: Bytes] {
        get { lock.lock(); defer { lock.unlock() }; return _supportedCommands }
        set { lock.lock(); _supportedCommands = newValue; lock.unlock() }
    }

    /// ExpandCapability bitmap; nil when the watch sent none.
    public var expandCapabilities: Bytes? {
        get { lock.lock(); defer { lock.unlock() }; return _expandCapabilities }
        set { lock.lock(); _expandCapabilities = newValue; lock.unlock() }
    }

    /// SettingRelated tag 0x02 bit 1: sleep files via service 0x2C.
    public var truSleepNewSync: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _truSleepNewSync }
        set { lock.lock(); _truSleepNewSync = newValue; lock.unlock() }
    }

    public var rriNewSync: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _rriNewSync }
        set { lock.lock(); _rriNewSync = newValue; lock.unlock() }
    }

    public var gpsNewSync: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _gpsNewSync }
        set { lock.lock(); _gpsNewSync = newValue; lock.unlock() }
    }

    public func reset() {
        lock.lock()
        _supportedCommands = [:]
        _expandCapabilities = nil
        _truSleepNewSync = false
        _rriNewSync = false
        _gpsNewSync = false
        lock.unlock()
    }

    /// GB `supportsCommandForService`.
    public func supports(_ service: Int, _ command: Int) -> Bool {
        supportedCommands[service]?.contains(UInt8(truncatingIfNeeded: command)) == true
    }

    /// GB `supportsExpandCapability(which)`: bit `which % 8` of byte `which / 8`.
    public func expandCapability(_ which: Int) -> Bool {
        guard let caps = expandCapabilities, which >= 0, which < caps.count * 8 else { return false }
        let bit = UInt8(1 << (which % 8))
        return caps[which / 8] & bit == bit
    }

    /// FitnessData (0x07) command 0x16.
    public var supportsTruSleep: Bool { supports(0x07, 0x16) }
    /// ExpandCapability bit 143.
    public var supportsDictSleepSync: Bool { expandCapability(143) }
    /// ExpandCapability bit 199.
    public var supportsBedTime: Bool { expandCapability(199) }
}

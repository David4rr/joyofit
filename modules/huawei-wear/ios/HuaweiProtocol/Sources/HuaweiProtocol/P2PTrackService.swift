// Port of TrackService (HeartRateZonesSync.kt, derived from GB's HuaweiP2PTrackService): P2P module `hw.unitedevice.track`, watch package
// `hw.watch.health.p2p`, fingerprint `SystemApp`. On registration the phone sends the heart-rate zone TLV in a type-2 `P2PSubMsg`. `age` is read
// at each send, so `resend` picks up a changed profile.
import Foundation

public final class P2PTrackService: P2PService, @unchecked Sendable {
    public static let moduleName = "hw.unitedevice.track"
    public static let packageName = "hw.watch.health.p2p"
    public static let fingerprintValue = "SystemApp"

    private let log: LogSink
    private let age: @Sendable () -> Int

    public init(manager: P2PManager, log: @escaping LogSink, age: @escaping @Sendable () -> Int) {
        self.log = log
        self.age = age
        super.init(manager: manager)
    }

    public override var module: String { P2PTrackService.moduleName }
    public override var package: String { P2PTrackService.packageName }
    public override var fingerprint: String { P2PTrackService.fingerprintValue }

    public override func registered() { resend() }

    public override func handleData(_ data: Bytes) throws {
        log(LogEntry(.info, service: 0x34, command: 0x01, "HR zones: track service data, \(data.count) bytes: \(data.hexUpper)"))
    }

    /// GB `sendHeartZoneConfig`.
    public func resend() {
        let years = age()
        let configs = HeartRateZonesCalc.deviceConfig(age: years, track: true, simpleCommand: false, extended: false)
        guard let pairs = HeartRateZonesCalc.trackTlv(configs) else {
            log(LogEntry(.error, service: 0x34, command: 0x01, "HR zones: not sent, the zones for age \(years) are not valid"))
            return
        }
        var tlv = HuaweiTLV()
        for (tag, value) in pairs { tlv.put(tag, byte: UInt8(truncatingIfNeeded: value)) }
        let packet = P2PSubMsg(type: 2, messageId: P2PSubMsg.nextMessageId(), data: tlv.serialize())
        sendCommand(packet.bytes, nil)
        guard let upright = configs.first(where: { $0.posture == .upright }), let mhr = upright.byMethod(.mhr), let hrr = upright.byMethod(.hrr) else { return }
        log(
            LogEntry(
                .info, service: 0x34, command: 0x01,
                "HR zones: sent via \(P2PTrackService.moduleName) for age \(years), upright MHR \(mhr.zone1)/\(mhr.zone2)/\(mhr.zone3)/\(mhr.zone4)/\(mhr.zone5) of \(mhr.threshold), "
                    + "HRR \(hrr.zone1)/\(hrr.zone2)/\(hrr.zone3)/\(hrr.zone4)/\(hrr.zone5) resting \(hrr.resting), warning \(upright.warningHRLimit), \(packet.bytes.count) bytes"
            )
        )
    }
}

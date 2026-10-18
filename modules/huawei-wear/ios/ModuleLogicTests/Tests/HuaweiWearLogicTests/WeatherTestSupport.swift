import Foundation
import XCTest
@testable import HuaweiWearLogic

/// The watch side of a real `HuaweiSession`: reassembles what the phone writes (decrypting TLVs with the session's key), records it, and feeds the
/// scripted answers back. The module-level twin of the package test helper `SleepFilesFakeWatch`.
final class WeatherScriptedWatch: FrameSink, @unchecked Sendable {
    struct Request {
        let service: UInt8
        let command: UInt8
        let tlv: HuaweiTLV
        let encrypted: Bool
        var key: String { String(format: "%02x/%02x", service, command) }
    }

    private let lock = NSLock()
    private var _requests: [Request] = []
    private var assembler = PacketAssembler()
    private var session: HuaweiSession?
    var responder: (Request) -> [Bytes] = { _ in [] }

    func attach(_ session: HuaweiSession) { lock.locked { self.session = session } }
    var requests: [Request] { lock.locked { _requests } }
    var keys: [String] { requests.map(\.key) }
    func count(_ key: String) -> Int { keys.filter { $0 == key }.count }
    func clear() { lock.locked { _requests = [] } }

    func write(_ frames: [Bytes]) async throws {
        for frame in frames { try handle(frame) }
    }

    private func handle(_ frame: Bytes) throws {
        guard let session = lock.locked({ self.session }) else { throw WearError(.notConnected, "no session") }
        var local = lock.locked { assembler }
        let result = try local.feed(frame, params: session.params)
        lock.locked { assembler = local }
        guard let packet = result.packet else { return }
        let request = Request(service: packet.serviceId, command: packet.commandId, tlv: packet.tlv ?? HuaweiTLV(), encrypted: packet.isEncrypted)
        lock.locked { _requests.append(request) }
        for response in responder(request) { session.onData(response) }
    }

    static func tlvFrame(service: UInt8, command: UInt8, _ tlv: HuaweiTLV) -> Bytes {
        var buffer = Bytes([huaweiMagic])
        let body = tlv.serialize()
        buffer.appendBE(UInt16(2 + body.count + 1))
        buffer.append(0x00)
        buffer.append(service)
        buffer.append(command)
        buffer += body
        buffer.appendBE(CRC16.checksum(buffer))
        return buffer
    }

    /// A watch that answers like the Fit 4 Pro: start ok, every support bitmap full, an ok code for everything else.
    func answerLikeAFit4Pro() {
        responder = { request in
            // The phone's acknowledgement of a watch message (0f/04) is not answered.
            if request.service == 0x0F && request.command == 0x04 { return [] }
            var tlv = HuaweiTLV()
            switch (request.service, request.command) {
            case (0x0F, 0x09): tlv.put(0x7F, int: 0x000186A0)
            case (0x0F, 0x02): tlv.put(0x01, byte: 0xFF)
            case (0x0F, 0x06): tlv.put(0x01, short: 0x07)
            case (0x0F, 0x0A): tlv.put(0x01, int: 3)
            default: tlv.put(0x7F, int: 0x000186A0)
            }
            return [WeatherScriptedWatch.tlvFrame(service: request.service, command: request.command, tlv)]
        }
    }
}

/// A live connection without Bluetooth: a session wired to a `WeatherScriptedWatch`, with the capabilities the Fit 4 Pro reports for weather.
final class FakeLink: LinkHandleProvider, @unchecked Sendable {
    let watch = WeatherScriptedWatch()
    let session: HuaweiSession
    let caps = DeviceCaps()
    let handleValue: LinkHandle
    private let lock = NSLock()
    private var connected = false

    init(events: RecordingEvents, commands: [Int: Bytes] = [0x0F: [0x01, 0x02, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0C], 0x18: [0x06]], expandBits: [Int] = [0x2F, 0xC0]) {
        session = HuaweiSession(sink: watch, log: events.sink)
        session.params.secretKey = Bytes(repeating: 0, count: 16)
        session.params.encryptMethod = 0
        session.params.deviceSupportType = 1
        watch.attach(session)
        caps.supportedCommands = commands
        var map = Bytes(repeating: 0, count: 32)
        for bit in expandBits { map[bit / 8] |= UInt8(1 << (bit % 8)) }
        caps.expandCapabilities = map
        handleValue = LinkHandle(address: "A", session: session, caps: caps, operationLock: AsyncLock())
        watch.answerLikeAFit4Pro()
    }

    func setConnected(_ value: Bool) { lock.locked { connected = value } }
    func handle() -> LinkHandle? { lock.locked { connected } ? handleValue : nil }

    /// The watch pushes a weather message (0f/04) with TLV 0x7F = `code`.
    func watchSends(code: Int32) {
        var tlv = HuaweiTLV()
        tlv.put(0x7F, int: code)
        session.onData(WeatherScriptedWatch.tlvFrame(service: 0x0F, command: 0x04, tlv))
    }
}

/// A clock and a sleeper the test drives: `sleep` suspends until `fire()` (or its task is cancelled) and records the delay it was asked for.
final class ManualClock: @unchecked Sendable {
    private let lock = NSLock()
    private var seconds: Int64
    private var waiters: [(id: Int, continuation: CheckedContinuation<Void, Error>)] = []
    private var nextId = 0
    private var _delays: [Int] = []

    init(startSec: Int64) { seconds = startSec }

    var nowSec: Int64 { lock.locked { seconds } }
    func now() -> Date { Date(timeIntervalSince1970: TimeInterval(nowSec)) }
    func advance(_ sec: Int64) { lock.locked { seconds += sec } }
    var delays: [Int] { lock.locked { _delays } }
    var sleeping: Int { lock.locked { waiters.count } }

    func sleep(_ ms: Int) async throws {
        let id: Int = lock.locked {
            nextId += 1
            _delays.append(ms)
            return nextId
        }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
                lock.locked { waiters.append((id, c)) }
                if Task.isCancelled { cancel(id) }
            }
        } onCancel: {
            cancel(id)
        }
    }

    private func cancel(_ id: Int) {
        let waiter: CheckedContinuation<Void, Error>? = lock.locked {
            guard let index = waiters.firstIndex(where: { $0.id == id }) else { return nil }
            return waiters.remove(at: index).continuation
        }
        waiter?.resume(throwing: CancellationError())
    }

    /// The timer elapses.
    func fire() {
        let all: [CheckedContinuation<Void, Error>] = lock.locked {
            let w = waiters.map(\.continuation)
            waiters = []
            return w
        }
        for waiter in all { waiter.resume() }
    }
}

final class FakeLocation: LocationSource, @unchecked Sendable {
    private let lock = NSLock()
    private var _authorization: LocationAuthorization
    private var _prompts = 0
    private var _fixRequests = 0
    private var _nameRequests = 0
    var grantOnPrompt = true
    var last: LocationFix?
    var fresh: LocationFix?
    /// Never answers the fresh-fix request (until cancelled).
    var hangFix = false
    var name: String?

    init(_ authorization: LocationAuthorization) { _authorization = authorization }

    var authorization: LocationAuthorization { lock.locked { _authorization } }
    var prompts: Int { lock.locked { _prompts } }
    var fixRequests: Int { lock.locked { _fixRequests } }
    var nameRequests: Int { lock.locked { _nameRequests } }

    func requestAuthorization() async -> LocationAuthorization {
        lock.locked {
            if _authorization == .notDetermined {
                _prompts += 1
                _authorization = grantOnPrompt ? .granted : .denied
            }
            return _authorization
        }
    }

    func lastKnown() async -> LocationFix? { last }

    func currentFix() async -> LocationFix? {
        lock.locked { _fixRequests += 1 }
        if hangFix {
            try? await Task.sleep(nanoseconds: 60_000_000_000)
            return nil
        }
        return fresh
    }

    func placeName(latitude: Double, longitude: Double) async -> String? {
        lock.locked { _nameRequests += 1 }
        return name
    }
}

/// Canned Open-Meteo answers, recording the URLs asked for.
final class FakeOpenMeteo: @unchecked Sendable {
    private let lock = NSLock()
    private var _urls: [String] = []
    var forecast: String
    var geocoding: String
    var failure: Error?

    init() {
        let dir = repoRoot.appendingPathComponent("modules/huawei-wear/ios/HuaweiProtocol/Tests/HuaweiProtocolTests/Fixtures")
        forecast = try! String(contentsOf: dir.appendingPathComponent("openmeteo_forecast_bandung.json"), encoding: .utf8)
        geocoding = try! String(contentsOf: dir.appendingPathComponent("openmeteo_geocoding_bandung.json"), encoding: .utf8)
    }

    var urls: [String] { lock.locked { _urls } }
    var forecastRequests: [String] { urls.filter { $0.contains("/v1/forecast") } }

    var fetch: WeatherFetch {
        { [self] url in
            lock.locked { _urls.append(url) }
            if let failure { throw failure }
            return url.contains("geocoding-api") ? geocoding : forecast
        }
    }
}

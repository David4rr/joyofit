// Port of the protocol half of StressSwitch.kt (GB SetStressRequest, HuaweiSupportProvider.setStress): the watch's automatic stress switch
// (service 0x20, command 0x09). The watch only turns it on together with a stress calibration computed on the phone from a minute of RR
// intervals: status 1, the score, 12 float features and the time of the measurement. Status 2 turns it off.
import Foundation

public enum StressSwitchProtocol {
    /// How long the watch's answer is waited for; GB does not wait for one, so none within this time is not an error.
    public static let answerMs = 5_000

    /// Tag 0x7f of an answer: absent or this means accepted (`HuaweiConstants.RESULT_SUCCESS_INT`).
    public static let successCode: Int32 = 100_000

    /// `HuaweiState`: the watch lists the automatic stress command (20/09).
    public static func supported(_ caps: DeviceCaps) -> Bool { caps.supports(Int(Stress.id), Int(Stress.AutomaticStress.id)) }

    /// `20/09` and the watch's answer, logged. A watch that answers with an error code rejects with `ERR_STRESS_REJECTED`.
    public static func transmit(session: HuaweiSession, log: LogSink, status: UInt8, data: StressData?, answerMs: Int = answerMs) async throws {
        let request = Stress.AutomaticStress.request(
            status: status, score: UInt8(bitPattern: data?.score ?? 0), features: data?.features, time: Int32(truncatingIfNeeded: (data?.endTime ?? 0) / 1000)
        )
        let label = status == 1 ? "AutomaticStress on (20/09)" : "AutomaticStress off (20/09)"
        let answer = Promise<HuaweiPacket?>()
        let subscription = await session.subscribe(service: Stress.id, command: Stress.AutomaticStress.id, label: "automatic stress answer") { answer.complete(.success($0)) }
        defer { Task { await session.unsubscribe(subscription) } }
        try await session.send(request, label: label)
        let timer = Task {
            try await Task.sleep(nanoseconds: UInt64(max(answerMs, 0)) * 1_000_000)
            answer.complete(.success(nil))
        }
        defer { timer.cancel() }
        let reply = try await withTaskCancellationHandler {
            try await answer.value()
        } onCancel: {
            answer.complete(.failure(CancellationError()))
        }
        guard let reply else {
            log(LogEntry(.info, "\(label): the watch did not answer within \(answerMs / 1000) s (GB does not wait for an answer either)"))
            return
        }
        let tlv = reply.tlv
        let code: Int32? = (tlv?.contains(0x7f) ?? false) ? try? tlv?.int(0x7f) : nil
        log(LogEntry(.info, "\(label): the watch answered tlv=\(tlv.map { "\($0)" } ?? "nil")"))
        if let code, code != successCode {
            throw WearError(.stressRejected, "The watch refused the automatic stress setting (code \(code))")
        }
    }
}

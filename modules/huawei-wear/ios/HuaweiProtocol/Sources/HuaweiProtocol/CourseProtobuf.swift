// Port of CourseProtobuf.kt and FitnessCourseService.kt: the running course Huawei Health pushes to `in.huawei.fitness` (P2P module `fitness`).
// Huawei Health writes `<messageId>courseInfo.bin` = a 36-byte little-endian message header (`P2PSubMsg`) + a `CourseStorageInfo` protobuf and
// sends it as a P2P file. EXPERIMENTAL and UNVERIFIED on the wire: everything here is based on Huawei Health 17.0.8.300's observed behaviour.
//
// course.proto (proto2, every field `required`, reconstructed to match the wire format):
//   message CourseStorageInfo {
//     required string exerciseId = 1;           repeated uint32 exerciseName = 2;   // the name's UTF-8 bytes, one varint each
//     required uint32 totalMeasurementType = 3; required uint32 totalMeasurementValue = 4;
//     required string exerciseVersion = 5;      required uint32 difficult = 6;      required uint32 usingType = 7;
//     required uint32 updateTime = 8;           required uint32 defineType = 9;     required uint32 courseType = 10;
//     required uint32 actionTotalNum = 11;      repeated CombineInfo combineInfo = 12;
//     message ActionInfo  { required string actionId = 1; required uint32 measurementType = 2; required uint32 measurementValue = 3;
//                           required uint32 instensityType = 4; required uint32 instensityValueH = 5; required uint32 instensityValueL = 6; }
//     message CombineInfo { required uint32 repeatNum = 1; required uint32 actionNum = 2; repeated ActionInfo actionInfo = 3; }
//   }
import Foundation

public enum CourseStepKind: String, CaseIterable, Sendable {
    case warmup, run, walk, rest, cooldown

    public var actionId: String {
        switch self {
        case .warmup: return "RD001"
        case .run: return "RD002"
        case .walk: return "RD003"
        case .rest: return "RD004"
        case .cooldown: return "RD005"
        }
    }

    public init?(wire: String) { self.init(rawValue: wire) }
}

/// `TypeConfig` target ids.
public enum CourseTarget: String, CaseIterable, Sendable {
    case time, distance, none

    public var id: Int {
        switch self {
        case .time: return 1
        case .distance: return 0
        case .none: return 255
        }
    }

    public init?(wire: String) { self.init(rawValue: wire) }
}

/// `TypeConfig` intensity ids the editor offers.
public enum CourseIntensity: String, CaseIterable, Sendable {
    case none
    /// Seconds per kilometre, sent as milliseconds per kilometre; low = the faster bound.
    case pace
    /// Percent of maximum heart rate, 20 to 100.
    case hrPercent
    /// Steps per minute, 100 to 300.
    case cadence

    public var id: Int {
        switch self {
        case .none: return 255
        case .pace: return 15
        case .hrPercent: return 1
        case .cadence: return 16
        }
    }

    public init?(wire: String) { self.init(rawValue: wire) }
}

public struct CourseStep: Equatable, Sendable {
    public var kind: CourseStepKind
    public var target: CourseTarget
    /// Seconds for `.time`, metres for `.distance`, 0 for none.
    public var targetValue: Int
    public var intensity: CourseIntensity
    /// Lower and upper bound in the unit of `intensity` (pace: seconds per km; the faster one is `low`).
    public var low: Int
    public var high: Int

    public init(kind: CourseStepKind, target: CourseTarget, targetValue: Int, intensity: CourseIntensity = .none, low: Int = 0, high: Int = 0) {
        self.kind = kind
        self.target = target
        self.targetValue = targetValue
        self.intensity = intensity
        self.low = low
        self.high = high
    }
}

/// `steps` repeated `repeat` times; a single step with repeat 1 is a plain action.
public struct CourseBlock: Equatable, Sendable {
    public var repeatCount: Int
    public var steps: [CourseStep]

    public init(repeatCount: Int, steps: [CourseStep]) {
        self.repeatCount = repeatCount
        self.steps = steps
    }
}

public struct RunningCourse: Equatable, Sendable {
    public var id: String
    public var name: String
    public var blocks: [CourseBlock]

    public init(id: String, name: String, blocks: [CourseBlock]) {
        self.id = id
        self.name = name
        self.blocks = blocks
    }

    public var actionCount: Int { blocks.reduce(0) { $0 + $1.steps.count } }
}

public enum CourseProtobuf {
    public static let businessCustomCourse = 3
    public static let courseTypeNewRun = 4
    public static let defineTypeCustom = 1
    public static let usingTypeSingle = 0
    public static let exerciseVersion = "2.0"
    public static let maxActions = 100
    private static let maxNameBytes = 64

    /// Validates what the editor sends; the message is shown to the user.
    public static func validate(_ course: RunningCourse) throws {
        func bad(_ what: String) -> WearError { WearError(.invalidArgument, what) }
        if course.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw bad("Give the course a name") }
        if course.name.utf8.count > maxNameBytes { throw bad("The course name is too long") }
        if course.blocks.isEmpty { throw bad("The course needs at least one step") }
        if course.actionCount > maxActions { throw bad("A course can have at most \(maxActions) steps") }
        for block in course.blocks {
            if block.steps.isEmpty { throw bad("A repeated group has no steps") }
            if !(1...99).contains(block.repeatCount) { throw bad("A group repeats 1 to 99 times") }
            for step in block.steps {
                switch step.target {
                case .time: if !(1...86_400).contains(step.targetValue) { throw bad("A time target is 1 s to 24 h") }
                case .distance: if !(1...100_000).contains(step.targetValue) { throw bad("A distance target is 1 m to 100 km") }
                case .none: break
                }
                switch step.intensity {
                case .none: break
                case .pace:
                    if !(60...900).contains(step.low) || !(60...900).contains(step.high) { throw bad("A pace bound is 1:00 to 15:00 per km") }
                    if step.low > step.high { throw bad("The faster pace must come first") }
                case .hrPercent:
                    if !(20...100).contains(step.low) || !(20...100).contains(step.high) { throw bad("A heart-rate bound is 20 to 100 % of the maximum") }
                    if step.low > step.high { throw bad("The lower heart rate must come first") }
                case .cadence:
                    if !(100...300).contains(step.low) || !(100...300).contains(step.high) { throw bad("A cadence bound is 100 to 300 steps per minute") }
                    if step.low > step.high { throw bad("The lower cadence must come first") }
                }
            }
        }
    }

    /// The course's total: seconds when every step has a time target, metres when every step has a distance target, else none.
    public static func total(_ course: RunningCourse) -> (target: CourseTarget, value: Int) {
        var steps = [CourseStep]()
        for block in course.blocks { for _ in 0..<block.repeatCount { steps.append(contentsOf: block.steps) } }
        if steps.allSatisfy({ $0.target == .time }) { return (.time, steps.reduce(0) { $0 + $1.targetValue }) }
        if steps.allSatisfy({ $0.target == .distance }) { return (.distance, steps.reduce(0) { $0 + $1.targetValue }) }
        return (.none, 0)
    }

    public static func encodeAction(_ step: CourseStep) -> Bytes {
        let low: Int
        let high: Int
        switch step.intensity {
        case .none:
            low = 0
            high = 0
        case .pace:
            low = step.low * 1000
            high = step.high * 1000
        default:
            low = step.low
            high = step.high
        }
        return PbWriter()
            .stringField(1, step.kind.actionId)
            .intField(2, step.target.id)
            .intField(3, step.target == .none ? 0 : step.targetValue)
            .intField(4, step.intensity.id)
            .intField(5, high)
            .intField(6, low)
            .toBytes()
    }

    public static func encodeCombine(_ block: CourseBlock) -> Bytes {
        let w = PbWriter().intField(1, block.repeatCount).intField(2, block.steps.count)
        for step in block.steps { w.bytesField(3, encodeAction(step)) }
        return w.toBytes()
    }

    /// `CourseStorageInfo`. `updateTimeSec` is the course's publish / modify time.
    public static func encode(_ course: RunningCourse, updateTimeSec: Int) -> Bytes {
        let (totalType, totalValue) = total(course)
        let w = PbWriter().stringField(1, course.id)
        for b in course.name.utf8 { w.intField(2, Int(b)) }
        w.intField(3, totalType.id)
            .intField(4, totalValue)
            .stringField(5, exerciseVersion)
            .intField(6, 0)
            .intField(7, usingTypeSingle)
            .intField(8, updateTimeSec)
            .intField(9, defineTypeCustom)
            .intField(10, courseTypeNewRun)
            .intField(11, course.actionCount)
        for block in course.blocks { w.bytesField(12, encodeCombine(block)) }
        return w.toBytes()
    }

    /// The 36-byte header (businessType, version 1, totalLength, businessHeadLength 0, messageId; little endian) followed by `payload`.
    public static func message(businessType: Int, messageId: Int, payload: Bytes) -> Bytes {
        P2PSubMsg(type: businessType, messageId: messageId, data: payload).bytes
    }

    public static func fileName(_ messageId: Int) -> String { "\(messageId)courseInfo.bin" }
}

/// One value delivered once, awaited with cancellation: completing it after a cancel is ignored.
public final class P2PWaiter<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<T, Error>?
    private var continuation: CheckedContinuation<T, Error>?

    public init() {}

    public func complete(_ value: T) { finish(.success(value)) }

    public func cancel() { finish(.failure(CancellationError())) }

    private func finish(_ r: Result<T, Error>) {
        lock.lock()
        if result != nil { lock.unlock(); return }
        result = r
        let c = continuation
        continuation = nil
        lock.unlock()
        c?.resume(with: r)
    }

    /// Throws `CancellationError` when the waiter was cancelled or the awaiting task is.
    public func value() async throws -> T {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<T, Error>) in
                lock.lock()
                if let r = result {
                    lock.unlock()
                    c.resume(with: r)
                } else {
                    continuation = c
                    lock.unlock()
                }
            }
        } onCancel: {
            self.cancel()
        }
    }
}

/// `withTimeoutOrNull`: the value of `operation`, or nil when it takes longer than `ms` (or is cancelled).
public func p2pWithTimeout<T: Sendable>(ms: Int, _ operation: @escaping @Sendable () async throws -> T) async -> T? {
    await withTaskGroup(of: T?.self) { group in
        group.addTask { try? await operation() }
        group.addTask {
            try? await Task.sleep(nanoseconds: UInt64(max(ms, 0)) * 1_000_000)
            return nil
        }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
    }
}

/// P2P module `fitness` (watch package `in.huawei.fitness`, fingerprint `SystemApp`; GB's `HuaweiP2PFitnessData` uses the same triple for
/// trajectories). The phone side of a course push is a P2P file; the watch answers with a message of the same business type and message id.
/// What the answer's body means is not known, so it is only logged and returned to JS.
public final class FitnessCourseService: P2PService, @unchecked Sendable {
    public static let moduleName = "hw.unitedevice.fitness"
    public static let packageName = "in.huawei.fitness"
    public static let fingerprintValue = "SystemApp"

    private let log: LogSink
    private let lock = NSLock()
    private var _pingCode: Int?
    private var waiting: [Int: P2PWaiter<Bytes>] = [:]
    /// Pending route pushes by business type (5 handshake, 6 file): the watch's answer to a route carries a message id of its own choosing.
    private var waitingRoute: [Int: P2PWaiter<Bytes>] = [:]

    public init(manager: P2PManager, log: @escaping LogSink) {
        self.log = log
        super.init(manager: manager)
    }

    public override var module: String { FitnessCourseService.moduleName }
    public override var package: String { FitnessCourseService.packageName }
    public override var fingerprint: String { FitnessCourseService.fingerprintValue }

    public var pingCode: Int? { lock.p2pLocked { _pingCode } }

    private func note(_ message: String) { log(LogEntry(.info, service: 0x34, command: 0x01, message)) }

    public override func registered() {
        sendPing { [weak self] code, _ in
            self?.lock.p2pLocked { self?._pingCode = code }
            self?.note("Courses: ping of \(FitnessCourseService.packageName) answered \(String(format: "0x%02x", code & 0xFF)) (0xca = the watch app is there)")
        }
    }

    public override func unregister() {
        clearPending()
        let pending = lock.p2pLocked { () -> [P2PWaiter<Bytes>] in
            defer {
                waiting.removeAll()
                waitingRoute.removeAll()
            }
            return Array(waiting.values) + Array(waitingRoute.values)
        }
        for waiter in pending { waiter.cancel() }
    }

    /// Expect the watch's answer for `messageId`; the waiter completes with its body.
    public func expectAnswer(_ messageId: Int) -> P2PWaiter<Bytes> {
        let waiter = P2PWaiter<Bytes>()
        lock.p2pLocked { waiting[messageId] = waiter }
        return waiter
    }

    public func forget(_ messageId: Int) { lock.p2pLocked { _ = waiting.removeValue(forKey: messageId) } }

    /// Expect the watch's message of `businessType` (a route handshake or file answer); the waiter completes with its body.
    public func expectRouteAnswer(_ businessType: Int) -> P2PWaiter<Bytes> {
        let waiter = P2PWaiter<Bytes>()
        lock.p2pLocked { waitingRoute[businessType] = waiter }
        return waiter
    }

    public func forgetRouteAnswer(_ businessType: Int) { lock.p2pLocked { _ = waitingRoute.removeValue(forKey: businessType) } }

    public override func handleData(_ data: Bytes) throws {
        let message = try P2PSubMsg(parsing: data)
        note(
            "Courses: watch message type=\(message.type) version=\(message.version) length=\(message.totalLength) messageId=\(message.messageId) body=\(message.data?.hexUpper ?? "none")"
        )
        if let route = lock.p2pLocked({ waitingRoute.removeValue(forKey: Int(message.type)) }) {
            route.complete(message.data ?? [])
            return
        }
        let pending = lock.p2pLocked { waiting.removeValue(forKey: Int(message.messageId)) }
        guard let pending else {
            note("Courses: no push is waiting for message id \(message.messageId)")
            return
        }
        pending.complete(message.data ?? [])
    }
}

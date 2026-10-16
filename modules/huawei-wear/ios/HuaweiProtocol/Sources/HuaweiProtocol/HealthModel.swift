// Port of HealthModelMessages.kt, HealthModelBuilder.kt and HealthModelService.kt: Healthy Living ("Health Clover" tasks), the P2P module
// `healthmodel`, as Huawei Health 17.0.8.300 speaks it (static analysis of its protobuf descriptors; not yet seen on the wire of a Fit 4).
//
// Messages (all proto3):
//   Request/Report { int32 msgType = 1; float msgVer = 2; bytes msgBody = 3; }
//   RequestBody    { int32 recordDay = 1; string requestTaskIds = 2; int32 pageSize = 3; int32 packageSize = 4; }
//   TaskBody       { int32 resultCode = 1; string resultDes = 2; int32 recordDay = 3; string allTasks = 4; repeated ReportTask tasks = 5;
//                    string completedTasks = 6; bytes cloverProgress = 7; }
//   ReportTask     { int32 taskId = 1; string taskTarget = 2; string targetDes = 3; string taskValue = 4; int32 status = 5; int32 restStatus = 6;
//                    int64 timestamp = 7; int32 taskType = 8; string taskName = 9; string unit = 10; float progress = 11; string statusDes = 12; }
//   CloverProgress { float top = 1; float left = 2; float right = 3; float bottom = 4; }
//   NoticeBody     { repeated ReportNotice notices = 1; }  ReportNotice { int32 recordDay = 1; int32 taskId = 2; string taskName = 3; string msg = 4; }
import Foundation

public enum HealthModelMessages {
    /// The `msgType` the watch sends to ask for the tasks of a day.
    public static let msgTasks = 2001
    public static let msgNoticePush = 2002
    public static let msgNoticeReply = 2003

    /// `Request.msgVer` from which `packageSize` is honoured.
    public static let versionPaging: Float = 3.0

    public struct RequestBody: Equatable, Sendable {
        public var recordDay: Int
        public var requestTaskIds: String
        public var pageSize: Int
        public var packageSize: Int

        public init(recordDay: Int, requestTaskIds: String, pageSize: Int, packageSize: Int) {
            self.recordDay = recordDay
            self.requestTaskIds = requestTaskIds
            self.pageSize = pageSize
            self.packageSize = packageSize
        }
    }

    public struct Request: Equatable, Sendable {
        public var msgType: Int
        public var msgVer: Float
        public var body: Bytes

        public init(msgType: Int, msgVer: Float, body: Bytes) {
            self.msgType = msgType
            self.msgVer = msgVer
            self.body = body
        }
    }

    public struct Task: Equatable, Sendable {
        public var taskId: Int
        public var taskTarget = ""
        public var targetDes = ""
        public var taskValue = ""
        public var status = 0
        public var restStatus = 0
        public var timestamp: Int64 = 0
        public var taskType = 0
        public var taskName = ""
        public var unit = ""
        public var progress: Float = 0
        public var statusDes = ""

        public init(
            taskId: Int, taskTarget: String = "", targetDes: String = "", taskValue: String = "", status: Int = 0, restStatus: Int = 0,
            timestamp: Int64 = 0, taskType: Int = 0, taskName: String = "", unit: String = "", progress: Float = 0, statusDes: String = ""
        ) {
            self.taskId = taskId
            self.taskTarget = taskTarget
            self.targetDes = targetDes
            self.taskValue = taskValue
            self.status = status
            self.restStatus = restStatus
            self.timestamp = timestamp
            self.taskType = taskType
            self.taskName = taskName
            self.unit = unit
            self.progress = progress
            self.statusDes = statusDes
        }
    }

    public struct Clover: Equatable, Sendable {
        public var top: Float
        public var left: Float
        public var right: Float
        public var bottom: Float

        public init(top: Float, left: Float, right: Float, bottom: Float) {
            self.top = top
            self.left = left
            self.right = right
            self.bottom = bottom
        }
    }

    public struct TaskBody: Equatable, Sendable {
        public var resultCode: Int
        public var resultDes: String
        public var recordDay: Int
        public var allTasks: String
        public var tasks: [Task]
        public var completedTasks: String
        public var clover: Clover?

        public init(resultCode: Int, resultDes: String, recordDay: Int, allTasks: String, tasks: [Task], completedTasks: String, clover: Clover?) {
            self.resultCode = resultCode
            self.resultDes = resultDes
            self.recordDay = recordDay
            self.allTasks = allTasks
            self.tasks = tasks
            self.completedTasks = completedTasks
            self.clover = clover
        }
    }

    public struct Notice: Equatable, Sendable {
        public var recordDay: Int
        public var taskId: Int
        public var taskName: String
        public var msg: String

        public init(recordDay: Int, taskId: Int, taskName: String, msg: String) {
            self.recordDay = recordDay
            self.taskId = taskId
            self.taskName = taskName
            self.msg = msg
        }
    }

    public static func decodeRequest(_ data: Bytes) throws -> Request {
        var type = 0
        var ver: Float = 0
        var body = Bytes()
        for f in try PbReader.fields(data) {
            switch f.number {
            case 1: type = f.asInt()
            case 2: ver = f.asFloat()
            case 3: body = f.bytes ?? []
            default: break
            }
        }
        return Request(msgType: type, msgVer: ver, body: body)
    }

    public static func decodeRequestBody(_ data: Bytes) throws -> RequestBody {
        var day = 0
        var ids = ""
        var page = 0
        var pkg = 0
        for f in try PbReader.fields(data) {
            switch f.number {
            case 1: day = f.asInt()
            case 2: ids = f.asString()
            case 3: page = f.asInt()
            case 4: pkg = f.asInt()
            default: break
            }
        }
        return RequestBody(recordDay: day, requestTaskIds: ids, pageSize: page, packageSize: pkg)
    }

    public static func encodeRequest(msgType: Int, msgVer: Float, body: Bytes) -> Bytes {
        PbWriter().intFieldUnlessZero(1, msgType).floatFieldUnlessZero(2, msgVer).bytesFieldUnlessEmpty(3, body).toBytes()
    }

    public static func encodeRequestBody(_ body: RequestBody) -> Bytes {
        PbWriter()
            .intFieldUnlessZero(1, body.recordDay)
            .stringFieldUnlessEmpty(2, body.requestTaskIds)
            .intFieldUnlessZero(3, body.pageSize)
            .intFieldUnlessZero(4, body.packageSize)
            .toBytes()
    }

    /// `HealthModelReportMessage.Report`, the same layout as `encodeRequest`.
    public static func encodeReport(msgType: Int, msgVer: Float, body: Bytes) -> Bytes { encodeRequest(msgType: msgType, msgVer: msgVer, body: body) }

    public static func decodeReport(_ data: Bytes) throws -> Request { try decodeRequest(data) }

    public static func encodeTask(_ task: Task) -> Bytes {
        PbWriter()
            .intFieldUnlessZero(1, task.taskId)
            .stringFieldUnlessEmpty(2, task.taskTarget)
            .stringFieldUnlessEmpty(3, task.targetDes)
            .stringFieldUnlessEmpty(4, task.taskValue)
            .intFieldUnlessZero(5, task.status)
            .intFieldUnlessZero(6, task.restStatus)
            .longFieldUnlessZero(7, task.timestamp)
            .intFieldUnlessZero(8, task.taskType)
            .stringFieldUnlessEmpty(9, task.taskName)
            .stringFieldUnlessEmpty(10, task.unit)
            .floatFieldUnlessZero(11, task.progress)
            .stringFieldUnlessEmpty(12, task.statusDes)
            .toBytes()
    }

    public static func decodeTask(_ data: Bytes) throws -> Task {
        var task = Task(taskId: 0)
        for f in try PbReader.fields(data) {
            switch f.number {
            case 1: task.taskId = f.asInt()
            case 2: task.taskTarget = f.asString()
            case 3: task.targetDes = f.asString()
            case 4: task.taskValue = f.asString()
            case 5: task.status = f.asInt()
            case 6: task.restStatus = f.asInt()
            case 7: task.timestamp = f.value
            case 8: task.taskType = f.asInt()
            case 9: task.taskName = f.asString()
            case 10: task.unit = f.asString()
            case 11: task.progress = f.asFloat()
            case 12: task.statusDes = f.asString()
            default: break
            }
        }
        return task
    }

    public static func encodeClover(_ clover: Clover) -> Bytes {
        PbWriter()
            .floatFieldUnlessZero(1, clover.top)
            .floatFieldUnlessZero(2, clover.left)
            .floatFieldUnlessZero(3, clover.right)
            .floatFieldUnlessZero(4, clover.bottom)
            .toBytes()
    }

    public static func decodeClover(_ data: Bytes) throws -> Clover {
        var clover = Clover(top: 0, left: 0, right: 0, bottom: 0)
        for f in try PbReader.fields(data) {
            switch f.number {
            case 1: clover.top = f.asFloat()
            case 2: clover.left = f.asFloat()
            case 3: clover.right = f.asFloat()
            case 4: clover.bottom = f.asFloat()
            default: break
            }
        }
        return clover
    }

    public static func encodeTaskBody(_ body: TaskBody) -> Bytes {
        let w = PbWriter()
            .intFieldUnlessZero(1, body.resultCode)
            .stringFieldUnlessEmpty(2, body.resultDes)
            .intFieldUnlessZero(3, body.recordDay)
            .stringFieldUnlessEmpty(4, body.allTasks)
        for task in body.tasks { w.bytesField(5, encodeTask(task)) }
        w.stringFieldUnlessEmpty(6, body.completedTasks)
        if let clover = body.clover { w.bytesFieldUnlessEmpty(7, encodeClover(clover)) }
        return w.toBytes()
    }

    public static func decodeTaskBody(_ data: Bytes) throws -> TaskBody {
        var body = TaskBody(resultCode: 0, resultDes: "", recordDay: 0, allTasks: "", tasks: [], completedTasks: "", clover: nil)
        for f in try PbReader.fields(data) {
            switch f.number {
            case 1: body.resultCode = f.asInt()
            case 2: body.resultDes = f.asString()
            case 3: body.recordDay = f.asInt()
            case 4: body.allTasks = f.asString()
            case 5: body.tasks.append(try decodeTask(f.bytes ?? []))
            case 6: body.completedTasks = f.asString()
            case 7: body.clover = try decodeClover(f.bytes ?? [])
            default: break
            }
        }
        return body
    }

    public static func encodeNoticeBody(_ notices: [Notice]) -> Bytes {
        let w = PbWriter()
        for n in notices {
            w.bytesField(
                1,
                PbWriter().intFieldUnlessZero(1, n.recordDay).intFieldUnlessZero(2, n.taskId).stringFieldUnlessEmpty(3, n.taskName).stringFieldUnlessEmpty(4, n.msg)
                    .toBytes()
            )
        }
        return w.toBytes()
    }
}

/// What JoyoFit knows about one local day, as the Healthy Living tasks need it. Nil = no data / not tracked.
public struct HealthDay: Equatable, Sendable {
    /// `yyyyMMdd`, Huawei's `recordDay`.
    public var recordDay: Int
    public var steps: Int
    public var stepGoal: Int
    /// Minutes of workout sessions that day.
    public var exerciseMinutes: Int
    /// Seconds of sleep that ended that day (night + naps), nil when no sleep was stored.
    public var sleepSeconds: Int?
    public var intakeKcal: Double?
    public var weightKg: Double?
    public var bloodPressure: Bool
    /// A stress / emotion reading from the watch exists that day.
    public var stressMeasured: Bool
    /// Unix ms of the newest data point behind the tasks, the `timestamp` field of the tasks.
    public var timestampMs: Int64

    public init(
        recordDay: Int, steps: Int, stepGoal: Int, exerciseMinutes: Int, sleepSeconds: Int?, intakeKcal: Double?, weightKg: Double?, bloodPressure: Bool,
        stressMeasured: Bool, timestampMs: Int64
    ) {
        self.recordDay = recordDay
        self.steps = steps
        self.stepGoal = stepGoal
        self.exerciseMinutes = exerciseMinutes
        self.sleepSeconds = sleepSeconds
        self.intakeKcal = intakeKcal
        self.weightKg = weightKg
        self.bloodPressure = bloodPressure
        self.stressMeasured = stressMeasured
        self.timestampMs = timestampMs
    }
}

/// The goals Huawei Health's Healthy Living plan would hold; JoyoFit has no goal editor for them, so they are fixed.
public struct HealthGoals: Equatable, Sendable {
    public static let defaultExerciseMinutes = 30
    public static let defaultSleepSeconds = 8 * 3600
    public static let defaultIntakeKcal = 2000

    public var exerciseMinutes: Int
    public var sleepSeconds: Int
    public var intakeKcal: Int

    public init(exerciseMinutes: Int = defaultExerciseMinutes, sleepSeconds: Int = defaultSleepSeconds, intakeKcal: Int = defaultIntakeKcal) {
        self.exerciseMinutes = exerciseMinutes
        self.sleepSeconds = sleepSeconds
        self.intakeKcal = intakeKcal
    }
}

/// Builds the TaskBody the watch's Healthy Living app asks for as Huawei Health 17.0.8.300 builds it. Task ids are the wear ids.
///
/// | id | task | value / target |
/// |---|---|---|
/// | 1 | perfect clover (`status` = every other task done, `taskTarget` = their ids written one after the other) | |
/// | 2 | steps | steps / goal; `progress` = `max(value / target, 0.1)` |
/// | 3 | exercise minutes | minutes / goal |
/// | 18 | sleep duration | seconds / goal seconds |
/// | 17 | calorie intake | kcal / goal |
/// | 14 | weight measurement | times done / 1 |
/// | 12 | blood pressure measurement | times done / 1 |
///
/// Water (10) is left out: JoyoFit does not record water. Everything about the values is Huawei's layout read from code; what the watch draws
/// from it is UNVERIFIED.
public enum HealthModelBuilder {
    public static let taskPerfectClover = 1
    public static let taskSteps = 2
    public static let taskExercise = 3
    public static let taskWater = 10
    public static let taskBloodPressure = 12
    public static let taskWeight = 14
    public static let taskIntake = 17
    public static let taskSleep = 18

    private static let minPageBytes = 64
    /// Tag + length bytes of a `tasks` entry inside TaskBody and the extra length byte of the Report's `msgBody`.
    private static let taskFieldOverhead = 4

    public static func build(day: HealthDay, goals: HealthGoals, requestedIds: Set<Int>?) -> HealthModelMessages.TaskBody {
        typealias Task = HealthModelMessages.Task
        var all = [Task]()
        let ts = day.timestampMs

        let stepGoal = max(day.stepGoal, 1)
        let stepRatio = Float(day.steps) / Float(stepGoal)
        all.append(
            Task(
                taskId: taskSteps, taskTarget: String(stepGoal), taskValue: String(day.steps), status: day.steps >= stepGoal ? 1 : 0, timestamp: ts, taskType: 1,
                taskName: "Steps", progress: stepRatio <= 0 ? 0 : max(stepRatio, 0.1), statusDes: "\(day.steps)/\(stepGoal)"
            )
        )
        all.append(
            Task(
                taskId: taskExercise, taskTarget: String(goals.exerciseMinutes), taskValue: String(day.exerciseMinutes),
                status: day.exerciseMinutes >= goals.exerciseMinutes ? 1 : 0, timestamp: ts, taskType: 0, taskName: "Exercise",
                statusDes: "\(day.exerciseMinutes)/\(goals.exerciseMinutes) min"
            )
        )
        if let sleep = day.sleepSeconds {
            all.append(
                Task(
                    taskId: taskSleep, taskTarget: String(goals.sleepSeconds), taskValue: String(sleep), status: sleep >= goals.sleepSeconds ? 1 : 0, timestamp: ts,
                    taskName: "Sleep", statusDes: String(format: "%.1f/%.1f h", Double(sleep) / 3600.0, Double(goals.sleepSeconds) / 3600.0)
                )
            )
        }
        if let kcal = day.intakeKcal {
            let eaten = Int(kcal)
            all.append(
                Task(
                    taskId: taskIntake, taskTarget: String(goals.intakeKcal), taskValue: String(eaten), status: eaten > 0 ? 1 : 0, timestamp: ts, taskName: "Calorie intake",
                    statusDes: "\(eaten)/\(goals.intakeKcal) kcal"
                )
            )
        }
        if day.weightKg != nil {
            all.append(Task(taskId: taskWeight, taskTarget: "1", taskValue: "1", status: 1, timestamp: ts, taskName: "Weight", statusDes: "1/1"))
        }
        if day.bloodPressure {
            all.append(Task(taskId: taskBloodPressure, taskTarget: "1", taskValue: "1", status: 1, timestamp: ts, taskName: "Blood pressure", statusDes: "1/1"))
        }

        let perfect = Task(
            taskId: taskPerfectClover, taskTarget: all.map { String($0.taskId) }.joined(), status: all.allSatisfy { $0.status > 0 } ? 1 : 0, taskName: "Perfect clover"
        )
        let withClover = [perfect] + all
        let shown = (requestedIds == nil || requestedIds!.isEmpty) ? withClover : withClover.filter { requestedIds!.contains($0.taskId) }

        return HealthModelMessages.TaskBody(
            resultCode: 0, resultDes: "", recordDay: day.recordDay,
            // allTasks is "1," + the wear id of every task of the day; completedTasks lists the finished ones.
            allTasks: withClover.map { String($0.taskId) }.joined(separator: ","), tasks: shown,
            completedTasks: all.filter { $0.status > 0 }.map { String($0.taskId) }.joined(separator: ","), clover: clover(day: day, goals: goals, stepRatio: stepRatio)
        )
    }

    /// The three leaves of a watch without ExpandCapability 303: top = steps value / target (capped at 1); left = sleep seconds / sleep goal
    /// (capped at 1); right = 1 when a stress reading exists that day, else 0. (UNVERIFIED substitution for Huawei's plans.)
    public static func clover(day: HealthDay, goals: HealthGoals, stepRatio: Float? = nil) -> HealthModelMessages.Clover {
        let ratio = stepRatio ?? Float(day.steps) / Float(max(day.stepGoal, 1))
        let top = min(1, max(ratio, 0))
        let left = day.sleepSeconds.map { min(1, Float($0) / Float(goals.sleepSeconds)) } ?? 0
        let right: Float = day.stressMeasured ? 1 : 0
        return HealthModelMessages.Clover(top: top, left: left, right: right, bottom: 0)
    }

    /// Splits `body` into reports no bigger than the watch's `packageSize`: every page repeats the header fields and clover, tasks fill the page
    /// until the next one would not fit. Huawei measures the size in hex characters of the serialized bytes, so half of `packageSize` is the byte
    /// budget. `packageSize` <= 0 sends one report.
    public static func reports(body: HealthModelMessages.TaskBody, msgVer: Float, packageSize: Int) -> [Bytes] {
        let budget = packageSize <= 0 ? Int(Int32.max) : max(packageSize / 2, minPageBytes)
        var pages = [Bytes]()
        var remaining = body.tasks
        func pageBody(_ tasks: [HealthModelMessages.Task]) -> HealthModelMessages.TaskBody {
            HealthModelMessages.TaskBody(
                resultCode: body.resultCode, resultDes: body.resultDes, recordDay: body.recordDay, allTasks: body.allTasks, tasks: tasks,
                completedTasks: body.completedTasks, clover: body.clover
            )
        }
        repeat {
            var page = [HealthModelMessages.Task]()
            var used = HealthModelMessages.encodeReport(
                msgType: HealthModelMessages.msgTasks, msgVer: msgVer, body: HealthModelMessages.encodeTaskBody(pageBody([]))
            ).count
            while !remaining.isEmpty {
                let size = HealthModelMessages.encodeTask(remaining[0]).count + taskFieldOverhead
                if !page.isEmpty && used + size >= budget { break }
                page.append(remaining.removeFirst())
                used += size
            }
            pages.append(
                HealthModelMessages.encodeReport(msgType: HealthModelMessages.msgTasks, msgVer: msgVer, body: HealthModelMessages.encodeTaskBody(pageBody(page)))
            )
        } while !remaining.isEmpty
        return pages
    }
}

/// What `HealthModelService` keeps between requests; the app stores it in UserDefaults, tests use memory.
public protocol HealthLivingState: AnyObject, Sendable {
    var healthLivingEnabled: Bool { get set }
    var healthLivingMsgVer: Float { get set }
    var healthLivingPackageSize: Int { get set }
    var healthLivingLastRequestMs: Int64 { get set }
    var healthLivingLastReportMs: Int64 { get set }
    var healthLivingLastSummary: String? { get set }
}

/// P2P module `healthmodel` (Healthy Living / Health Clover tasks): module `hw.unitedevice.healthmodel`, watch package
/// `com.huawei.health.healthyliving`. Flow:
///  1. The watch sends a P2P data packet holding a `Request` with `msgType` 2001; its body has the day, the task ids wanted, `pageSize` and, from
///     `msgVer` 3.0 on, `packageSize`.
///  2. The phone answers with one or more `Report`s (`msgType` 2001, same `msgVer`), each a P2P data packet to the same package.
///  3. Unasked, Huawei Health pings the watch app (answer 0xca), waits a second and sends the day again when its data changed; it only does so
///     once a request has told it `msgVer` / `packageSize`. `push` does the same.
public final class HealthModelService: P2PService, @unchecked Sendable {
    public static let moduleName = "hw.unitedevice.healthmodel"
    public static let packageName = "com.huawei.health.healthyliving"
    /// Fingerprint of the watch-side app.
    public static let fingerprintValue = "com.huawei.health.healthyliving_BBLV5gbaG5WYtIAUCOwrnqycG0TTHvDSFCf1skDcwpWT+tu2wJ2tOwPYFzjV+ZsiVJrV1nO/KsbJ687t7b9a6Jg="
    /// Huawei Health waits one second after the ping before sending.
    public static let pushDelayMs = 1000

    private let settings: HealthLivingState
    private let log: LogSink
    private let dayLoader: @Sendable (_ requestedDay: Int) throws -> HealthDay
    private let goals: @Sendable () -> HealthGoals
    private let nowMs: @Sendable () -> Int64
    private let pushDelayMs: Int
    private let pingLock = NSLock()
    private var _pingCode: Int?
    private var pushTasks: [Task<Void, Never>] = []

    public init(
        manager: P2PManager, settings: HealthLivingState, log: @escaping LogSink, dayLoader: @escaping @Sendable (Int) throws -> HealthDay,
        goals: @escaping @Sendable () -> HealthGoals = { HealthGoals() }, nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
        pushDelayMs: Int = HealthModelService.pushDelayMs
    ) {
        self.settings = settings
        self.log = log
        self.dayLoader = dayLoader
        self.goals = goals
        self.nowMs = nowMs
        self.pushDelayMs = pushDelayMs
        super.init(manager: manager)
    }

    public override var module: String { HealthModelService.moduleName }
    public override var package: String { HealthModelService.packageName }
    public override var fingerprint: String { HealthModelService.fingerprintValue }

    public var pingCode: Int? { pingLock.p2pLocked { _pingCode } }

    private func setPing(_ code: Int) { pingLock.p2pLocked { _pingCode = code } }

    private func note(_ message: String, error: Bool = false) { log(LogEntry(error ? .error : .info, service: 0x34, command: 0x01, message)) }

    private static func hex2(_ code: Int) -> String { String(format: "0x%02x", code & 0xFF) }

    public override func registered() {
        sendPing { [weak self] code, _ in
            self?.setPing(code)
            self?.note("Healthy Living: ping of \(HealthModelService.packageName) answered \(HealthModelService.hex2(code)) (0xca = the watch app is there)")
        }
    }

    public override func unregister() {
        clearPending()
        let tasks = pingLock.p2pLocked { () -> [Task<Void, Never>] in
            defer { pushTasks.removeAll() }
            return pushTasks
        }
        for task in tasks { task.cancel() }
    }

    public override func handleData(_ data: Bytes) throws {
        if !settings.healthLivingEnabled {
            note("Healthy Living: request ignored, the feature is switched off in the app")
            return
        }
        note("Healthy Living: request payload \(data.count) bytes: \(data.hexUpper)")
        let request: HealthModelMessages.Request
        do {
            request = try HealthModelMessages.decodeRequest(data)
        } catch let e as PbError {
            note("Healthy Living: request is not protobuf: \(e.message)", error: true)
            return
        }
        note("Healthy Living: request msgType=\(request.msgType) msgVer=\(request.msgVer) body=\(request.body.count) bytes")
        if request.msgType != HealthModelMessages.msgTasks {
            note("Healthy Living: msgType \(request.msgType) is not 2001 (tasks); ignored like Huawei Health")
            return
        }
        let body: HealthModelMessages.RequestBody
        do {
            body = try HealthModelMessages.decodeRequestBody(request.body)
        } catch let e as PbError {
            note("Healthy Living: request body is not protobuf: \(e.message)", error: true)
            return
        }
        // packageSize is only honoured from msgVer 3.0 on.
        let packageSize = request.msgVer >= HealthModelMessages.versionPaging ? body.packageSize : 0
        note(
            "Healthy Living: recordDay=\(body.recordDay) requestTaskIds='\(body.requestTaskIds)' pageSize=\(body.pageSize) packageSize=\(body.packageSize) (used \(packageSize))"
        )
        settings.healthLivingMsgVer = request.msgVer
        settings.healthLivingPackageSize = packageSize
        settings.healthLivingLastRequestMs = nowMs()
        let ids = Set(body.requestTaskIds.split(separator: ",", omittingEmptySubsequences: false).compactMap { Int($0.trimmingCharacters(in: .whitespaces)) })
        try send(requestedDay: body.recordDay, ids: ids, msgVer: request.msgVer, packageSize: packageSize, why: "request")
    }

    /// Sends today's report unasked, as Huawei Health does: ping, and on 0xca send after a second. Does nothing until the watch has made a
    /// request (msgVer unknown).
    public func push(_ reason: String) {
        let version = settings.healthLivingMsgVer
        if version <= 0 {
            note("Healthy Living: not pushing (\(reason)): the watch has not asked for tasks yet, its msgVer is unknown")
            return
        }
        sendPing { [weak self] code, _ in
            guard let self else { return }
            self.setPing(code)
            if (code & 0xFF) != 0xCA {
                self.note("Healthy Living: not pushing (\(reason)): ping answered \(HealthModelService.hex2(code)), not 0xca")
                return
            }
            let delayNs = UInt64(self.pushDelayMs) * 1_000_000
            let task = Task { [weak self] in
                try? await Task.sleep(nanoseconds: delayNs)
                if Task.isCancelled { return }
                guard let self else { return }
                do {
                    try self.send(requestedDay: 0, ids: [], msgVer: version, packageSize: self.settings.healthLivingPackageSize, why: "push: \(reason)")
                } catch {
                    self.note("Healthy Living: push failed: \(error)", error: true)
                }
            }
            self.pingLock.p2pLocked { self.pushTasks.append(task) }
        }
    }

    private func send(requestedDay: Int, ids: Set<Int>, msgVer: Float, packageSize: Int, why: String) throws {
        let day = try dayLoader(requestedDay)
        let body = HealthModelBuilder.build(day: day, goals: goals(), requestedIds: ids)
        let reports = HealthModelBuilder.reports(body: body, msgVer: msgVer, packageSize: packageSize)
        let taskList = body.tasks.map { "#\($0.taskId)=\($0.taskValue.isEmpty ? "-" : $0.taskValue)/\($0.taskTarget.isEmpty ? "-" : $0.taskTarget)\($0.status > 0 ? "✓" : "")" }
            .joined(separator: " ")
        let summary =
            "day \(day.recordDay): \(taskList) clover top=\(body.clover.map { "\($0.top)" } ?? "null") left=\(body.clover.map { "\($0.left)" } ?? "null") right=\(body.clover.map { "\($0.right)" } ?? "null")"
        note("Healthy Living: reporting (\(why)) \(summary) in \(reports.count) report(s) of \(reports.map { String($0.count) }.joined(separator: "+")) bytes")
        for (index, report) in reports.enumerated() {
            sendCommand(report) { [weak self] code, _ in
                self?.note("Healthy Living: report \(index + 1)/\(reports.count) acknowledged by the watch with \(HealthModelService.hex2(code)) (0xcf = received)")
            }
        }
        settings.healthLivingLastReportMs = nowMs()
        settings.healthLivingLastSummary = summary
    }
}

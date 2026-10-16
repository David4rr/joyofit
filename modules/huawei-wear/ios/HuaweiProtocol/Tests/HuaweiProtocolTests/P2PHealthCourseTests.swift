import XCTest
@testable import HuaweiProtocol

/// Healthy Living and the running course: the protobuf vectors and assertions of the Kotlin P2pTest, translated, plus scripted services.
final class P2PHealthCourseTests: XCTestCase {
    private func hex(_ s: String) -> Bytes { Bytes(hex: s)! }

    // MARK: protobuf

    func testHealthModelRequestMatchesHandComputedBytes() throws {
        let body = HealthModelMessages.encodeRequestBody(.init(recordDay: 20261014, requestTaskIds: "2,3", pageSize: 0, packageSize: 500))
        XCTAssertEqual(body, hex("0896D1D4091203322C3320F403"))
        let request = HealthModelMessages.encodeRequest(msgType: 2001, msgVer: 3.0, body: body)
        XCTAssertEqual(request, hex("08D10F15000040401A0D0896D1D4091203322C3320F403"))

        let decoded = try HealthModelMessages.decodeRequest(request)
        XCTAssertEqual(decoded.msgType, 2001)
        XCTAssertEqual(decoded.msgVer, 3.0)
        let back = try HealthModelMessages.decodeRequestBody(decoded.body)
        XCTAssertEqual(back, .init(recordDay: 20261014, requestTaskIds: "2,3", pageSize: 0, packageSize: 500))
    }

    func testReportTaskMatchesHandComputedBytesAndRoundTrips() throws {
        let task = HealthModelMessages.Task(
            taskId: 2, taskTarget: "8000", taskValue: "3210", taskType: 1, taskName: "Steps", progress: 0.40125, statusDes: "3210/8000"
        )
        let bytes = HealthModelMessages.encodeTask(task)
        XCTAssertEqual(bytes, hex("080212043830303022043332313040014A0553746570735DA470CD3E6209333231302F38303030"))
        XCTAssertEqual(try HealthModelMessages.decodeTask(bytes), task)
    }

    func testTaskBodyAndNoticeRoundTrip() throws {
        let body = HealthModelMessages.TaskBody(
            resultCode: 0, resultDes: "", recordDay: 20261014, allTasks: "1,2,3",
            tasks: [
                .init(taskId: 1, status: 1, taskName: "Perfect clover"),
                .init(taskId: 2, taskTarget: "8000", taskValue: "9000", status: 1, timestamp: 1_700_000_000_123),
            ],
            completedTasks: "2", clover: .init(top: 1, left: 0.5, right: 0, bottom: 0.25)
        )
        let back = try HealthModelMessages.decodeTaskBody(HealthModelMessages.encodeTaskBody(body))
        XCTAssertEqual(back, body)

        let notice = HealthModelMessages.encodeNoticeBody([.init(recordDay: 20261014, taskId: 5000, taskName: "Weekly", msg: "Report ready")])
        let fields = try PbReader.fields(notice)
        XCTAssertEqual(fields.count, 1)
        let inner = try PbReader.fields(fields[0].bytes!)
        XCTAssertEqual(inner.map(\.number), [1, 2, 3, 4])
        XCTAssertEqual(inner[3].asString(), "Report ready")
    }

    func testTruncatedProtobufIsRejected() {
        let ok = HealthModelMessages.encodeRequest(msgType: 2001, msgVer: 3.0, body: [1, 2, 3])
        XCTAssertThrowsError(try PbReader.fields(Array(ok.dropLast())))
    }

    func testProtobufVarintsAndFloats() throws {
        let w = PbWriter().intField(1, -1).intField(2, 300).longFieldUnlessZero(3, 0).floatField(4, -2.5).bytesFieldUnlessEmpty(5, []).stringField(6, "é")
        let bytes = w.toBytes()
        XCTAssertEqual(bytes, hex("08" + "FFFFFFFFFFFFFFFFFF01" + "10AC02" + "25000020C0" + "3202C3A9"))
        let fields = try PbReader.fields(bytes)
        XCTAssertEqual(fields.map(\.number), [1, 2, 4, 6])
        XCTAssertEqual(fields[0].asInt(), -1)
        XCTAssertEqual(fields[1].asInt(), 300)
        XCTAssertEqual(fields[2].asFloat(), -2.5)
        XCTAssertEqual(fields[3].asString(), "é")
        XCTAssertThrowsError(try PbReader.fields([0x0B]))  // wire type 3
        XCTAssertThrowsError(try PbReader.fields([0x00, 0x01]))  // field number 0
        XCTAssertEqual(try PbReader.fields([0x09, 1, 2, 3, 4, 5, 6, 7, 8]).first?.value, 0x0807060504030201)
    }

    // MARK: builder

    private let day = HealthDay(
        recordDay: 20261014, steps: 9000, stepGoal: 8000, exerciseMinutes: 10, sleepSeconds: 7 * 3600, intakeKcal: 1500, weightKg: nil,
        bloodPressure: false, stressMeasured: true, timestampMs: 1_700_000_000_000
    )

    func testBuilderFollowsHuaweisLayout() {
        let body = HealthModelBuilder.build(day: day, goals: HealthGoals(), requestedIds: nil)
        XCTAssertEqual(body.tasks.map(\.taskId), [1, 2, 3, 18, 17])
        XCTAssertEqual(body.allTasks, "1,2,3,18,17")
        XCTAssertEqual(body.completedTasks, "2,17")
        let perfect = body.tasks[0]
        XCTAssertEqual(perfect.taskTarget, "23" + "18" + "17")
        XCTAssertEqual(perfect.status, 0)
        let steps = body.tasks[1]
        XCTAssertEqual(steps.taskTarget, "8000")
        XCTAssertEqual(steps.taskValue, "9000")
        XCTAssertEqual(steps.status, 1)
        XCTAssertEqual(steps.taskType, 1)
        XCTAssertEqual(steps.progress, 1.125)
        XCTAssertEqual(body.tasks[2].taskType, 0)
        XCTAssertEqual(body.clover?.bottom, 0)
        XCTAssertEqual(body.clover?.top, 1)
        XCTAssertEqual(Double(body.clover!.left), 7.0 / 8.0, accuracy: 1e-6)
        XCTAssertEqual(body.clover?.right, 1)
        XCTAssertEqual(body.tasks[3].statusDes, "7.0/8.0 h")
        XCTAssertEqual(body.tasks[4].statusDes, "1500/2000 kcal")
    }

    func testRequestedIdsFilterTheTaskListButNotAllTasks() {
        let body = HealthModelBuilder.build(day: day, goals: HealthGoals(), requestedIds: [2])
        XCTAssertEqual(body.tasks.map(\.taskId), [2])
        XCTAssertEqual(body.allTasks, "1,2,3,18,17")
    }

    func testEveryTaskDonePerfectsTheCloverAndWeightAndBloodPressureAreTasks() {
        let full = HealthDay(
            recordDay: 20261014, steps: 9000, stepGoal: 8000, exerciseMinutes: 45, sleepSeconds: 9 * 3600, intakeKcal: 800, weightKg: 70, bloodPressure: true,
            stressMeasured: true, timestampMs: 1
        )
        let body = HealthModelBuilder.build(day: full, goals: HealthGoals(), requestedIds: nil)
        XCTAssertEqual(body.tasks[0].status, 1)
        XCTAssertEqual(body.tasks.map(\.taskId), [1, 2, 3, 18, 17, 14, 12])
    }

    func testNoStepsAndAnEmptyGoalGiveZeroProgressAndAMinimumOtherwise() {
        var d = day
        d.steps = 0
        d.stepGoal = 0
        var body = HealthModelBuilder.build(day: d, goals: HealthGoals(), requestedIds: nil)
        XCTAssertEqual(body.tasks[1].taskTarget, "1")
        XCTAssertEqual(body.tasks[1].progress, 0)
        d.steps = 1
        d.stepGoal = 100
        body = HealthModelBuilder.build(day: d, goals: HealthGoals(), requestedIds: nil)
        XCTAssertEqual(body.tasks[1].progress, 0.1)
    }

    func testReportsRespectPackageSize() throws {
        let body = HealthModelBuilder.build(day: day, goals: HealthGoals(), requestedIds: nil)
        XCTAssertEqual(HealthModelBuilder.reports(body: body, msgVer: 4.0, packageSize: 0).count, 1)
        let paged = HealthModelBuilder.reports(body: body, msgVer: 4.0, packageSize: 200)
        XCTAssertGreaterThan(paged.count, 1)
        let decoded = try paged.map { try HealthModelMessages.decodeTaskBody(HealthModelMessages.decodeReport($0).body) }
        XCTAssertEqual(body.tasks.map(\.taskId), decoded.flatMap { $0.tasks.map(\.taskId) })
        for page in decoded {
            XCTAssertEqual(page.allTasks, "1,2,3,18,17")
            XCTAssertNotNil(page.clover)
        }
        for report in paged { XCTAssertLessThanOrEqual(report.count, 100 + 80) }
    }

    // MARK: Healthy Living service

    final class MemoryState: HealthLivingState, @unchecked Sendable {
        var healthLivingEnabled = true
        var healthLivingMsgVer: Float = 0
        var healthLivingPackageSize = 0
        var healthLivingLastRequestMs: Int64 = 0
        var healthLivingLastReportMs: Int64 = 0
        var healthLivingLastSummary: String?
    }

    private func healthService(_ capture: P2PTests.Capture, _ state: MemoryState, pushDelayMs: Int = 10) throws -> (P2PManager, HealthModelService) {
        let manager = P2PManager(transport: capture)
        let day = self.day
        let service = HealthModelService(manager: manager, settings: state, log: { _ in }, dayLoader: { _ in day }, nowMs: { 1_790_000_000_000 }, pushDelayMs: pushDelayMs)
        service.register()
        let sent = capture.take()
        XCTAssertEqual(sent.count, 1)
        let ping = sent[0]
        XCTAssertEqual(ping.int("cmd"), 1)
        XCTAssertEqual(ping.str("src"), "com.huawei.health")
        XCTAssertEqual(ping.str("dst"), "com.huawei.health.healthyliving")
        try manager.handlePacket(P2PTests.response(3, ping.int("seq"), "com.huawei.health.healthyliving", "com.huawei.health", nil, 0xCA))
        XCTAssertEqual(service.pingCode, 0xCA)
        return (manager, service)
    }

    private let phoneModule = "hw.unitedevice.healthmodel"
    private let watchPackage = "com.huawei.health.healthyliving"

    func testTheWatchRequestIsAnsweredWithAReportOnTheSameModule() throws {
        let capture = P2PTests.Capture()
        let state = MemoryState()
        let (manager, _) = try healthService(capture, state)
        let body = HealthModelMessages.encodeRequestBody(.init(recordDay: 20261014, requestTaskIds: "", pageSize: 0, packageSize: 0))
        try manager.handlePacket(P2PTests.response(2, 50, watchPackage, phoneModule, HealthModelMessages.encodeRequest(msgType: 2001, msgVer: 3.0, body: body), nil))
        let sent = capture.take()
        XCTAssertEqual(sent.count, 2)
        XCTAssertEqual(sent[0].int("cmd"), 3)
        XCTAssertEqual(sent[0].int("seq"), 50)
        XCTAssertEqual(sent[0].int("code"), 0xCF)
        XCTAssertEqual(sent[0].str("src"), phoneModule)
        XCTAssertEqual(sent[0].str("dst"), watchPackage)
        XCTAssertEqual(sent[1].int("cmd"), 2)
        XCTAssertEqual(sent[1].str("src"), phoneModule)
        XCTAssertEqual(sent[1].str("dst"), watchPackage)
        XCTAssertEqual(sent[1].str("srcFp"), "UniteDeviceManagement")
        XCTAssertEqual(sent[1].str("dstFp"), HealthModelService.fingerprintValue)
        let report = try HealthModelMessages.decodeReport(sent[1].bytes("data"))
        XCTAssertEqual(report.msgType, 2001)
        XCTAssertEqual(report.msgVer, 3.0)
        let tasks = try HealthModelMessages.decodeTaskBody(report.body)
        XCTAssertEqual(tasks.recordDay, 20261014)
        XCTAssertEqual(tasks.tasks.map(\.taskId), [1, 2, 3, 18, 17])
        XCTAssertEqual(tasks.tasks[1].taskValue, "9000")
        XCTAssertEqual(state.healthLivingMsgVer, 3.0)
        XCTAssertEqual(state.healthLivingLastRequestMs, 1_790_000_000_000)
        XCTAssertEqual(state.healthLivingLastReportMs, 1_790_000_000_000)
        XCTAssertEqual(state.healthLivingPackageSize, 0)
        XCTAssertEqual(
            state.healthLivingLastSummary,
            "day 20261014: #1=-/231817 #2=9000/8000✓ #3=10/30 #18=25200/28800 #17=1500/2000✓ clover top=1.0 left=0.875 right=1.0"
        )
    }

    func testARequestForAnotherMessageTypeIsAckedButNotAnswered() throws {
        let capture = P2PTests.Capture()
        let (manager, _) = try healthService(capture, MemoryState())
        try manager.handlePacket(
            P2PTests.response(2, 51, watchPackage, phoneModule, HealthModelMessages.encodeRequest(msgType: 2005, msgVer: 3.0, body: []), nil)
        )
        let sent = capture.take()
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent[0].int("cmd"), 3)
    }

    func testASwitchedOffFeatureDoesNotAnswer() throws {
        let capture = P2PTests.Capture()
        let state = MemoryState()
        state.healthLivingEnabled = false
        let (manager, _) = try healthService(capture, state)
        try manager.handlePacket(
            P2PTests.response(2, 52, watchPackage, phoneModule, HealthModelMessages.encodeRequest(msgType: 2001, msgVer: 3.0, body: []), nil)
        )
        XCTAssertEqual(capture.take().count, 1)
    }

    func testAnOldWatchGetsOneUnpagedReport() throws {
        let capture = P2PTests.Capture()
        let state = MemoryState()
        let (manager, _) = try healthService(capture, state)
        let body = HealthModelMessages.encodeRequestBody(.init(recordDay: 20261014, requestTaskIds: "", pageSize: 0, packageSize: 100))
        try manager.handlePacket(P2PTests.response(2, 53, watchPackage, phoneModule, HealthModelMessages.encodeRequest(msgType: 2001, msgVer: 2.0, body: body), nil))
        XCTAssertEqual(capture.take().count, 2)
        XCTAssertEqual(state.healthLivingPackageSize, 0)
    }

    func testARequestThatIsNotProtobufIsAckedAndIgnored() throws {
        let capture = P2PTests.Capture()
        let (manager, _) = try healthService(capture, MemoryState())
        try manager.handlePacket(P2PTests.response(2, 54, watchPackage, phoneModule, [0xFF, 0xFF], nil))
        XCTAssertEqual(capture.take().count, 1)
        // The body is garbage after a valid envelope.
        try manager.handlePacket(
            P2PTests.response(2, 55, watchPackage, phoneModule, HealthModelMessages.encodeRequest(msgType: 2001, msgVer: 3.0, body: [0x0A, 0x05, 1]), nil)
        )
        XCTAssertEqual(capture.take().count, 1)
    }

    func testPushWaitsForARequestThenPingsFirst() async throws {
        let capture = P2PTests.Capture()
        let state = MemoryState()
        let (manager, service) = try healthService(capture, state)
        service.push("test")
        XCTAssertTrue(capture.take().isEmpty)

        state.healthLivingMsgVer = 4.0
        state.healthLivingPackageSize = 0
        service.push("test")
        let ping = capture.take()
        XCTAssertEqual(ping.count, 1)
        XCTAssertEqual(ping[0].int("cmd"), 1)
        try manager.handlePacket(P2PTests.response(3, ping[0].int("seq"), watchPackage, "com.huawei.health", nil, 0xCA))
        var sent = [[String: Any]]()
        for _ in 0..<150 where sent.isEmpty {
            try await Task.sleep(nanoseconds: 20_000_000)
            sent = capture.take()
        }
        XCTAssertEqual(sent.count, 1)
        let report = try HealthModelMessages.decodeReport(sent[0].bytes("data"))
        XCTAssertEqual(report.msgType, HealthModelMessages.msgTasks)
        XCTAssertEqual(report.msgVer, 4.0)
    }

    func testPushDoesNotSendWhenThePingIsNotAnswered0xca() async throws {
        let capture = P2PTests.Capture()
        let state = MemoryState()
        state.healthLivingMsgVer = 4.0
        let (manager, service) = try healthService(capture, state)
        service.push("test")
        let ping = capture.take()
        try manager.handlePacket(P2PTests.response(3, ping[0].int("seq"), watchPackage, "com.huawei.health", nil, 0xCC))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(capture.take().isEmpty)
        XCTAssertEqual(service.pingCode, 0xCC)
    }

    // MARK: courses

    private func sampleCourse() -> RunningCourse {
        RunningCourse(
            id: "JFTEST", name: "Run",
            blocks: [
                CourseBlock(repeatCount: 1, steps: [CourseStep(kind: .warmup, target: .time, targetValue: 300)]),
                CourseBlock(
                    repeatCount: 2,
                    steps: [
                        CourseStep(kind: .run, target: .distance, targetValue: 1000, intensity: .pace, low: 300, high: 330),
                        CourseStep(kind: .rest, target: .time, targetValue: 60),
                    ]
                ),
                CourseBlock(repeatCount: 1, steps: [CourseStep(kind: .cooldown, target: .time, targetValue: 300)]),
            ]
        )
    }

    func testCourseStorageInfoMatchesHandComputedBytes() throws {
        let bytes = CourseProtobuf.encode(sampleCourse(), updateTimeSec: 1_700_000_000)
        XCTAssertEqual(
            bytes,
            hex(
                "0A064A465445535410521075106E18FF0120002A03322E30300038004080E2CFAA064801500458046219080110011A130A055244303031100118AC0220FF01280030006230080210021A160A055244303032100018E807200F2890921430E0A7121A120A0552443030341001183C20FF01280030006219080110011A130A055244303035100118AC0220FF0128003000"
            )
        )
        let names = try PbReader.fields(bytes).filter { $0.number == 2 }.map { $0.asInt() }
        XCTAssertEqual(names, Array("Run".utf8).map { Int($0) })
    }

    func testCourseFileIsHeaderPlusStorageInfo() {
        let payload = CourseProtobuf.encode(sampleCourse(), updateTimeSec: 1_700_000_000)
        let file = CourseProtobuf.message(businessType: CourseProtobuf.businessCustomCourse, messageId: 7, payload: payload)
        XCTAssertEqual(file.count, 36 + payload.count)
        var length = Bytes()
        for i in 0..<4 { length.append(UInt8(((36 + payload.count) >> (8 * i)) & 0xFF)) }
        XCTAssertEqual(Array(file.prefix(20)), hex("0300000001000000") + length + hex("0000000007000000"))
        XCTAssertEqual(Array(file.dropFirst(36)), payload)
        XCTAssertEqual(CourseProtobuf.fileName(7), "7courseInfo.bin")
    }

    func testCourseTotalsAndValidation() {
        let course = sampleCourse()
        XCTAssertTrue(CourseProtobuf.total(course) == (.none, 0))
        let timed = RunningCourse(id: "x", name: "T", blocks: [CourseBlock(repeatCount: 3, steps: [CourseStep(kind: .run, target: .time, targetValue: 60)])])
        XCTAssertTrue(CourseProtobuf.total(timed) == (.time, 180))
        XCTAssertNoThrow(try CourseProtobuf.validate(course))
        func rejects(_ c: RunningCourse, _ message: String? = nil, line: UInt = #line) {
            XCTAssertThrowsError(try CourseProtobuf.validate(c), line: line) { error in
                let e = error as? WearError
                XCTAssertEqual(e?.code, .invalidArgument, line: line)
                if let message { XCTAssertEqual(e?.message, message, line: line) }
            }
        }
        rejects(RunningCourse(id: "x", name: " ", blocks: course.blocks), "Give the course a name")
        rejects(RunningCourse(id: "x", name: String(repeating: "é", count: 33), blocks: course.blocks), "The course name is too long")
        rejects(RunningCourse(id: "x", name: "n", blocks: []), "The course needs at least one step")
        rejects(RunningCourse(id: "x", name: "n", blocks: [CourseBlock(repeatCount: 1, steps: [])]), "A repeated group has no steps")
        rejects(RunningCourse(id: "x", name: "n", blocks: [CourseBlock(repeatCount: 100, steps: [CourseStep(kind: .run, target: .none, targetValue: 0)])]), "A group repeats 1 to 99 times")
        rejects(RunningCourse(id: "x", name: "n", blocks: [CourseBlock(repeatCount: 1, steps: [CourseStep(kind: .run, target: .time, targetValue: 0)])]), "A time target is 1 s to 24 h")
        rejects(RunningCourse(id: "x", name: "n", blocks: [CourseBlock(repeatCount: 1, steps: [CourseStep(kind: .run, target: .distance, targetValue: 100_001)])]), "A distance target is 1 m to 100 km")
        rejects(
            RunningCourse(id: "x", name: "n", blocks: [CourseBlock(repeatCount: 1, steps: [CourseStep(kind: .run, target: .time, targetValue: 60, intensity: .pace, low: 330, high: 300)])]),
            "The faster pace must come first"
        )
        rejects(
            RunningCourse(id: "x", name: "n", blocks: [CourseBlock(repeatCount: 1, steps: [CourseStep(kind: .run, target: .time, targetValue: 60, intensity: .hrPercent, low: 10, high: 90)])]),
            "A heart-rate bound is 20 to 100 % of the maximum"
        )
        rejects(
            RunningCourse(id: "x", name: "n", blocks: [CourseBlock(repeatCount: 1, steps: [CourseStep(kind: .run, target: .time, targetValue: 60, intensity: .cadence, low: 200, high: 150)])]),
            "The lower cadence must come first"
        )
        let many = RunningCourse(id: "x", name: "n", blocks: [CourseBlock(repeatCount: 1, steps: Array(repeating: CourseStep(kind: .run, target: .none, targetValue: 0), count: 101))])
        rejects(many, "A course can have at most 100 steps")
    }

    func testIntensityValuesAreWrittenInHuaweisUnits() throws {
        func fields(_ step: CourseStep) throws -> (kind: String, type: Int, value: Int, intensity: Int, high: Int, low: Int) {
            let f = try PbReader.fields(CourseProtobuf.encodeAction(step))
            return (f[0].asString(), f[1].asInt(), f[2].asInt(), f[3].asInt(), f[4].asInt(), f[5].asInt())
        }
        let pace = try fields(CourseStep(kind: .run, target: .time, targetValue: 60, intensity: .pace, low: 300, high: 330))
        XCTAssertEqual(pace.intensity, 15)
        XCTAssertEqual(pace.low, 300_000)
        XCTAssertEqual(pace.high, 330_000)
        let hr = try fields(CourseStep(kind: .walk, target: .none, targetValue: 99, intensity: .hrPercent, low: 60, high: 80))
        XCTAssertEqual(hr.kind, "RD003")
        XCTAssertEqual(hr.type, 255)
        XCTAssertEqual(hr.value, 0)
        XCTAssertEqual(hr.intensity, 1)
        XCTAssertEqual(hr.low, 60)
        XCTAssertEqual(hr.high, 80)
    }

    func testTheFitnessServiceHandsTheWatchAnswerToTheWaitingPush() throws {
        let capture = P2PTests.Capture()
        let manager = P2PManager(transport: capture)
        let service = FitnessCourseService(manager: manager, log: { _ in })
        service.register()
        let ping = capture.take()
        XCTAssertEqual(ping.count, 1)
        XCTAssertEqual(ping[0].str("dst"), "in.huawei.fitness")
        try manager.handlePacket(P2PTests.response(3, ping[0].int("seq"), "in.huawei.fitness", "com.huawei.health", nil, 0xCA))
        XCTAssertEqual(service.pingCode, 0xCA)
        let waiter = service.expectAnswer(77)
        let answer = P2PSubMsg(type: 3, messageId: 77, data: [0xAB, 0xCD]).bytes
        try manager.handlePacket(P2PTests.response(2, 9, "in.huawei.fitness", "hw.unitedevice.fitness", answer, nil))
        let sent = capture.take()
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent[0].int("cmd"), 3)
        // The waiter has its answer: awaiting it returns at once.
        let done = expectation(description: "answer")
        Task {
            let value = try await waiter.value()
            XCTAssertEqual(value, [0xAB, 0xCD])
            done.fulfill()
        }
        wait(for: [done], timeout: 2)
        // An answer nobody waits for is only logged; a message shorter than its length field is a parse failure the stack logs.
        try manager.handlePacket(P2PTests.response(2, 10, "in.huawei.fitness", "hw.unitedevice.fitness", answer, nil))
        XCTAssertThrowsError(try manager.handlePacket(P2PTests.response(2, 11, "in.huawei.fitness", "hw.unitedevice.fitness", Array(answer.dropLast()), nil)))
    }

    func testAnUnregisteredFitnessServiceCancelsItsWaiters() async {
        let manager = P2PManager(transport: P2PTests.Capture())
        let service = FitnessCourseService(manager: manager, log: { _ in })
        let waiter = service.expectAnswer(5)
        service.unregister()
        do {
            _ = try await waiter.value()
            XCTFail("cancelled")
        } catch is CancellationError {}
        catch { XCTFail("\(error)") }
    }

    func testTheTimeoutHelperGivesNilWhenTheOperationIsSlow() async {
        let slow: Int? = await p2pWithTimeout(ms: 50) {
            try await Task.sleep(nanoseconds: 5_000_000_000)
            return 1
        }
        XCTAssertNil(slow)
        let fast: Int? = await p2pWithTimeout(ms: 2_000) { 7 }
        XCTAssertEqual(fast, 7)
    }
}

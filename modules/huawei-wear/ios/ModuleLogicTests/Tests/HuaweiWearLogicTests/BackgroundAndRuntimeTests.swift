import XCTest
@testable import HuaweiWearLogic

final class WakeSignalTests: XCTestCase {
    func testASignalBeforeTheWaitReturnsAtOnce() async {
        let wake = WakeSignal()
        wake.signal()
        wake.signal()
        let started = Date()
        await wake.wait(timeoutMs: 5_000)
        XCTAssertLessThan(Date().timeIntervalSince(started), 1, "conflated signal consumed without waiting")
        // Consumed: the next wait runs into its timeout.
        let t0 = Date()
        await wake.wait(timeoutMs: 120)
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(t0), 0.1)
    }

    func testASignalDuringTheWaitWakesIt() async {
        let wake = WakeSignal()
        Task {
            try? await Task.sleep(nanoseconds: 50_000_000)
            wake.signal()
        }
        let started = Date()
        await wake.wait(timeoutMs: 5_000)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
    }

    func testConsumeDropsAPendingSignal() async {
        let wake = WakeSignal()
        wake.signal()
        wake.consume()
        let t0 = Date()
        await wake.wait(timeoutMs: 100)
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(t0), 0.08)
    }
}

final class AsyncPrimitivesTests: XCTestCase {
    func testAsyncLockRunsOneHolderAtATimeInArrivalOrder() async {
        let lock = AsyncLock()
        let log = Log()
        await withTaskGroup(of: Void.self) { group in
            for i in 0..<5 {
                group.addTask {
                    await sleepMs(i * 5)
                    await lock.withLock {
                        log.add("in \(i)")
                        await sleepMs(15)
                        log.add("out \(i)")
                    }
                }
            }
        }
        let entries = log.entries
        XCTAssertEqual(entries.count, 10)
        for pair in stride(from: 0, to: 10, by: 2) {
            XCTAssertEqual(entries[pair].dropFirst(3), entries[pair + 1].dropFirst(4), "no interleaving: \(entries)")
        }
    }

    func testOneShotDeliversOnceToEveryWaiter() async throws {
        let shot = OneShot<Int>()
        async let a = shot.value()
        async let b = shot.value()
        await sleepMs(20)
        shot.complete(.success(7))
        shot.complete(.success(8))
        let (x, y) = try await (a, b)
        XCTAssertEqual([x, y], [7, 7])
        let late = try await shot.value()
        XCTAssertEqual(late, 7)
    }

    func testDeadlineGivesUpAndCancelsTheBody() async {
        do {
            _ = try await withDeadline(ms: 50, onTimeout: { WearError(.timeout, "late") }) { () async throws -> Int in
                try await Task.sleep(nanoseconds: 5_000_000_000)
                return 1
            }
            XCTFail("expected a timeout")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .timeout)
        } catch { XCTFail("\(error)") }
        let value = try? await withDeadline(ms: 2_000, onTimeout: { WearError(.timeout, "late") }) { () async throws -> Int in 5 }
        XCTAssertEqual(value, 5)
    }

    final class Log: @unchecked Sendable {
        private let lock = NSLock()
        private var items: [String] = []
        func add(_ s: String) { lock.locked { items.append(s) } }
        var entries: [String] { lock.locked { items } }
    }
}

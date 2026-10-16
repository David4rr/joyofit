import Foundation
import XCTest
@testable import HuaweiProtocol

/// The 0x28 upload state machine against a fake watch that drives it the way GB's `AsynchronousResponse.handleFileUpload` expects (the
/// cases of the Kotlin FileUploadTest): file info, hash request, parameters, chunk requests, result, and the 0x27/0x05 confirmation.
final class FileUploadTests: XCTestCase {
    func payload(_ size: Int) -> Bytes { Bytes((0..<size).map { UInt8(truncatingIfNeeded: $0 * 7 + 3) }) }

    func setup(
        decryptChunks: Bool = true, _ respond: @escaping UploadFakeWatch.Responder
    ) -> (watch: UploadFakeWatch, session: HuaweiSession, logs: SleepFilesLogCollector) {
        let logs = SleepFilesLogCollector()
        let watch = UploadFakeWatch(decryptChunks: decryptChunks, respond)
        let session = HuaweiSession(sink: watch, log: logs.sink)
        session.params.secretKey = Bytes(repeating: 0, count: 16)
        watch.attach(session)
        return (watch, session, logs)
    }

    func uploader(
        _ session: HuaweiSession, _ logs: SleepFilesLogCollector, progress: @escaping @Sendable (Int, Int) -> Void = { _, _ in },
        stallMs: Int = 2_000, confirmWaitMs: Int = 2_000, settleMs: Int = 100
    ) -> FileUploader {
        FileUploader(session: session, log: logs.sink, onProgress: progress, stallMs: stallMs, confirmWaitMs: confirmWaitMs, settleMs: settleMs, queryMs: 400)
    }

    func face(_ name: String, _ data: Bytes) -> UploadFile { UploadFile(fileName: name, fileType: FileUpload.Filetype.watchface, data: data) }

    func status(_ code: Int32) -> Bytes {
        var t = HuaweiTLV()
        t.put(0x7f, int: code)
        return UploadFakeWatch.tlvFrame(0x28, 0x02, t)
    }

    func testUploadsInTheChunksTheWatchAsksFor() async throws {
        let file = payload(1000)
        let progress = ProgressRecorder()
        let standard = StandardUploadWatch(file: file, unit: 64, chunk: 300)
        let (watch, session, logs) = setup { standard.respond($0) }

        let outcome = try await uploader(session, logs, progress: progress.callback).upload(face("123456789_1.0.0", file))

        XCTAssertEqual(standard.received, file)
        XCTAssertEqual(standard.requests.map { [$0.position, $0.size] }, [[0, 300], [300, 300], [600, 300], [900, 100]])
        // Each chunk is cut into unit-size packets, numbered from 0 inside the chunk.
        XCTAssertEqual(standard.packetIndexes, [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1])

        let info = try XCTUnwrap(watch.all(0x28, 0x02).first?.tlv)
        XCTAssertEqual(watch.all(0x28, 0x02).count, 1)
        XCTAssertEqual(try info.string(0x01), "123456789_1.0.0")
        XCTAssertEqual(try info.int(0x02), 1000)
        XCTAssertEqual(try info.byte(0x03), 1)
        XCTAssertEqual(try info.string(0x05), "123456789")
        XCTAssertEqual(try info.string(0x06), "1.0.0")
        XCTAssertFalse(info.contains(0x08))

        let hash = try XCTUnwrap(watch.all(0x28, 0x03).first?.tlv)
        XCTAssertEqual(try hash.byte(0x01), 7)
        XCTAssertEqual(try hash.bytes(0x03), SHA256.hash(file))

        let ack = try XCTUnwrap(watch.all(0x28, 0x04).first?.tlv)
        XCTAssertEqual(try ack.int(0x7f), 100_000)
        XCTAssertEqual(try ack.byte(0x01), 7)
        XCTAssertFalse(ack.contains(0x09), "no 0x09 flag when the watch wants encryption")

        let result = try XCTUnwrap(watch.all(0x28, 0x07).first?.tlv)
        XCTAssertEqual(try result.int(0x7f), 100_000)
        XCTAssertEqual(try result.byte(0x01), 7)

        // reportType 2: the phone confirms and asks the watch to make the face active.
        let confirm = try XCTUnwrap(watch.all(0x27, 0x05).first?.tlv)
        XCTAssertEqual(watch.all(0x27, 0x05).count, 1)
        XCTAssertEqual(try confirm.string(0x01), "123456789")
        XCTAssertEqual(try confirm.string(0x02), "1.0.0")
        XCTAssertEqual(try confirm.int(0x7f), 100_000)
        let active = try XCTUnwrap(watch.all(0x27, 0x03).first?.tlv)
        XCTAssertEqual(watch.all(0x27, 0x03).count, 1)
        XCTAssertEqual(try active.string(0x01), "123456789")
        XCTAssertEqual(try active.string(0x02), "1.0.0")
        XCTAssertEqual(try active.byte(0x03), 1)

        XCTAssertEqual(outcome.fileId, 7)
        XCTAssertEqual(outcome.resultStatus, 0)
        XCTAssertEqual(outcome.confirmReportType, 2)
        XCTAssertTrue(outcome.activateRequested)
        XCTAssertEqual(outcome.activateCode, 100_000)
        XCTAssertEqual(progress.values.first?.0, 0)
        XCTAssertEqual(progress.values.first?.1, 1000)
        XCTAssertEqual(progress.values.last?.0, 1000)
        XCTAssertEqual(progress.values.map { $0.0 }, progress.values.map { $0.0 }.sorted())
        XCTAssertTrue(logs.messages.contains { $0.contains("FileUploadConsultAck") && $0.contains("unitSize=64") && $0.contains("maxApplyDataSize=300") })
        // The chunk data is not dumped as hex: one summary line per chunk.
        let chunkLogs = logs.entries.filter { $0.direction == .tx && $0.message.hasPrefix("FileUpload chunk") }
        XCTAssertEqual(chunkLogs.count, 4)
        XCTAssertTrue(chunkLogs.allSatisfy { $0.message.contains("hex not logged") && $0.message.count < 160 && $0.hex == nil })
    }

    func testNoEncryptFlagSendsPlainChunksAndTheAckFlag() async throws {
        let file = payload(500)
        let standard = StandardUploadWatch(file: file, unit: 128, chunk: 500, noEncrypt: true, confirmReport: 1)
        let (watch, session, logs) = setup(decryptChunks: false) { standard.respond($0) }

        let outcome = try await uploader(session, logs).upload(face("42_1.0.0", file))

        XCTAssertEqual(standard.received, file)
        XCTAssertEqual(try watch.all(0x28, 0x04).first!.tlv!.byte(0x09), 1)
        XCTAssertEqual(outcome.confirmReportType, 1)
        XCTAssertFalse(outcome.activateRequested)
        XCTAssertTrue(watch.all(0x27, 0x03).isEmpty, "no activation for reportType 1")
        XCTAssertEqual(watch.all(0x27, 0x05).count, 1, "the confirm is still answered")
    }

    func testChunksLargerThanTheSliceSizeAreSlicedAndReassembled() async throws {
        let file = payload(2000)
        let standard = StandardUploadWatch(file: file, unit: 700, chunk: 2000)
        let (watch, session, logs) = setup { standard.respond($0) }

        _ = try await uploader(session, logs).upload(face("9_1.0.0", file))

        XCTAssertEqual(standard.received, file)
        XCTAssertEqual(standard.packetIndexes, [0, 1, 2])
        XCTAssertGreaterThan(watch.framesWritten, 10, "a 700 byte unit does not fit one 244 byte frame")
    }

    func testAWatchAskingForMoreThanIsLeftGetsTheRest() async throws {
        let file = payload(100)
        let standard = StandardUploadWatch(file: file, unit: 64, chunk: 100)
        let (_, session, logs) = setup { m in
            // The first request asks for 300 bytes of a 100 byte file.
            if m.service == 0x28 && m.command == 0x04 {
                var t = HuaweiTLV()
                t.put(0x02, int: 0)
                t.put(0x03, int: 300)
                standard.requestedEnd = 100
                return [UploadFakeWatch.tlvFrame(0x28, 0x05, t)]
            }
            return standard.respond(m)
        }

        _ = try await uploader(session, logs, confirmWaitMs: 200).upload(face("5_1.0.0", file))

        XCTAssertEqual(standard.received, file)
        XCTAssertTrue(logs.contains("only 100 are left"))
    }

    func testFileInfoRefusedWithTooManyFacesGivesTheKnownMessage() async throws {
        let (watch, session, logs) = setup { m in m.service == 0x28 && m.command == 0x02 ? [self.status(140_004)] : [] }
        do {
            _ = try await uploader(session, logs).upload(face("1_1.0.0", payload(10)))
            XCTFail("expected a rejection")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .uploadRejected)
            XCTAssertEqual(e.statusCode, 140_004)
            XCTAssertTrue(e.message.contains("too many"))
        }
        XCTAssertTrue(watch.all(0x28, 0x03).isEmpty)
        XCTAssertTrue(logs.containsError("status code 140004"))
    }

    func testAnUnknownRefusalCodeIsReportedExactly() async throws {
        let (_, session, logs) = setup { m in m.service == 0x28 && m.command == 0x02 ? [self.status(140_123)] : [] }
        do {
            _ = try await uploader(session, logs).upload(face("1_1.0.0", payload(10)))
            XCTFail("expected a rejection")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .uploadRejected)
            XCTAssertEqual(e.statusCode, 140_123)
            XCTAssertTrue(e.message.contains("140123"))
            XCTAssertTrue(e.message.contains("file info"))
        }
    }

    func testDeviceErrorReportDuringTheTransferEndsTheUpload() async throws {
        let standard = StandardUploadWatch(file: payload(300), unit: 64, chunk: 300)
        let (_, session, logs) = setup { m in
            if m.service == 0x28 && m.command == 0x04 {
                var t = HuaweiTLV()
                t.put(0x01, byte: 7)
                t.put(0x7f, int: 140_009)
                return [UploadFakeWatch.tlvFrame(0x28, 0x08, t)]
            }
            return standard.respond(m)
        }
        do {
            _ = try await uploader(session, logs).upload(face("1_1.0.0", payload(300)))
            XCTFail("expected a rejection")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .uploadRejected)
            XCTAssertEqual(e.statusCode, 140_009)
            XCTAssertTrue(e.message.contains("free space"))
        }
    }

    func testDeviceErrorReportForAnotherFileIsIgnored() async throws {
        let file = payload(100)
        let standard = StandardUploadWatch(file: file, unit: 64, chunk: 100)
        let injected = NSLock()
        var done = false
        let (_, session, logs) = setup { m in
            injected.lock()
            let first = !done
            if m.service == 0x28 && m.command == 0x04 && first { done = true }
            injected.unlock()
            if m.service == 0x28 && m.command == 0x04 && first {
                var t = HuaweiTLV()
                t.put(0x01, byte: 99)
                t.put(0x7f, int: 140_009)
                return [UploadFakeWatch.tlvFrame(0x28, 0x08, t)] + standard.respond(m)
            }
            return standard.respond(m)
        }

        _ = try await uploader(session, logs, confirmWaitMs: 200).upload(face("1_1.0.0", file))

        XCTAssertEqual(standard.received, file)
        XCTAssertTrue(logs.contains("another file id; ignored"))
    }

    func testZeroUnitSizeIsAProtocolError() async throws {
        let standard = StandardUploadWatch(file: payload(100), unit: 0, chunk: 100)
        let (_, session, logs) = setup { standard.respond($0) }
        do {
            _ = try await uploader(session, logs).upload(face("1_1.0.0", payload(100)))
            XCTFail("expected a protocol error")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .protocolError)
            XCTAssertTrue(e.message.contains("unit size"))
        }
    }

    func testASilentWatchTimesOut() async throws {
        let (_, session, logs) = setup { _ in [] }
        do {
            _ = try await uploader(session, logs, stallMs: 300).upload(face("1_1.0.0", payload(10)))
            XCTFail("expected a timeout")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .timeout)
            XCTAssertTrue(e.message.contains("accept the file"))
        }
    }

    func testAWatchThatStopsAskingForDataTimesOutWithTheProgressMade() async throws {
        let file = payload(600)
        let standard = StandardUploadWatch(file: file, unit: 64, chunk: 300)
        let (_, session, logs) = setup { m in
            // Swallow the answer to the chunk that ends the first block request: after the first chunk the watch goes quiet.
            if m.service == 0x28 && m.command == 0x06 && standard.receivedBytes + (m.payload.count - 6) >= 300 {
                _ = standard.respond(m)
                return []
            }
            return standard.respond(m)
        }
        do {
            _ = try await uploader(session, logs, stallMs: 300).upload(face("1_1.0.0", file))
            XCTFail("expected a timeout")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .timeout)
            XCTAssertTrue(e.message.contains("chunk requests"))
        }
    }

    func testAClosedSessionFailsTheUploadAtOnce() async throws {
        let (_, session, logs) = setup { _ in [] }
        await session.close(WearError(.disconnected, "Connection lost"))
        do {
            _ = try await uploader(session, logs, stallMs: 30_000).upload(face("1_1.0.0", payload(10)))
            XCTFail("expected a disconnect")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .disconnected)
        }
    }

    func testASessionClosedMidUploadFailsItWithoutWaitingForTheStall() async throws {
        let (_, session, logs) = setup { _ in [] }
        let started = Date()
        Task {
            try? await Task.sleep(nanoseconds: 150_000_000)
            await session.close(WearError(.disconnected, "Connection lost"))
        }
        do {
            _ = try await uploader(session, logs, stallMs: 30_000).upload(face("1_1.0.0", payload(10)))
            XCTFail("expected a disconnect")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .disconnected)
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)
    }

    func testMissingConfirmationAfterTheTransferIsOnlyLogged() async throws {
        let file = payload(100)
        let standard = StandardUploadWatch(file: file, unit: 64, chunk: 100, confirmReport: nil)
        let (_, session, logs) = setup { standard.respond($0) }

        let outcome = try await uploader(session, logs, confirmWaitMs: 300).upload(face("8_1.0.0", file))

        XCTAssertNil(outcome.confirmReportType)
        XCTAssertFalse(outcome.activateRequested)
        XCTAssertTrue(logs.contains("no WatchfaceConfirm"))
    }

    func testResultStatusOfTheWatchIsReportedNotInterpreted() async throws {
        let file = payload(100)
        let standard = StandardUploadWatch(file: file, unit: 64, chunk: 100, confirmReport: nil, resultStatus: 3)
        let (_, session, logs) = setup { standard.respond($0) }

        let outcome = try await uploader(session, logs, confirmWaitMs: 100).upload(face("8_1.0.0", file))

        XCTAssertEqual(outcome.resultStatus, 3)
        XCTAssertTrue(logs.contains("FileUploadResult: watch status=3"))
    }

    func testNonWatchfaceUploadsDoNotWaitForTheWatchfaceConfirm() async throws {
        let file = payload(100)
        let standard = StandardUploadWatch(file: file, unit: 64, chunk: 100, confirmReport: nil)
        let (_, session, logs) = setup { standard.respond($0) }

        let started = Date()
        _ = try await uploader(session, logs, confirmWaitMs: 5_000).upload(UploadFile(fileName: "m_1.0.0", fileType: FileUpload.Filetype.music, data: file))

        XCTAssertLessThan(Date().timeIntervalSince(started), 3, "did not wait for a confirm")
    }

    func testAConfirmationThatArrivesSecondsAfterTheResultIsStillHandled() async throws {
        let file = payload(100)
        let standard = StandardUploadWatch(file: file, unit: 64, chunk: 100, confirmReport: nil)
        let holder = SessionHolder()
        let (_, session, logs) = setup { m in
            if m.service == 0x28 && m.command == 0x07 {
                Task {
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    var t = HuaweiTLV()
                    t.put(0x01, string: "8")
                    t.put(0x02, string: "1.0.0")
                    t.put(0x03, int: 2)
                    holder.session?.onData(UploadFakeWatch.tlvFrame(0x27, 0x05, t))
                }
            }
            return standard.respond(m)
        }
        holder.session = session

        let outcome = try await uploader(session, logs, confirmWaitMs: 3_000).upload(face("8_1.0.0", file))

        XCTAssertEqual(outcome.confirmReportType, 2)
        XCTAssertTrue(outcome.activateRequested)
        XCTAssertEqual(standard.requests.count, 1)
    }

    func testAnActivationTheWatchDoesNotAnswerIsOnlyLogged() async throws {
        let file = payload(100)
        let standard = StandardUploadWatch(file: file, unit: 64, chunk: 100)
        let (_, session, logs) = setup { m in m.service == 0x27 && m.command == 0x03 ? [] : standard.respond(m) }

        let outcome = try await uploader(session, logs).upload(face("8_1.0.0", file))

        XCTAssertTrue(outcome.activateRequested)
        XCTAssertNil(outcome.activateCode)
        XCTAssertTrue(logs.contains("no answer from the watch"))
    }

    func testAWatchThatReportsTheFaceDeletedIsNoticed() async throws {
        let file = payload(100)
        let standard = StandardUploadWatch(file: file, unit: 64, chunk: 100)
        let (_, session, logs) = setup { m in
            var frames = standard.respond(m)
            if m.service == 0x28 && m.command == 0x07 {
                var t = HuaweiTLV()
                t.put(0x01, string: "8")
                t.put(0x02, string: "1.0.0")
                t.put(0x03, int: 3)
                frames.append(UploadFakeWatch.tlvFrame(0x27, 0x05, t))
            }
            return frames
        }

        let outcome = try await uploader(session, logs, settleMs: 500).upload(face("8_1.0.0", file))

        XCTAssertTrue(outcome.removedByWatch)
        XCTAssertTrue(logs.contains("the watch reports 8_1.0.0 deleted"))
    }

    func testFileInfoAndHashAreLoggedInTheClearBeforeEncryption() async throws {
        let file = payload(1000)
        let standard = StandardUploadWatch(file: file, unit: 64, chunk: 300)
        let (_, session, logs) = setup { standard.respond($0) }

        _ = try await uploader(session, logs).upload(face("123456789_2.8.2", file))

        XCTAssertTrue(
            logs.contains("FileInfoSend TLV before encryption: 01=\"123456789_2.8.2\" 02=000003E8 03=01 05=\"123456789\" 06=\"2.8.2\""),
            logs.messages.joined(separator: "\n")
        )
        XCTAssertTrue(logs.contains("FileHashSend TLV before encryption: 01=07 03=\(SHA256.hash(file).hexUpper)"))
    }

    func testDescribeUploadCodeKnowsGbsThreeCodes() {
        XCTAssertTrue(FileUploader.describeUploadCode(140_004, "x").contains("too many"))
        XCTAssertTrue(FileUploader.describeUploadCode(140_008, "x").contains("already has"))
        XCTAssertTrue(FileUploader.describeUploadCode(140_009, "x").contains("free space"))
        XCTAssertTrue(FileUploader.describeUploadCode(1, "file info").contains("code 1"))
    }

    func testDescribeTlvShowsPrintableValuesAsTextAndTheRestAsHex() {
        var tlv = HuaweiTLV()
        tlv.put(0x01, string: "123456789_2.8.2")
        tlv.put(0x02, int: 1_000_000)
        tlv.put(0x03, byte: 1)
        tlv.put(0x0a, bytes: [])
        tlv.put(0x7f, int: 100_000)
        XCTAssertEqual(describeTlv(tlv), "01=\"123456789_2.8.2\" 02=000F4240 03=01 0a= 7f=000186A0")
        XCTAssertEqual(describeTlv(HuaweiTLV()), "(empty)")
        XCTAssertEqual(describeTlv(nil), "(none)")
    }
}

final class SessionHolder: @unchecked Sendable {
    var session: HuaweiSession?
}

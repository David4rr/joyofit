// Port of the Kotlin FileUploader.kt (derived from Gadgetbridge, AGPL-3.0-or-later): HuaweiUploadManager, AsynchronousResponse.handleFileUpload /
// handleWatchface and the requests SendFileUploadInfo, SendFileUploadHash, SendFileUploadAck, SendFileUploadChunk, SendFileUploadComplete,
// SendWatchfaceConfirm and SendWatchfaceOperation. The watch drives and the phone answers; GB handles every packet as "unrequested", here they
// reach one inbox through `HuaweiSession.subscribe` and are answered in order:
//
//   phone 28/02 FileInfoSend(name, size, type)        watch 28/02 result (100000 = ok)
//   watch 28/03 file id                               phone 28/03 FileHashSend(id, SHA-256)
//   watch 28/04 params (unit, max apply, no_encrypt)  phone 28/04 ack
//   watch 28/05 (bytesUploaded, nextChunkSize)        phone 28/06 chunk, in unit-size packets   (repeats)
//   watch 28/07 result (tag 02: 1 = file accepted)    phone 28/07 result ack
//   watch 27/05 watch face confirm (reportType)       phone 27/05 confirm, and 27/03 "active" when reportType is 2
//
// For a watch face the caller has announced it with 27/03 first (`WatchfaceOps.install`), as Huawei Health does. A 28/08 from the watch is
// its error report. Every watch message must arrive within `stallMs` of the previous one. Failures throw `WearError`: `.uploadRejected` with
// the exact status the watch returned (`statusCode`), `.timeout`, `.protocolError` or `.disconnected`.
import Foundation

/// The status the watch answers with when it accepts a file (GB `resp.result != 100000`, the 0x7f tags it sends as "ok").
public let uploadOK: Int32 = 100_000

/// `reportType` of 27/05 (Huawei Health `REPORT_STATUS_WATCHFACE_TRANSFER_SUCCESS` / `_DELETE`).
public let watchfaceTransferred: Int32 = 2
public let watchfaceDeleted: Int32 = 3

/// Where a P2P file goes (GB `FileUploadInfo.setSrcPackage` ...): the sending module package, the watch app package and both fingerprints.
public struct P2pRoute: Equatable, Sendable {
    public let srcPackage: String
    public let dstPackage: String
    public let srcFingerprint: String
    public let dstFingerprint: String

    public init(srcPackage: String, dstPackage: String, srcFingerprint: String, dstFingerprint: String) {
        self.srcPackage = srcPackage
        self.dstPackage = dstPackage
        self.srcFingerprint = srcFingerprint
        self.dstFingerprint = dstFingerprint
    }
}

/// What GB's `UploadDataBuffer` holds: the bytes to send and their SHA-256, which the watch asks for.
public struct UploadFile: Sendable {
    public let fileName: String
    public let fileType: UInt8
    public let data: Bytes
    public let route: P2pRoute?
    public let sha256: Bytes

    public init(fileName: String, fileType: UInt8, data: Bytes, route: P2pRoute? = nil) {
        self.fileName = fileName
        self.fileType = fileType
        self.data = data
        self.route = route
        self.sha256 = SHA256.hash(data)
    }
}

/// What the watch reported once the upload ran through.
public struct UploadOutcome: Equatable, Sendable {
    public let fileId: Int
    /// Tag 0x02 of the watch's 0x28/0x07 "result" packet; GB ignores it. Nil when the packet had none.
    public let resultStatus: Int?
    /// `reportType` of the watch's 0x27/0x05 watch face confirmation; nil when none arrived in time.
    public let confirmReportType: Int?
    /// The watch asked for the new face to be made active (reportType 2) and we sent the command.
    public let activateRequested: Bool
    /// The status in the watch's answer to that activation command (tag 0x7f); nil when it sent none or did not answer.
    public let activateCode: Int?
    /// The watch confirmed the face and then reported it deleted (27/05 reportType 3) within the settle window.
    public let removedByWatch: Bool
}

/// The tags of `tlv` for the log, in the clear: GB encrypts them on the wire, so this is the only way to see what the watch is really sent.
/// A printable value is shown as text, everything else as hex.
public func describeTlv(_ tlv: HuaweiTLV?) -> String {
    guard let tlv else { return "(none)" }
    if tlv.entries.isEmpty { return "(empty)" }
    return tlv.entries.map { entry in
        let tag = (entry.tag < 16 ? "0" : "") + String(entry.tag, radix: 16)
        let value = entry.value
        if value.count > 1 && value.allSatisfy({ (0x20...0x7E).contains($0) }) {
            return "\(tag)=\"\(String(decoding: value, as: UTF8.self))\""
        }
        return "\(tag)=\(value.hexUpper)"
    }.joined(separator: " ")
}

extension Watchface.WatchfaceOperation {
    /// GB's request without its `split("_")[1]`, which throws for a face without a version: the id is what precedes the first `_`.
    public static func request(joinedName fileName: String, operation: UInt8) -> HuaweiPacket {
        if let separator = fileName.firstIndex(of: "_") {
            return request(id: String(fileName[..<separator]), version: String(fileName[fileName.index(after: separator)...]), operation: operation)
        }
        return request(id: fileName, version: "", operation: operation)
    }
}

public final class FileUploader: @unchecked Sendable {
    /// How long the watch may stay silent between two of its messages.
    public static let stallMs = 60_000
    /// How long to wait for the 27/05 confirmation after the transfer finished. Huawei Health keeps its install state for 60 s and has no
    /// shorter limit; the watch unpacks and verifies the face after the last chunk.
    public static let confirmWaitMs = 60_000
    /// How long to keep listening after the confirmation for the watch to report the face deleted; it took about 3.4 s.
    public static let settleMs = 8_000
    private static let pollMs = 500

    private let session: HuaweiSession
    private let caps: DeviceCaps?
    private let log: LogSink
    private let onProgress: @Sendable (_ bytes: Int, _ total: Int) -> Void
    private let stallMs: Int
    private let confirmWaitMs: Int
    private let settleMs: Int
    private let queryMs: Int
    private var params: ParamsProvider { session.params }

    public init(
        session: HuaweiSession, caps: DeviceCaps? = nil, log: @escaping LogSink,
        onProgress: @escaping @Sendable (_ bytes: Int, _ total: Int) -> Void = { _, _ in },
        stallMs: Int = FileUploader.stallMs, confirmWaitMs: Int = FileUploader.confirmWaitMs, settleMs: Int = FileUploader.settleMs,
        queryMs: Int = Timeouts.queryMs
    ) {
        self.session = session
        self.caps = caps
        self.log = log
        self.onProgress = onProgress
        self.stallMs = stallMs
        self.confirmWaitMs = confirmWaitMs
        self.settleMs = settleMs
        self.queryMs = queryMs
    }

    private final class UploadState {
        let file: UploadFile
        var fileId: UInt8?
        var unitSize = 0
        var maxApplyData = 0
        var noEncrypt: Int8 = 0
        var chunks = 0
        var started = false
        var resultStatus: Int?
        var resultSent = false
        var confirmReportType: Int?
        var activateRequested = false
        var activateCode: Int?
        var removedByWatch = false

        init(_ file: UploadFile) { self.file = file }
    }

    public func upload(_ file: UploadFile) async throws -> UploadOutcome {
        let state = UploadState(file)
        let inbox = FileBlockInbox()
        var subscriptions = [Int]()
        for command in [
            FileUpload.FileInfoSend.id, FileUpload.FileHashSend.id, FileUpload.FileUploadConsultAck.id, FileUpload.FileNextChunkParams.id,
            FileUpload.FileUploadResult.id, FileUpload.FileUploadDeviceResponse.id,
        ] {
            subscriptions.append(await session.subscribe(service: FileUpload.id, command: command, label: "file upload \(file.fileName)") { inbox.push($0) })
        }
        subscriptions.append(
            await session.subscribe(service: Watchface.id, command: Watchface.WatchfaceConfirm.id, label: "watch face confirm \(file.fileName)") { inbox.push($0) }
        )
        do {
            let outcome = try await run(state, inbox)
            await release(inbox, subscriptions)
            return outcome
        } catch {
            await release(inbox, subscriptions)
            throw error
        }
    }

    private func release(_ inbox: FileBlockInbox, _ subscriptions: [Int]) async {
        inbox.close()
        for id in subscriptions { await session.unsubscribe(id) }
    }

    private func run(_ state: UploadState, _ inbox: FileBlockInbox) async throws -> UploadOutcome {
        let file = state.file
        note("start \(file.fileName): type=\(file.fileType) size=\(file.data.count) sha256=\(file.sha256.hexUpper)")
        onProgress(0, file.data.count)
        if let caps, !caps.supports(Int(FileUpload.id), Int(FileUpload.FileInfoSend.id)) {
            // The Fit 4 does not list service 0x28 in SupportedServices, but GB sends the upload without checking.
            note("the watch did not list FileUpload (28/02) as supported; trying anyway, like GB")
        }
        let route = file.route
        let info: HuaweiPacket
        do {
            info = try FileUpload.FileInfoSend.request(
                fileSize: Int32(truncatingIfNeeded: file.data.count), fileName: file.fileName, fileType: file.fileType,
                srcPackage: route?.srcPackage, dstPackage: route?.dstPackage, srcFingerprint: route?.srcFingerprint, dstFingerprint: route?.dstFingerprint
            )
        } catch {
            throw protocolError("FileInfoSend could not be created: \(error)")
        }
        note("FileInfoSend TLV before encryption: \(describeTlv(info.tlv))")
        try await session.send(info, label: "FileUpload FileInfoSend \(file.fileName)")

        while !state.resultSent {
            guard let packet = try await next(inbox, stallMs) else { throw stalled(state) }
            try await handle(state, packet)
        }

        if file.fileType == FileUpload.Filetype.watchface && state.confirmReportType == nil {
            try await waitForConfirm(state, inbox)
        }
        if file.fileType == FileUpload.Filetype.watchface && state.confirmReportType == Int(watchfaceTransferred) {
            try await waitForRemoval(state, inbox)
        }
        onProgress(file.data.count, file.data.count)
        note(
            "complete \(file.fileName): \(state.chunks) chunk requests, result status=\(state.resultStatus.map(String.init) ?? "none"), "
                + "confirm reportType=\(state.confirmReportType.map(String.init) ?? "none"), activation status=\(state.activateCode.map(String.init) ?? "none"), "
                + "removed by the watch=\(state.removedByWatch)"
        )
        return UploadOutcome(
            fileId: Int(state.fileId ?? 0), resultStatus: state.resultStatus, confirmReportType: state.confirmReportType,
            activateRequested: state.activateRequested, activateCode: state.activateCode, removedByWatch: state.removedByWatch
        )
    }

    /// One watch message, in GB `handleFileUpload` / `handleWatchface` order of concerns.
    private func handle(_ state: UploadState, _ packet: HuaweiPacket) async throws {
        if packet.serviceId == Watchface.id {
            try await handleConfirm(state, packet)
            return
        }
        switch packet.commandId {
        case FileUpload.FileInfoSend.id:
            let response: FileUpload.FileInfoSend.Response = try parsed(packet, "FileInfoSend")
            note("FileInfoSend: watch answered \(response.result)")
            if response.result != uploadOK { throw rejected("file info", Int(response.result)) }

        case FileUpload.FileHashSend.id:
            let response: FileUpload.FileHashSend.Response = try parsed(packet, "FileHashSend")
            state.fileId = response.fileId
            note("FileHashSend: watch assigned file id \(response.fileId), sending SHA-256 (watch TLV: \(describeTlv(packet.tlv)))")
            let hash = FileUpload.FileHashSend.request(hash: state.file.sha256, fileId: response.fileId)
            note("FileHashSend TLV before encryption: \(describeTlv(hash.tlv))")
            try await session.send(hash, label: "FileUpload hash")

        case FileUpload.FileUploadConsultAck.id:
            let response: FileUpload.FileUploadConsultAck.Response = try parsed(packet, "FileUploadConsultAck")
            let p = response.fileUploadParams
            note(
                "FileUploadConsultAck: fileId=\(UInt8(bitPattern: p.fileId)) protocol=\(p.protocolVersion) appWaitTime=\(p.appWaitTime) "
                    + "bitmapEnable=\(p.bitmapEnable) unitSize=\(p.unitSize) maxApplyDataSize=\(p.maxApplyDataSize) "
                    + "interval=\(p.interval) receivedFileSize=\(p.receivedFileSize) noEncrypt=\(p.noEncrypt)"
            )
            if p.unitSize <= 0 { throw protocolError("the watch reported an unusable unit size \(p.unitSize)") }
            state.unitSize = Int(p.unitSize)
            state.maxApplyData = Int(p.maxApplyDataSize)
            state.noEncrypt = p.noEncrypt
            state.started = true
            let fileId: UInt8
            if let known = state.fileId {
                fileId = known
            } else {
                fileId = UInt8(bitPattern: p.fileId)
                state.fileId = fileId
            }
            try await session.send(FileUpload.FileUploadConsultAck.request(noEncryption: UInt8(bitPattern: p.noEncrypt), fileId: fileId), label: "FileUpload ack")

        case FileUpload.FileNextChunkParams.id:
            try await sendChunk(state, try parsed(packet, "FileNextChunkParams"))

        case FileUpload.FileUploadResult.id:
            guard let fileId = state.fileId else { throw protocolError("the watch reported a result before it assigned a file id") }
            var status: Int?
            if let response = try? FileUpload.FileUploadResult.Response(packet: packet), response.status >= 0 {
                status = Int(response.status)
            }
            state.resultStatus = status
            note(
                "FileUploadResult: watch status=\(status.map(String.init) ?? "unreadable") (Huawei Health reads it as the validity result, 1 = the file was accepted; "
                    + "watch TLV: \(describeTlv(packet.tlv))); sending the result ack"
            )
            state.resultSent = true
            try await session.send(FileUpload.FileUploadResult.request(fileId: fileId), label: "FileUpload result ack")

        case FileUpload.FileUploadDeviceResponse.id:
            let response: FileUpload.FileUploadDeviceResponse.Response = try parsed(packet, "FileUploadDeviceResponse")
            let current = state.fileId
            note("FileUploadDeviceResponse: fileId=\(response.fileId) code=\(response.code)")
            // GB: only an error report for the current upload ends it.
            if current == nil || current == response.fileId { throw rejected("device response", Int(response.code)) }
            note("FileUploadDeviceResponse is for another file id; ignored")

        default:
            note("ignored 28/\(String(packet.commandId, radix: 16))")
        }
    }

    /// GB `FileNextChunkParams` -> `SendFileUploadChunk`.
    private func sendChunk(_ state: UploadState, _ request: FileUpload.FileNextChunkParams) async throws {
        let total = state.file.data.count
        let position = Int(request.bytesUploaded)
        let wanted = Int(request.nextchunkSize)
        guard let fileId = state.fileId else { throw protocolError("the watch asked for data before it assigned a file id") }
        if !state.started { throw protocolError("the watch asked for data before the unit size was agreed") }
        if position < 0 || position > total { throw protocolError("the watch asked for data at \(position) of a \(total) byte file") }
        if wanted < 0 { throw protocolError("the watch asked for \(wanted) bytes") }
        let size = min(wanted, total - position)
        state.chunks += 1
        onProgress(position, total)
        note("FileNextChunkParams: bytesUploaded=\(position) nextChunkSize=\(wanted) (\(Self.percent(position, total))%)")
        if size < wanted { note("the watch asked for \(wanted) bytes at \(position) but only \(size) are left; sending \(size)") }
        if state.maxApplyData > 0 && wanted > state.maxApplyData {
            note("the watch asked for \(wanted) bytes, more than its own maxApplyDataSize \(state.maxApplyData); sending what it asked for, like GB")
        }
        if size == 0 { return }
        let encrypted = state.noEncrypt == 0 && params.transactionsCrypted
        let chunk = Array(state.file.data[position..<position + size])
        let frames: [Bytes]
        do {
            frames = try FileUpload.FileNextChunkSend.packet().serializeFileChunk(
                chunk, uploadPosition: position, unitSize: state.unitSize, fileId: fileId, useEncryption: encrypted, params: params
            )
        } catch {
            throw protocolError("file chunk at \(position) could not be created: \(error)")
        }
        try await session.sendFrames(
            frames, service: FileUpload.id, command: FileUpload.FileNextChunkSend.id,
            label: "FileUpload chunk offset=\(position) size=\(size) unit=\(state.unitSize)\(encrypted ? " encrypted" : "")", logFrames: false
        )
    }

    /// GB `handleWatchface` and Huawei Health `WatchFaceDeviceService.handleReportStatus`: every report is acknowledged. reportType 2
    /// (transfer success) means "make the uploaded face active" (Huawei Health calls `applyWatchFace` without a signature at this point);
    /// reportType 3 is the watch reporting a face deleted.
    private func handleConfirm(_ state: UploadState, _ packet: HuaweiPacket) async throws {
        let response: Watchface.WatchfaceConfirm.Response = try parsed(packet, "WatchfaceConfirm")
        note("WatchfaceConfirm: \(response.fileName) reportType=\(response.reportType)")
        do {
            try await session.send(try Watchface.WatchfaceConfirm.request(fileName: response.fileName), label: "WatchfaceConfirm \(response.fileName)")
        } catch let e as PacketError {
            throw protocolError("WatchfaceConfirm could not be created: \(e)")
        }
        if response.reportType == watchfaceDeleted {
            if response.fileName == state.file.fileName {
                state.removedByWatch = true
                note("the watch reports \(response.fileName) deleted")
            }
            return
        }
        if state.confirmReportType != nil { return }
        state.confirmReportType = Int(response.reportType)
        if response.reportType == watchfaceTransferred {
            state.activateRequested = true
            let label = "WatchfaceOperation active \(response.fileName)"
            do {
                let answer = try await session.request(
                    Watchface.WatchfaceOperation.request(joinedName: response.fileName, operation: Watchface.WatchfaceOperation.operationActive),
                    timeoutMs: queryMs, label: label
                )
                let code = (try? Watchface.WatchfaceOperation.Response(packet: answer))?.code
                state.activateCode = code.flatMap { $0 >= 0 ? Int($0) : nil }
                note("\(label): watch answered \(state.activateCode.map(String.init) ?? "no status")")
            } catch let e as WearError {
                if e.code != .timeout { throw e }
                note("\(label): no answer from the watch")
            }
        }
    }

    /// The watch confirms a finished face with 27/05 shortly after 28/07; its absence is only logged.
    private func waitForConfirm(_ state: UploadState, _ inbox: FileBlockInbox) async throws {
        var waited = 0
        while state.confirmReportType == nil && waited < confirmWaitMs {
            let started = DispatchTime.now().uptimeNanoseconds
            guard let packet = try await next(inbox, confirmWaitMs - waited) else {
                note("no WatchfaceConfirm from the watch within \(confirmWaitMs)ms")
                return
            }
            try await handle(state, packet)
            waited += Int((DispatchTime.now().uptimeNanoseconds - started) / 1_000_000)
        }
    }

    /// A watch that does not keep a face (no Huawei signature, see `WatchfaceOps.install`) confirms it, then sends a 27/05 reportType 3 for
    /// it about 3 s later; the face list read before that still shows it. Listen for it.
    private func waitForRemoval(_ state: UploadState, _ inbox: FileBlockInbox) async throws {
        var waited = 0
        while !state.removedByWatch && waited < settleMs {
            let started = DispatchTime.now().uptimeNanoseconds
            guard let packet = try await next(inbox, settleMs - waited) else { return }
            try await handle(state, packet)
            waited += Int((DispatchTime.now().uptimeNanoseconds - started) / 1_000_000)
        }
    }

    /// The next watch message, or nil after `limitMs` without one. A closed session fails at once.
    private func next(_ inbox: FileBlockInbox, _ limitMs: Int) async throws -> HuaweiPacket? {
        var waited = 0
        while waited < limitMs {
            if let cause = await session.closeCause { throw cause }
            try Task.checkCancellation()
            let slice = min(Self.pollMs, limitMs - waited)
            if let packet = await inbox.receive(timeoutMs: slice) { return packet }
            waited += slice
        }
        if let cause = await session.closeCause { throw cause }
        return nil
    }

    private func stalled(_ state: UploadState) -> WearError {
        let stage: String
        if state.fileId == nil && !state.started {
            stage = "waiting for the watch to accept the file"
        } else if !state.started {
            stage = "waiting for the watch to start the transfer"
        } else {
            stage = "waiting for the watch to ask for data (\(state.chunks) chunk requests so far)"
        }
        return WearError(.timeout, "File upload \(state.file.fileName): the watch sent nothing for \(stallMs / 1000) s while \(stage)")
    }

    private func rejected(_ stage: String, _ code: Int) -> WearError {
        log(LogEntry(.error, "Upload: rejected by the watch at \(stage): status code \(code)"))
        return WearError(.uploadRejected, Self.describeUploadCode(code, stage), statusCode: code)
    }

    private func protocolError(_ message: String) -> WearError { WearError(.protocolError, "File upload: \(message)") }

    /// GB ResponseTypeMismatchException and handleResponse: a packet that does not read is a protocol error.
    private func parsed<R: PacketResponse>(_ packet: HuaweiPacket, _ what: String) throws -> R {
        do {
            return try R(packet: packet)
        } catch {
            throw protocolError("\(what) could not be parsed: \(error)")
        }
    }

    private func note(_ message: String) { log(LogEntry(.info, "Upload: \(message)")) }

    private static func percent(_ done: Int, _ total: Int) -> Int { total <= 0 ? 100 : done * 100 / total }

    /// GB's `onError` maps three codes to toasts (140004 too many faces or musics, 140008 file exists, 140009 no space); every other code is
    /// reported as it came, because what the watch means by it is not documented.
    public static func describeUploadCode(_ code: Int, _ stage: String) -> String {
        switch code {
        case 140004: return "The watch has too many watch faces installed (code 140004). Delete one and try again."
        case 140008: return "The watch already has this file (code 140008)."
        case 140009: return "The watch does not have enough free space (code 140009)."
        default: return "The watch rejected the file at the \(stage) step with code \(code). This is the status it returned; its meaning is not documented."
        }
    }
}

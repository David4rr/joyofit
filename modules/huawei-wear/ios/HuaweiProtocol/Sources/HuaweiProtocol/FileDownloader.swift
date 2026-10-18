// Port of the Kotlin FileDownloader.kt (Derived from Gadgetbridge, AGPL-3.0-or-later): service/devices/huawei/HuaweiFileDownloadManager
// and the requests GetFileDownloadInit/GetFileParameters/GetFileInfo/GetFileBlock/GetFileDownloadComplete, for downloads the phone
// starts (no incoming P2P files and, as in the Kotlin, no SHA-256 verification: GB verifies only device-initiated files).
//
// Instead of GB's callback state machine each `download` is one async call; the 0x05 data packets the watch pushes after a block
// request reach it through `HuaweiSession.subscribe` (GB's FileDataReceiver). Failures throw `WearError`: `.timeout`, `.protocolError`
// (GB's HuaweiFileDownload*Exception cases) and `.disconnected` (from the session). Downloads must not overlap, like GB's `isBusy` queue.
import Foundation

/// The file kinds GB's download manager is asked for (HuaweiFileDownloadManager.FileType).
public enum DownloadFileType: Equatable, Sendable {
    case sleepState, sleepData, sequenceData, rri, gps

    /// The Kotlin enum constant name, for logs.
    public var name: String {
        switch self {
        case .sleepState: return "SLEEP_STATE"
        case .sleepData: return "SLEEP_DATA"
        case .sequenceData: return "SEQUENCE_DATA"
        case .rri: return "RRI"
        case .gps: return "GPS"
        }
    }

    public var service2c: FileDownloadService2C.FileType {
        switch self {
        case .sleepState: return .sleepState
        case .sleepData: return .sleepData
        case .sequenceData: return .sequenceData
        case .rri: return .rri
        case .gps: return .gps
        }
    }
}

/// GB `HuaweiFileDownloadManager.FileRequest` for files the phone asks for.
public struct FileRequest: CustomStringConvertible, Sendable {
    public let filename: String
    public let type: DownloadFileType
    /// True: service 0x2C. False: the older service 0x0A.
    public let newSync: Bool
    public let startTime: Int32
    public let endTime: Int32
    public let dictId: Int32
    /// GPS files only: the watch's workout number (GB `FileRequest.workoutId`).
    public let workoutId: Int16

    private init(filename: String, type: DownloadFileType, newSync: Bool, startTime: Int, endTime: Int, dictId: Int, workoutId: Int16 = 0) {
        self.filename = filename
        self.type = type
        self.newSync = newSync
        // Kotlin Int: the wire carries 32-bit seconds.
        self.startTime = Int32(truncatingIfNeeded: startTime)
        self.endTime = Int32(truncatingIfNeeded: endTime)
        self.dictId = Int32(truncatingIfNeeded: dictId)
        self.workoutId = workoutId
    }

    public var description: String {
        "\(filename) (\(type.name), \(newSync ? "service 2C" : "service 0A"), start=\(startTime) end=\(endTime)"
            + (dictId > 0 ? " dict=\(dictId)" : "") + ")"
    }

    public static func sleepState(newSync: Bool, start: Int, end: Int) -> FileRequest {
        FileRequest(filename: "sleep_state.bin", type: .sleepState, newSync: newSync, startTime: start, endTime: end, dictId: 0)
    }

    public static func sleepData(newSync: Bool, start: Int, end: Int) -> FileRequest {
        FileRequest(filename: "sleep_data.bin", type: .sleepData, newSync: newSync, startTime: start, endTime: end, dictId: 0)
    }

    public static func sequenceData(start: Int, end: Int, dictId: Int) -> FileRequest {
        FileRequest(filename: "sequence_data", type: .sequenceData, newSync: true, startTime: start, endTime: end, dictId: dictId)
    }

    /// GB `FileRequest.rriFileRequest`: `rrisqi_data.bin`, service 0x2C when SettingRelated said `rriNewSync`, else 0x0A.
    public static func rri(newSync: Bool, start: Int, end: Int) -> FileRequest {
        FileRequest(filename: "rrisqi_data.bin", type: .rri, newSync: newSync, startTime: start, endTime: end, dictId: 0)
    }

    /// GB `FileRequest.workoutGpsFileRequest`: new sync asks for `<n>_gps.bin` over service 0x2C (start/end 0); old sync has no
    /// name yet, the 0x0A init answers with the list of the workout's files.
    public static func workoutGps(newSync: Bool, workoutId: Int16) -> FileRequest {
        FileRequest(filename: newSync ? "\(workoutId)_gps.bin" : "", type: .gps, newSync: newSync, startTime: 0, endTime: 0, dictId: 0, workoutId: workoutId)
    }
}

/// The 0x05 packets the watch pushes while a block is being sent: filled from the session's executor, drained by one download.
/// (Also the inbox of the file upload, which collects every packet the watch pushes.)
final class FileBlockInbox: @unchecked Sendable {
    private struct Waiter {
        let token: UInt64
        let continuation: CheckedContinuation<HuaweiPacket?, Never>
        var timer: Task<Void, Never>?
    }

    private let lock = NSLock()
    private var items: [HuaweiPacket] = []
    private var waiter: Waiter?
    private var nextToken: UInt64 = 0
    private var closed = false

    func push(_ packet: HuaweiPacket) {
        lock.lock()
        if closed {
            lock.unlock()
            return
        }
        guard let w = waiter else {
            items.append(packet)
            lock.unlock()
            return
        }
        waiter = nil
        lock.unlock()
        w.timer?.cancel()
        w.continuation.resume(returning: packet)
    }

    /// No more packets are taken; a waiting `receive` gives up.
    func close() {
        lock.lock()
        closed = true
        items.removeAll()
        let w = waiter
        waiter = nil
        lock.unlock()
        w?.timer?.cancel()
        w?.continuation.resume(returning: nil)
    }

    /// Kotlin `withTimeoutOrNull(timeoutMs) { incoming.receive() }`: nil when nothing arrives in time (or the task is cancelled).
    func receive(timeoutMs: Int) async -> HuaweiPacket? {
        await withTaskCancellationHandler {
            await withCheckedContinuation { (c: CheckedContinuation<HuaweiPacket?, Never>) in
                lock.lock()
                if !items.isEmpty {
                    let p = items.removeFirst()
                    lock.unlock()
                    c.resume(returning: p)
                    return
                }
                if closed || Task.isCancelled {
                    lock.unlock()
                    c.resume(returning: nil)
                    return
                }
                nextToken += 1
                let token = nextToken
                let timer = Task { [weak self] in
                    do { try await Task.sleep(nanoseconds: UInt64(max(timeoutMs, 0)) * 1_000_000) } catch { return }
                    self?.expire(token)
                }
                waiter = Waiter(token: token, continuation: c, timer: timer)
                lock.unlock()
            }
        } onCancel: {
            self.cancelWaiter()
        }
    }

    private func expire(_ token: UInt64) {
        lock.lock()
        guard let w = waiter, w.token == token else {
            lock.unlock()
            return
        }
        waiter = nil
        lock.unlock()
        w.continuation.resume(returning: nil)
    }

    private func cancelWaiter() {
        lock.lock()
        let w = waiter
        waiter = nil
        lock.unlock()
        w?.timer?.cancel()
        w?.continuation.resume(returning: nil)
    }
}

public final class FileDownloader: @unchecked Sendable {
    private let session: HuaweiSession
    private let log: LogSink
    private var params: ParamsProvider { session.params }

    /// Old sync only. GB's shortcut: after the first init the following requests whose name is in the returned list skip init and
    /// parameters and reuse `filenames`, `maxBlockSize` and `timeout`.
    private struct OldSyncContext {
        let filenames: [String]
        let maxBlockSize: Int
        let timeoutSec: Int
    }

    private let lock = NSLock()
    private var oldSync: OldSyncContext?

    private static let requestMs = 10_000
    /// Both file download services answer block requests with command 0x05.
    private static let blockResponseCommand: UInt8 = 0x05
    /// Used when the watch reports a block timeout of 0.
    private static let defaultBlockTimeoutSec = 10
    /// GB parses sequence files up to 20 MiB ("To avoid of downloading of very big file and OOM"); twice that is accepted here.
    private static let maxFileSize = 32 * 1024 * 1024

    public init(session: HuaweiSession, log: @escaping LogSink) {
        self.session = session
        self.log = log
    }

    public func download(_ request: FileRequest) async throws -> Bytes {
        info("Download \(request): start")
        let data = request.newSync ? try await downloadNewSync(request) : try await downloadOldSync(request)
        info("Download \(request.filename): complete, \(data.count) bytes")
        return data
    }

    // MARK: Service 0x2C: FileDownloadInit -> (FileRequestHash only for incoming files) -> FileInfo -> blocks -> complete

    private func downloadNewSync(_ request: FileRequest) async throws -> Bytes {
        let name = request.filename
        let expectedType = request.type.service2c
        let initRequest: HuaweiPacket
        do {
            initRequest = try FileDownloadService2C.FileDownloadInit.request(
                filename: name, fileType: expectedType, startTime: request.startTime, endTime: request.endTime, dictId: request.dictId
            )
        } catch {
            throw WearError(.protocolError, "FileDownloadInit \(name): request could not be created: \(error)", underlying: error)
        }
        let initResponse: FileDownloadService2C.FileDownloadInit.Response = try await session.request(
            initRequest, timeoutMs: Self.requestMs, label: "FileDownloadInit \(name)"
        )
        info("FileDownloadInit \(name): fileName=\(initResponse.fileName) type=\(initResponse.fileType.name) fileId=\(initResponse.fileId) size=\(initResponse.fileSize)")

        // GB HuaweiFileDownloadFileMismatchException: the answer must be for the file we asked for.
        if request.filename != initResponse.fileName {
            throw protocolError("\(name): data for wrong file received. Expected name \(name), got name \(initResponse.fileName)")
        }
        if expectedType != initResponse.fileType {
            throw protocolError("\(name): data for wrong file received. Expected type \(expectedType.name), got type \(initResponse.fileType.name)")
        }
        let fileId = initResponse.fileId
        let fileSize = Int(initResponse.fileSize)
        if fileSize < 0 {
            // GB: the watch reports 0xFFFFFFFF (with an error status TLV) for a sequence_data file it has no data for.
            throw protocolError("\(name): invalid file size reported by device: \(fileSize)")
        }
        if fileSize == 0 {
            try await completeNewSync(fileId: fileId, name: name)
            return []
        }
        try checkSize(name, fileSize)

        let fileInfo: FileDownloadService2C.FileInfo.Response = try await session.request(
            FileDownloadService2C.FileInfo.request(fileId: fileId), timeoutMs: Self.requestMs, label: "FileInfo \(name)"
        )
        info(
            "FileInfo \(name): fileId=\(fileInfo.fileId) timeout=\(fileInfo.timeout) "
                + "burstSize=\(fileInfo.burstSize) maxBlockSize=\(fileInfo.maxBlockSize) noEncrypt=\(fileInfo.noEncrypt)"
        )
        if fileInfo.fileId != fileId {
            throw protocolError("\(name): data for wrong file received. Expected id \(fileId), got id \(fileInfo.fileId)")
        }

        let data = try await receiveBlocks(
            service: FileDownloadService2C.id,
            name: name,
            fileSize: fileSize,
            maxBlockSize: Int(fileInfo.maxBlockSize),
            timeoutSec: Int(fileInfo.timeout),
            requestBlock: { offset, size in
                FileDownloadService2C.RequestBlock.request(
                    fileId: fileId, offset: Int32(offset), size: Int32(size), noEncrypt: fileInfo.noEncrypt, dictId: request.dictId
                )
            },
            accept: { packet, position in
                let block: FileDownloadService2C.BlockResponse
                do {
                    block = try FileDownloadService2C.BlockResponse(packet: packet, params: self.params)
                } catch {
                    throw self.blockParseError(name, error)
                }
                // GB: for new sync the file id must match.
                if block.fileId != fileId {
                    throw self.protocolError("\(name): data for wrong file received. Expected id \(fileId), got id \(block.fileId)")
                }
                if Int(block.offset) != position {
                    self.info("\(name): block offset \(block.offset) does not match received bytes \(position) (GB does not check)")
                }
                return block.data
            }
        )
        try await completeNewSync(fileId: fileId, name: name)
        return data
    }

    private func completeNewSync(fileId: UInt8, name: String) async throws {
        // GetFileDownloadCompleteRequest: status 1 = ok (GB only sends 2 when SHA-256 verification fails).
        try await session.send(FileDownloadService2C.FileDownloadCompleteRequest.request(fileId: fileId, status: 1), label: "FileDownloadComplete \(name)")
    }

    // MARK: Service 0x0A: FileDownloadInit (sleep files) -> FileParameters -> FileInfo -> blocks -> complete

    private func downloadOldSync(_ request: FileRequest) async throws -> Bytes {
        var name = request.filename
        let context: OldSyncContext
        switch request.type {
        case .sleepState:
            let initResponse: FileDownloadService0A.FileDownloadInit.Response = try await session.request(
                FileDownloadService0A.FileDownloadInit.sleepFilesRequest(startTime: request.startTime, endTime: request.endTime),
                timeoutMs: Self.requestMs, label: "FileDownloadInit \(name) (old sync)"
            )
            let names = initResponse.fileNames
            info("FileDownloadInit \(name) (old sync): files=\(names.joined(separator: ";"))")
            if !names.contains(name) {
                throw protocolError("\(name): file \(name) cannot be downloaded using this method. Only the following files are supported: \(Self.listString(names))")
            }
            // GetFileParametersRequest: fileType 0x01 = sleep files.
            let parameters: FileDownloadService0A.FileParameters.Response = try await session.request(
                FileDownloadService0A.FileParameters.request(fileType: 0x01), timeoutMs: Self.requestMs, label: "FileParameters \(name)"
            )
            logParameters(name, parameters)
            context = OldSyncContext(filenames: names, maxBlockSize: Int(parameters.maxBlockSize), timeoutSec: Int(parameters.timeout))
            storeOldSync(context)
        case .sleepData:
            // GB: SLEEP_DATA has no init of its own on the old service; it only ever rides on the file list of the SLEEP_STATE
            // request that ran before it.
            let shared = loadOldSync()
            guard let shared else { throw protocolError("\(name): no file list from a preceding sleep_state init (old sync)") }
            if !shared.filenames.contains(name) {
                throw protocolError("\(name): file \(name) cannot be downloaded using this method. Only the following files are supported: \(Self.listString(shared.filenames))")
            }
            info("FileDownloadInit \(name) (old sync): reusing file list \(shared.filenames.joined(separator: ";"))")
            context = shared
        case .gps:
            // GB HuaweiFileDownloadManager (old sync, GPS): the init answers with the workout's file list, only the `_gps.bin` file
            // is downloaded; parameters are fetched with fileType 0x02.
            let label = "workout \(request.workoutId) GPS (old sync)"
            let initResponse: FileDownloadService0A.FileDownloadInit.Response = try await session.request(
                FileDownloadService0A.FileDownloadInit.gpsFileRequest(workoutId: request.workoutId),
                timeoutMs: Self.requestMs, label: "FileDownloadInit \(label)"
            )
            let names = initResponse.fileNames
            info("FileDownloadInit \(label): files=\(names.joined(separator: ";"))")
            let gpsNames = names.filter { $0.contains("_gps.bin") }
            guard let firstGps = gpsNames.first else { throw protocolError("\(label): no _gps.bin file in \(Self.listString(names))") }
            if gpsNames.count > 1 { info("\(label): \(gpsNames.count) GPS files, downloading the first only") }
            name = firstGps
            let parameters: FileDownloadService0A.FileParameters.Response = try await session.request(
                FileDownloadService0A.FileParameters.request(fileType: 0x02), timeoutMs: Self.requestMs, label: "FileParameters \(name)"
            )
            logParameters(name, parameters)
            context = OldSyncContext(filenames: names, maxBlockSize: Int(parameters.maxBlockSize), timeoutSec: Int(parameters.timeout))
        case .rri:
            // GB getDownloadParameters: RRI parameters use fileType 0x04. The init answers with the file list
            // (GetFileDownloadInitRequest builds FileDownloadInit.RriFileRequest for RRI) and must contain the name.
            let initResponse: FileDownloadService0A.FileDownloadInit.Response = try await session.request(
                FileDownloadService0A.FileDownloadInit.rriFileRequest(startTime: request.startTime, endTime: request.endTime),
                timeoutMs: Self.requestMs, label: "FileDownloadInit \(name) (old sync)"
            )
            let names = initResponse.fileNames
            info("FileDownloadInit \(name) (old sync): files=\(names.joined(separator: ";"))")
            if !names.contains(name) {
                throw protocolError("\(name): file \(name) cannot be downloaded using this method. Only the following files are supported: \(Self.listString(names))")
            }
            let parameters: FileDownloadService0A.FileParameters.Response = try await session.request(
                FileDownloadService0A.FileParameters.request(fileType: 0x04), timeoutMs: Self.requestMs, label: "FileParameters \(name)"
            )
            logParameters(name, parameters)
            context = OldSyncContext(filenames: names, maxBlockSize: Int(parameters.maxBlockSize), timeoutSec: Int(parameters.timeout))
        case .sequenceData:
            throw protocolError("\(name): unknown download type for old sync")
        }

        let fileInfo: FileDownloadService0A.FileInfo.Response = try await session.request(
            FileDownloadService0A.FileInfo.request(fileName: name), timeoutMs: Self.requestMs, label: "FileInfo \(name) (old sync)"
        )
        info("FileInfo \(name) (old sync): fileLength=\(fileInfo.fileLength) transferType=\(fileInfo.transferType) createTime=\(fileInfo.fileCreateTime)")
        let fileSize = Int(fileInfo.fileLength)
        if fileSize < 0 { throw protocolError("\(name): invalid file size reported by device: \(fileSize)") }
        if fileSize == 0 {
            try await completeOldSync(name)
            return []
        }
        try checkSize(name, fileSize)

        let fileName = name
        let lastPacketNumber = PacketCounter()
        let data = try await receiveBlocks(
            service: FileDownloadService0A.id,
            name: fileName,
            fileSize: fileSize,
            maxBlockSize: context.maxBlockSize,
            timeoutSec: context.timeoutSec,
            newBlock: { lastPacketNumber.value = -1 },
            requestBlock: { offset, size in
                FileDownloadService0A.RequestBlock.request(fileName: fileName, offset: Int32(offset), size: Int32(size))
            },
            accept: { packet, _ in
                let block: FileDownloadService0A.BlockResponse
                do {
                    block = try FileDownloadService0A.BlockResponse(packet: packet, params: self.params)
                } catch {
                    throw self.blockParseError(fileName, error)
                }
                if case .crypto(let message)? = block.decodeError {
                    self.info("\(fileName): data could be decoded as TLV, but not decrypted (\(message))")
                }
                // GB compares the byte counter with `number - 1`; compared modulo 256 here so a block of more than 127 packets
                // cannot trip over the signed byte.
                let number = Int(block.number)
                if ((lastPacketNumber.value + 1) & 0xFF) != number {
                    throw self.protocolError("\(fileName): data for wrong file received. Expected packet number \((lastPacketNumber.value + 1) & 0xFF), got \(number)")
                }
                lastPacketNumber.value = number
                return block.data
            }
        )
        try await completeOldSync(name)
        return data
    }

    private final class PacketCounter {
        var value = -1
    }

    private func completeOldSync(_ name: String) async throws {
        try await session.send(FileDownloadService0A.FileDownloadCompleteRequest.request(), label: "FileDownloadComplete \(name) (old sync)")
    }

    private func storeOldSync(_ context: OldSyncContext) {
        lock.lock()
        oldSync = context
        lock.unlock()
    }

    private func loadOldSync() -> OldSyncContext? {
        lock.lock()
        defer { lock.unlock() }
        return oldSync
    }

    private func logParameters(_ name: String, _ p: FileDownloadService0A.FileParameters.Response) {
        info("FileParameters \(name): version=\(p.version) packetSize=\(p.packetSize) maxBlockSize=\(p.maxBlockSize) timeout=\(p.timeout)")
    }

    // MARK: blocks

    /// GB downloadNextFileBlock + handleFileData: asks for `min(remaining, maxBlockSize)` bytes, then collects the 0x05 packets the
    /// watch pushes until the block (or the file) is complete. Every packet restarts the watch-given timeout, like GB's
    /// `handler.postDelayed` in FileDataReceiver.
    private func receiveBlocks(
        service: UInt8,
        name: String,
        fileSize: Int,
        maxBlockSize: Int,
        timeoutSec: Int,
        newBlock: () -> Void = {},
        requestBlock: (_ offset: Int, _ size: Int) -> HuaweiPacket,
        accept: (_ packet: HuaweiPacket, _ position: Int) throws -> Bytes
    ) async throws -> Bytes {
        if maxBlockSize <= 0 { throw protocolError("\(name): device reported max block size \(maxBlockSize)") }
        let timeoutMs = (timeoutSec > 0 ? timeoutSec : Self.defaultBlockTimeoutSec) * 1000
        var buffer = Bytes()
        buffer.reserveCapacity(fileSize)
        let inbox = FileBlockInbox()
        let subscription = await session.subscribe(service: service, command: Self.blockResponseCommand, label: "file data \(name)") { packet in
            inbox.push(packet)
        }
        do {
            while buffer.count < fileSize {
                let blockStart = buffer.count
                let blockSize = min(fileSize - blockStart, maxBlockSize)
                newBlock()
                try await session.send(requestBlock(blockStart, blockSize), label: "FileBlock \(name) offset=\(blockStart) size=\(blockSize)")

                while buffer.count < fileSize && buffer.count - blockStart < maxBlockSize {
                    guard let packet = await inbox.receive(timeoutMs: timeoutMs) else {
                        try Task.checkCancellation()
                        throw WearError(.timeout, "\(name): timeout was hit! no file data within \(timeoutMs)ms at \(buffer.count)/\(fileSize) bytes")
                    }
                    let chunk = try accept(packet, buffer.count)
                    if chunk.count > fileSize - buffer.count {
                        // GB would die on a BufferOverflowException here.
                        throw protocolError("\(name): downloaded file is larger than expected (\(buffer.count + chunk.count) > \(fileSize))")
                    }
                    buffer += chunk
                }
                info("\(name): \(buffer.count)/\(fileSize) bytes")
            }
        } catch {
            inbox.close()
            await session.unsubscribe(subscription)
            throw error
        }
        inbox.close()
        await session.unsubscribe(subscription)
        return buffer
    }

    private func checkSize(_ name: String, _ fileSize: Int) throws {
        if fileSize > Self.maxFileSize { throw protocolError("\(name): device reported an implausible file size \(fileSize)") }
    }

    private func protocolError(_ message: String) -> WearError {
        WearError(.protocolError, message)
    }

    /// A data packet that does not parse: GB `ParseException`s (a missing tag, a decryption failure) are parse failures, the Java
    /// runtime exceptions around them are not.
    private func blockParseError(_ name: String, _ error: Error) -> WearError {
        var parseFailure = false
        if let e = error as? PacketError {
            switch e {
            case .missingTag, .crypto: parseFailure = true
            default: break
            }
        }
        if case TLVError.missingTag = error { parseFailure = true }
        return WearError(.protocolError, "\(name): failed to parse file data: \(error)", underlying: error, isParseFailure: parseFailure)
    }

    /// Kotlin `List.toString()`.
    private static func listString(_ names: [String]) -> String { "[" + names.joined(separator: ", ") + "]" }

    private func info(_ message: String) {
        log(LogEntry(.info, message))
    }
}

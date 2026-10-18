// The Huawei Health history import of the `HuaweiWear` module (`importHuaweiExport`, `cancelHuaweiImport` in HuaweiWearModule.ts); progress goes
// out as `onHuaweiImportProgress`. Port of the HuaweiImportController of HuaweiImportModuleApi.kt: one import at a time, the ZIP read in place,
// the password kept in memory only while the import runs (never stored or logged).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class HuaweiImportController: @unchecked Sendable {
    private let syncStore: SyncStore
    private let lock = NSLock()
    private var running = false
    private var cancelRequested = false

    public init(syncStore: SyncStore) { self.syncStore = syncStore }

    public func cancel() { lock.locked { cancelRequested = true } }

    /// Runs the import on a background queue. `emit` receives the `HuaweiImportProgressEvent` payloads; the result is the `HuaweiImportSummary`.
    public func run(uri: String, password: String, emit: @escaping @Sendable ([String: Any]) -> Void) async throws -> [String: Any] {
        let started = lock.locked { () -> Bool in
            if running { return false }
            running = true
            cancelRequested = false
            return true
        }
        guard started else { throw WearError(.busy, "An import is already running") }
        defer { lock.locked { running = false } }
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    continuation.resume(returning: try self.runBlocking(uri: uri, password: password, emit: emit))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    func runBlocking(uri: String, password: String, emit: @escaping @Sendable ([String: Any]) -> Void) throws -> [String: Any] {
        do {
            return try HuaweiExportFiles.withExport(uri: uri, password: password) { source in
                let importer = HuaweiExportImporter(
                    store: SqliteHuaweiImportStore(syncStore),
                    onProgress: { emit($0.toJS()) },
                    isCancelled: { [self] in lock.locked { cancelRequested } }
                )
                return try importer.run(source).toJS()
            }
        } catch let e as HuaweiImportException {
            let code: ErrorCode
            switch e.kind {
            case .badPassword: code = .importPassword
            case .notAZip, .notAnExport: code = .importFormat
            case .storage: code = .storage
            }
            throw WearError(code, e.message, underlying: e.underlying)
        } catch let e as SQLiteError {
            throw WearError(.storage, "Database error: \(e.message)", underlying: e)
        }
    }
}

#endif

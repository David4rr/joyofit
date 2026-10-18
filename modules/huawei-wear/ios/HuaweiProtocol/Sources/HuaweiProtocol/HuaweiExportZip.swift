// Port of HuaweiExportZip.kt: the export ZIP, which the Privacy Centre encrypts with the password the user set (WinZip AES-256; the traditional
// cipher is read as well, as zip4j does). The file is read in place through `FileZipSource`, so a multi-GB export is never copied or loaded.
import Foundation

public final class ZipExportSource: HuaweiExportSource {
    private let archive: ZipArchive
    private let password: Bytes
    private let files: [ZipEntry]
    private let byName: [String: ZipEntry]

    private init(archive: ZipArchive, password: Bytes) {
        self.archive = archive
        self.password = password
        files = archive.entries.filter { !$0.isDirectory }
        byName = Dictionary(uniqueKeysWithValues: files.map { ($0.name, $0) })
    }

    public func entries() -> [HuaweiExportEntry] { files.map { HuaweiExportEntry(name: $0.name, size: Int64(clamping: $0.size)) } }

    public func read(_ entry: HuaweiExportEntry, into sink: (Bytes) throws -> Void) throws {
        guard let zipEntry = byName[entry.name] else { throw HuaweiExportReadError("No such entry: \(entry.name)") }
        do {
            try archive.extract(zipEntry, password: password, sink: sink)
        } catch let e as ZipError {
            throw HuaweiExportReadError(e.description)
        }
    }

    /// Opens the archive and checks the password against the smallest encrypted member, so a wrong one fails here and not after minutes of work.
    public static func open(source: ZipByteSource, password: Bytes, chunkBytes: Int = 64 * 1024) throws -> ZipExportSource {
        let archive: ZipArchive
        do {
            archive = try ZipArchive(source: source, chunkBytes: chunkBytes)
        } catch let e as ZipError {
            throw HuaweiImportException(.notAZip, "The ZIP could not be read: \(e)", underlying: e)
        }
        let result = ZipExportSource(archive: archive, password: password)
        let probe = result.files.filter { $0.isEncrypted }.min { $0.size < $1.size }
        if let probe {
            if password.isEmpty {
                throw HuaweiImportException(.badPassword, "This ZIP needs the password you set when you requested the data")
            }
            do {
                try archive.checkPassword(probe, password: password)
            } catch ZipError.wrongPassword {
                throw HuaweiImportException(.badPassword, "Wrong ZIP password")
            } catch let e as ZipError {
                throw HuaweiImportException(.notAZip, "The ZIP could not be read: \(e)", underlying: e)
            }
        }
        return result
    }

    /// Opens the file at `path`; a file that is not a ZIP is `notAZip`.
    public static func open(path: String, password: String) throws -> ZipExportSource {
        let source: FileZipSource
        do {
            source = try FileZipSource(path: path)
        } catch let e as ZipError {
            throw HuaweiImportException(.notAZip, "The file could not be opened: \(e)", underlying: e)
        }
        return try open(source: source, password: Bytes(password.utf8))
    }
}

/// Turns what the file picker returns into a `ZipExportSource`.
public enum HuaweiExportFiles {
    /// `uri` is the `file://` URL (or absolute path) expo-document-picker returns for a file picked without copying it. On iOS the URL is security
    /// scoped: access is started for the whole read and stopped afterwards, and the read is coordinated, which makes iCloud Drive download a file
    /// that is not on the phone yet. The ZIP is opened in place; nothing is copied. Errors of `body` come out unchanged.
    public static func withExport<T>(uri: String, password: String, _ body: (ZipExportSource) throws -> T) throws -> T {
        guard let url = PickedFile.fileURL(uri) else { throw HuaweiImportException(.notAZip, "The file could not be opened") }
        #if canImport(Darwin)
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var outcome: Result<T, Error>?
        var coordinationError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordinationError) { readable in
            outcome = Result { try body(try ZipExportSource.open(path: readable.path, password: password)) }
        }
        // Coordination can fail (the item vanished, no access); then the plain open below reports what is wrong.
        if let outcome { return try outcome.get() }
        #endif
        return try body(try ZipExportSource.open(path: url.path, password: password))
    }
}

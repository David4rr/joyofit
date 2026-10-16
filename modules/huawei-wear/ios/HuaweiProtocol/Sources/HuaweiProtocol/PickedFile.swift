// Reads the file the user picked (expo-document-picker hands the app a `file://` URL, in the app's cache with `copyToCacheDirectory`, or the
// original location, which may be security scoped). The counterpart of the Kotlin `WatchfaceController.readUri`, with the same errors.
import Foundation

public enum PickedFile {
    /// The bytes of `uri` (a `file://` URL or an absolute path), at most `maxBytes`. Failures are `ERR_INVALID_ARGUMENT`; `tooLarge` words
    /// the one for a file over the limit.
    public static func read(
        uri: String, maxBytes: Int = WatchfacePackages.maxPackageBytes,
        tooLarge: String? = nil
    ) throws -> Bytes {
        guard let url = fileURL(uri) else { throw WearError(.invalidArgument, "Could not open \(uri)") }
        #if canImport(Darwin)
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        #endif
        let handle: FileHandle
        do {
            handle = try FileHandle(forReadingFrom: url)
        } catch {
            throw WearError(.invalidArgument, "Could not read the file: \(error.localizedDescription)", underlying: error)
        }
        defer { try? handle.close() }
        var out = Bytes()
        do {
            while true {
                guard let chunk = try handle.read(upToCount: 64 * 1024), !chunk.isEmpty else { break }
                out += chunk
                if out.count > maxBytes {
                    throw WearError(.invalidArgument, tooLarge ?? "That file is larger than \(maxBytes / 1024 / 1024) MiB, too big for a watch face")
                }
            }
        } catch let e as WearError {
            throw e
        } catch {
            throw WearError(.invalidArgument, "Could not read the file: \(error.localizedDescription)", underlying: error)
        }
        return out
    }

    static func fileURL(_ uri: String) -> URL? {
        if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
        let parsed = URL(string: uri) ?? uri.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed).flatMap { URL(string: $0) }
        guard let parsed, parsed.isFileURL else { return nil }
        return parsed
    }
}

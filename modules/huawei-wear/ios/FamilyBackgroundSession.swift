// The system-managed side of the family upload: a background URLSession (`URLSessionConfiguration.background`), whose transfers are carried out by
// the system daemon, so a body queued right after a background watch sync still goes out when iOS suspends the app a moment later, and even when it
// terminates it. The result of a transfer reaches `onFinish` in this process, or in the process iOS relaunches for it
// (`handleEventsForBackgroundURLSession`, HuaweiWearAppDelegateSubscriber). What iOS does NOT do: run a transfer after the user force-quit the app
// (the system cancels the session's tasks then), or start one on its own schedule; it only runs what was queued, when it decides to (Low Power
// Mode and Low Data Mode defer it).
#if canImport(UIKit)
import Foundation

public final class FamilyBackgroundSession: NSObject, FamilyBackgroundUploading, URLSessionTaskDelegate, @unchecked Sendable {
    /// Identifies this app's session to the system across launches.
    public static let sessionIdentifier = "com.joyodigitama.joyofit.family-ingest"

    private let lock = NSLock()
    private var created: URLSession?
    private var finishedEvents: (() -> Void)?
    private var finishHandler: (@Sendable (_ file: String?, _ transfer: FamilyTransfer) -> Void)?

    public var onFinish: (@Sendable (_ file: String?, _ transfer: FamilyTransfer) -> Void)? {
        get { lock.locked { finishHandler } }
        set { lock.locked { finishHandler = newValue } }
    }

    /// Created on first use. Creating it with the identifier of an earlier process is what makes the system deliver that process' finished transfers.
    private func session() -> URLSession {
        lock.locked {
            if let created { return created }
            let configuration = URLSessionConfiguration.background(withIdentifier: FamilyBackgroundSession.sessionIdentifier)
            // A few hundred bytes the watcher is waiting for: not worth waiting for Wi-Fi or power.
            configuration.isDiscretionary = false
            configuration.sessionSendsLaunchEvents = true
            // A body that could not go out for hours is stale; the next sync builds a fresh one.
            configuration.timeoutIntervalForResource = 2 * 3600
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            created = session
            return session
        }
    }

    public func enqueue(_ request: URLRequest, file: URL) {
        let session = session()
        session.getAllTasks { tasks in
            tasks.forEach { $0.cancel() }
            let task = session.uploadTask(with: request, fromFile: file)
            task.taskDescription = file.lastPathComponent
            task.resume()
        }
    }

    public func cancelPending() {
        session().getAllTasks { tasks in tasks.forEach { $0.cancel() } }
    }

    public func attach() { _ = session() }

    /// iOS relaunched or woke the app for this session: `completion` is called, on the main queue, once every event of the session was delivered.
    public func handleEvents(completion: @escaping () -> Void) {
        lock.locked { finishedEvents = completion }
        attach()
    }

    // MARK: URLSessionTaskDelegate

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let transfer: FamilyTransfer
        if let error {
            transfer = (error as? URLError)?.code == .cancelled ? .cancelled : .failed
        } else if let status = (task.response as? HTTPURLResponse)?.statusCode {
            transfer = .status(status)
        } else {
            transfer = .failed
        }
        onFinish?(task.taskDescription, transfer)
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let completion: (() -> Void)? = lock.locked {
            let c = finishedEvents
            finishedEvents = nil
            return c
        }
        if let completion { DispatchQueue.main.async(execute: completion) }
    }
}

#endif

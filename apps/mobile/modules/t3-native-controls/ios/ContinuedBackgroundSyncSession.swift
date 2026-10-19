import BackgroundTasks
import UIKit

protocol BackgroundSyncSessionController: AnyObject {
  var endsAt: Date? { get }
  var state: String { get }
  var onChange: (() -> Void)? { get set }
  func start() throws
  func cancel()
}

/// A finite sync window requested as the app leaves the foreground. Progress measures session time,
/// not downloaded history or server-side agent completion.
@available(iOS 26.0, *)
final class ContinuedBackgroundSyncSession: BackgroundSyncSessionController {
  // Registration lasts for the process, including across React bridge reloads.
  static let shared = ContinuedBackgroundSyncSession()
  private let identifier = "\(Bundle.main.bundleIdentifier ?? "com.t3tools.code").background-sync"
  private let duration = 600
  private var registered = false
  private var task: BGContinuedProcessingTask?
  private var timer: Timer?
  private var expiration: DispatchWorkItem?
  private var startedAt: ContinuousClock.Instant?
  private(set) var endsAt: Date?
  private(set) var state = "idle"
  var onChange: (() -> Void)?

  func start() throws {
    // willResignActive is still a foreground transition. Waiting until the
    // background notification is too late to request continued processing.
    guard UIApplication.shared.applicationState != .background else {
      throw failure("Start a sync session while T3 Code is open.")
    }
    if endsAt != nil { return }
    if !registered {
      registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { [weak self] task in
        guard let self, let continued = task as? BGContinuedProcessingTask else {
          task.setTaskCompleted(success: false)
          return
        }
        self.accept(continued)
      }
      guard registered else { throw failure("Could not register background sync.") }
    }

    let request = BGContinuedProcessingTaskRequest(
      identifier: identifier,
      title: "Syncing open threads",
      subtitle: "10-minute sync session"
    )
    // Do not silently queue a session to start after the requested window.
    request.strategy = .fail
    startedAt = .now
    endsAt = Date().addingTimeInterval(TimeInterval(duration))
    state = "requested"
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      finish(state: "idle", success: false)
      throw error
    }
    let expiration = DispatchWorkItem { [weak self] in self?.finish(state: "completed", success: true) }
    self.expiration = expiration
    DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(duration), execute: expiration)
    onChange?()
  }

  func cancel() {
    finish(state: "cancelled", success: false)
  }

  private func accept(_ task: BGContinuedProcessingTask) {
    guard endsAt != nil else {
      task.setTaskCompleted(success: false)
      return
    }
    self.task = task
    state = "running"
    task.progress.totalUnitCount = Int64(duration)
    task.expirationHandler = { [weak self, weak task] in
      DispatchQueue.main.async {
        guard let self, self.task === task else { return }
        self.finish(state: "expired", success: false)
      }
    }
    timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.tick() }
    tick()
    onChange?()
  }

  private func tick() {
    guard let task, let startedAt else { return }
    let elapsed = min(duration, max(0, Int(startedAt.duration(to: .now).components.seconds)))
    task.progress.completedUnitCount = Int64(elapsed)
    task.updateTitle("Syncing open threads", subtitle: String(format: "Session time: %02d:%02d / 10:00", elapsed / 60, elapsed % 60))
    if elapsed >= duration { finish(state: "completed", success: true) }
  }

  private func finish(state: String, success: Bool) {
    guard endsAt != nil else { return }
    let current = task
    task = nil
    timer?.invalidate()
    timer = nil
    expiration?.cancel()
    expiration = nil
    startedAt = nil
    endsAt = nil
    self.state = state
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
    current?.expirationHandler = nil
    if success, let current { current.progress.completedUnitCount = current.progress.totalUnitCount }
    current?.setTaskCompleted(success: success)
    onChange?()
  }

  private func failure(_ message: String) -> NSError {
    NSError(domain: "T3BackgroundSync", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}

/// Requests once while leaving the foreground, before iOS suspends the app.
/// An expired, refused, or cancelled request must not renew itself in the background.
final class AutomaticBackgroundSync {
  enum Phase { case active, inactive, background }

  private(set) var enabled = false
  private var phase: Phase
  private var attempted = false
  private var destroyed = false
  private let start: () throws -> Void
  private let cancel: () -> Void
  private let onFailure: () -> Void

  init(
    phase: Phase, start: @escaping () throws -> Void,
    cancel: @escaping () -> Void, onFailure: @escaping () -> Void
  ) {
    self.phase = phase
    self.start = start
    self.cancel = cancel
    self.onFailure = onFailure
  }

  func setEnabled(_ enabled: Bool) {
    guard !destroyed else { return }
    self.enabled = enabled
    if !enabled { cancel() } else if phase == .inactive { requestIfNeeded() }
  }

  func willResignActive() {
    phase = .inactive
    requestIfNeeded()
  }

  func didEnterBackground() { phase = .background }

  func didBecomeActive() {
    guard !destroyed else { return }
    phase = .active
    attempted = false
    cancel()
  }

  func stop() {
    attempted = true
    cancel()
  }

  func destroy() {
    destroyed = true
    enabled = false
    stop()
  }

  private func requestIfNeeded() {
    guard enabled, !attempted, !destroyed else { return }
    attempted = true
    do { try start() } catch { onFailure() }
  }
}

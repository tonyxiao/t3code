import ExpoModulesCore
import UIKit

public final class T3BackgroundSyncModule: Module {
  private var task = UIBackgroundTaskIdentifier.invalid
  private var session: (any BackgroundSyncSessionController)?
  private var resignObserver: NSObjectProtocol?
  private var requestFailed = false
  private lazy var automatic = AutomaticBackgroundSync(
    phase: UIApplication.shared.applicationState == .active ? .active
      : UIApplication.shared.applicationState == .inactive ? .inactive : .background,
    start: { [weak self] in try self?.requestSession() },
    cancel: { [weak self] in
      self?.session?.cancel()
      self?.endTask()
    },
    onFailure: { [weak self] in
      self?.requestFailed = true
      self?.emitStatus()
    }
  )

  public func definition() -> ModuleDefinition {
    Name("T3BackgroundSync")
    Events("onSessionChange")
    Constant("automaticSessions") { true }

    OnCreate {
      self.resignObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in self?.automatic.willResignActive() }
    }

    AsyncFunction("getSessionStatus") { () -> [String: Any] in
      self.sessionStatus()
    }.runOnQueue(.main)

    // Retained for JavaScript from older builds; new sessions start natively on departure.
    AsyncFunction("startSession") { () throws in
      try self.requestSession()
    }.runOnQueue(.main)

    AsyncFunction("cancelSession") {
      self.automatic.stop()
    }.runOnQueue(.main)

    Function("setEnabled") { (enabled: Bool) in
      DispatchQueue.main.async {
        self.automatic.setEnabled(enabled)
      }
    }

    OnAppEntersBackground {
      self.automatic.didEnterBackground()
      guard self.automatic.enabled, self.task == .invalid else { return }
      // iOS grants a finite window for existing socket work, not an entitlement
      // to run indefinitely. Expiration must always relinquish the task.
      self.task = UIApplication.shared.beginBackgroundTask(withName: "Sync open threads") {
        self.endTask()
      }
    }

    OnAppBecomesActive {
      self.requestFailed = false
      self.automatic.didBecomeActive()
      self.emitStatus()
    }
    OnDestroy {
      DispatchQueue.main.async {
        if let observer = self.resignObserver {
          NotificationCenter.default.removeObserver(observer)
          self.resignObserver = nil
        }
        self.automatic.destroy()
        self.session?.onChange = nil
        self.endTask()
      }
    }
  }

  private func requestSession() throws {
    guard automatic.enabled else {
      throw NSError(domain: "T3BackgroundSync", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Open an unsettled thread before starting background sync."])
    }
    guard #available(iOS 26.0, *) else {
      throw NSError(domain: "T3BackgroundSync", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "Extended sync requires iOS 26 or later."])
    }
    requestFailed = false
    let session = ContinuedBackgroundSyncSession.shared
    self.session = session
    session.onChange = { [weak self] in self?.emitStatus() }
    try session.start()
  }

  private func emitStatus() {
    sendEvent("onSessionChange", sessionStatus())
  }

  private func sessionStatus() -> [String: Any] {
    [
      "endsAt": session?.endsAt.map { $0.timeIntervalSince1970 * 1_000 } as Any? ?? NSNull(),
      "state": requestFailed ? "unavailable" : session?.state ?? "idle",
    ]
  }

  private func endTask() {
    guard task != .invalid else { return }
    UIApplication.shared.endBackgroundTask(task)
    task = .invalid
  }
}

import ExpoModulesCore
import UIKit

public final class T3BackgroundSyncModule: Module {
  private var enabled = false
  private var task = UIBackgroundTaskIdentifier.invalid
  private var session: (any BackgroundSyncSessionController)?

  public func definition() -> ModuleDefinition {
    Name("T3BackgroundSync")
    Events("onSessionChange")

    AsyncFunction("getSessionStatus") { () -> [String: Any] in
      self.sessionStatus()
    }.runOnQueue(.main)

    AsyncFunction("startSession") { () throws in
      guard self.enabled else {
        throw NSError(domain: "T3BackgroundSync", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Open an unsettled thread before starting a sync session."])
      }
      guard #available(iOS 26.0, *) else {
        throw NSError(domain: "T3BackgroundSync", code: 2,
                      userInfo: [NSLocalizedDescriptionKey: "Extended sync requires iOS 26 or later."])
      }
      let session = ContinuedBackgroundSyncSession.shared
      self.session = session
      session.onChange = { [weak self] in
        guard let self else { return }
        self.sendEvent("onSessionChange", self.sessionStatus())
      }
      try session.start()
    }.runOnQueue(.main)

    AsyncFunction("cancelSession") {
      self.session?.cancel()
    }.runOnQueue(.main)

    Function("setEnabled") { (enabled: Bool) in
      DispatchQueue.main.async {
        self.enabled = enabled
        if !enabled {
          self.session?.cancel()
          self.endTask()
        }
      }
    }

    OnAppEntersBackground {
      guard self.enabled, self.task == .invalid else { return }
      // iOS grants a finite window for existing socket work, not an entitlement
      // to run indefinitely. Expiration must always relinquish the task.
      self.task = UIApplication.shared.beginBackgroundTask(withName: "Sync open threads") {
        self.endTask()
      }
    }

    OnAppEntersForeground { self.endTask() }
    OnDestroy {
      DispatchQueue.main.async {
        self.enabled = false
        self.session?.cancel()
        self.session?.onChange = nil
        self.endTask()
      }
    }
  }

  private func sessionStatus() -> [String: Any] {
    [
      "endsAt": session?.endsAt.map { $0.timeIntervalSince1970 * 1_000 } as Any? ?? NSNull(),
      "state": session?.state ?? "idle",
    ]
  }

  private func endTask() {
    guard task != .invalid else { return }
    UIApplication.shared.endBackgroundTask(task)
    task = .invalid
  }
}

import ExpoModulesCore
import UIKit

public final class T3BackgroundSyncModule: Module {
  private var enabled = false
  private var task = UIBackgroundTaskIdentifier.invalid

  public func definition() -> ModuleDefinition {
    Name("T3BackgroundSync")

    Function("setEnabled") { (enabled: Bool) in
      DispatchQueue.main.async {
        self.enabled = enabled
        if !enabled { self.endTask() }
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
        self.endTask()
      }
    }
  }

  private func endTask() {
    guard task != .invalid else { return }
    UIApplication.shared.endBackgroundTask(task)
    task = .invalid
  }
}

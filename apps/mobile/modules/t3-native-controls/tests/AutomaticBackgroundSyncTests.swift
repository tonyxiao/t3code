final class AutomaticBackgroundSyncTests {
  private enum RequestError: Error { case refused }

  func testRequestsOnDepartureAndRearmsOnlyAfterReturning() {
    var requests = 0
    var cancellations = 0
    let sync = AutomaticBackgroundSync(
      phase: .active, start: { requests += 1 },
      cancel: { cancellations += 1 }, onFailure: { fatalError("Unexpected refusal") })
    sync.setEnabled(true)
    expectEqual(requests, 0, "Foreground use must not consume the background window")
    sync.willResignActive()
    expectEqual(requests, 1, "Request before the app enters the background")
    sync.didEnterBackground()
    sync.setEnabled(true)
    expectEqual(requests, 1)
    sync.didBecomeActive()
    expectEqual(cancellations, 1)
    sync.willResignActive()
    expectEqual(requests, 2)
  }

  func testEligibilityDuringDepartureButNeverAfterBackgrounding() {
    var requests = 0
    let sync = AutomaticBackgroundSync(
      phase: .active, start: { requests += 1 },
      cancel: {}, onFailure: { fatalError("Unexpected refusal") })
    sync.willResignActive()
    expectEqual(requests, 0, "Idle apps need no extended session")
    sync.setEnabled(true)
    expectEqual(requests, 1)
    sync.didBecomeActive()
    sync.setEnabled(false)
    sync.willResignActive()
    sync.didEnterBackground()
    sync.setEnabled(true)
    expectEqual(requests, 1, "Late JS activity must not submit from the background")
  }

  func testRefusalDoesNotLoopOrRenewInBackground() {
    var requests = 0
    var failures = 0
    let sync = AutomaticBackgroundSync(
      phase: .active,
      start: {
        requests += 1
        throw RequestError.refused
      }, cancel: {}, onFailure: { failures += 1 })
    sync.setEnabled(true)
    sync.willResignActive()
    sync.setEnabled(true)
    sync.willResignActive()
    sync.didEnterBackground()
    sync.setEnabled(true)
    expectEqual(requests, 1)
    expectEqual(failures, 1)
    sync.didBecomeActive()
    sync.willResignActive()
    expectEqual(requests, 2)
  }

  func testStoppingDoesNotRestartDuringSameDeparture() {
    var requests = 0
    var cancellations = 0
    let sync = AutomaticBackgroundSync(
      phase: .active, start: { requests += 1 },
      cancel: { cancellations += 1 }, onFailure: {})
    sync.setEnabled(true)
    sync.willResignActive()
    sync.stop()
    sync.setEnabled(true)
    sync.willResignActive()
    expectEqual(requests, 1)
    expectEqual(cancellations, 1)
  }

  func testSettlingWorkCancelsAndDestroyedModuleCannotRestart() {
    var requests = 0
    var cancellations = 0
    let sync = AutomaticBackgroundSync(
      phase: .active, start: { requests += 1 },
      cancel: { cancellations += 1 }, onFailure: {})
    sync.setEnabled(true)
    sync.willResignActive()
    sync.setEnabled(false)
    expectEqual(cancellations, 1)
    sync.destroy()
    sync.setEnabled(true)
    sync.didBecomeActive()
    sync.willResignActive()
    expectEqual(requests, 1)
    expectEqual(sync.enabled, false)
  }

  static let allTests = [
    (
      "testRequestsOnDepartureAndRearmsOnlyAfterReturning",
      testRequestsOnDepartureAndRearmsOnlyAfterReturning
    ),
    (
      "testEligibilityDuringDepartureButNeverAfterBackgrounding",
      testEligibilityDuringDepartureButNeverAfterBackgrounding
    ),
    ("testRefusalDoesNotLoopOrRenewInBackground", testRefusalDoesNotLoopOrRenewInBackground),
    (
      "testStoppingDoesNotRestartDuringSameDeparture", testStoppingDoesNotRestartDuringSameDeparture
    ),
    (
      "testSettlingWorkCancelsAndDestroyedModuleCannotRestart",
      testSettlingWorkCancelsAndDestroyedModuleCannotRestart
    ),
  ]
}

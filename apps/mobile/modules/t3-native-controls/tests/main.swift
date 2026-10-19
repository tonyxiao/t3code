// Compile with AutomaticBackgroundSync.swift and AutomaticBackgroundSyncTests.swift.
// Uses the Swift standard library so lifecycle regressions also run without Xcode.
func expectEqual<T: Equatable>(
  _ actual: T, _ expected: T, _ message: String = "",
  file: StaticString = #file, line: UInt = #line
) {
  precondition(actual == expected, "\(actual) != \(expected): \(message)", file: file, line: line)
}

for (name, test) in AutomaticBackgroundSyncTests.allTests {
  test(AutomaticBackgroundSyncTests())()
  print("PASS: \(name)")
}

import XCTest

/// Drives Mobile Safari through the web port's lock-screen lab (web/lab/lock.html):
/// taps a start button (a real user gesture), sends Safari to the background or locks the
/// device, waits, and comes back. The page posts what happened to the Mac server (--diag).
final class SafariLockTests: XCTestCase {
    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    var labURL: URL {
        URL(string: ProcessInfo.processInfo.environment["LAB_URL"] ?? "http://localhost:8000/lab/lock.html")!
    }
    var awaySeconds: Double {
        Double(ProcessInfo.processInfo.environment["AWAY_SECONDS"] ?? "60") ?? 60
    }

    override func setUp() { continueAfterFailure = false }

    private func openLab(run: String) {
        var c = URLComponents(url: labURL, resolvingAgainstBaseURL: false)!
        c.queryItems = (c.queryItems ?? []) + [URLQueryItem(name: "run", value: run), URLQueryItem(name: "n", value: UUID().uuidString)]
        XCUIDevice.shared.system.open(c.url!)
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20))
        // Dismiss a first-run sheet if Safari shows one.
        for label in ["Continue", "Not Now", "Allow"] where safari.buttons[label].waitForExistence(timeout: 1) {
            safari.buttons[label].tap()
        }
        let ready = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Ready.'")).firstMatch
        XCTAssertTrue(ready.waitForExistence(timeout: 30), "lab page never became ready")
    }

    private func tapButton(prefix: String) {
        let button = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 20), "no button \(prefix)")
        button.tap()
    }

    private func readOut() -> String {
        let t = safari.staticTexts.matching(NSPredicate(format: "label CONTAINS 'RUN '")).firstMatch
        return t.waitForExistence(timeout: 5) ? t.label : "(no output)"
    }

    private func exercise(_ which: String, lock: Bool) {
        openLab(run: which)
        tapButton(prefix: "\(which):")
        sleep(12) // let it start and play in the foreground
        let before = readOut()
        if lock {
            XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        } else {
            XCUIDevice.shared.press(.home)
        }
        Thread.sleep(forTimeInterval: awaySeconds)
        if lock {
            XCUIDevice.shared.press(.home) // wake
            sleep(1)
            XCUIDevice.shared.press(.home) // unlock (no passcode in the Simulator)
            sleep(1)
        }
        safari.activate()
        sleep(4)
        let after = readOut()
        let note = "[\(which) \(lock ? "lock" : "background")] BEFORE: \(before)\nAFTER: \(after)"
        print(note)
        let a = XCTAttachment(string: note); a.lifetime = .keepAlways; add(a)
        tapButton(prefix: "Stop")
        sleep(2)
    }

    func test1_ElementBackground() { exercise("A", lock: false) }
    func test2_LiveKeepAliveBackground() { exercise("B", lock: false) }
    func test3_LiveOnlyBackground() { exercise("C", lock: false) }
    func test4_ElementLock() { exercise("A", lock: true) }
    func test5_LiveKeepAliveLock() { exercise("B", lock: true) }
    func test6_LiveOnlyLock() { exercise("C", lock: true) }
    func test7_HandoffBackground() { exercise("D", lock: false) }
    func test8_HandoffLock() { exercise("D", lock: true) }
}

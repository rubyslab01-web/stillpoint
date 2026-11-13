import XCTest

/// Walks the real web app in Mobile Safari: onboarding with real taps, the home screen, a
/// rescue session started with one tap, a trip to the background, and the stop dialog.
/// Screenshots are attached to the test result (exported by run.sh).
final class SafariAppTests: XCTestCase {
    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    var appURL: URL { URL(string: ProcessInfo.processInfo.environment["APP_URL"] ?? "http://localhost:8000/?fresh=1")! }

    override func setUp() { continueAfterFailure = false }

    private func snap(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name; a.lifetime = .keepAlways; add(a)
    }

    private func tap(_ q: XCUIElementQuery, _ label: String, timeout: TimeInterval = 10) {
        let el = q.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
        XCTAssertTrue(el.waitForExistence(timeout: timeout), "missing \(label)")
        el.tap()
    }

    private func timeLabel() -> String? {
        let t = safari.staticTexts.matching(NSPredicate(format: "label MATCHES '^[0-9]+:[0-9][0-9]$'")).firstMatch
        return t.waitForExistence(timeout: 3) ? t.label : nil
    }

    private func seconds(_ s: String?) -> Int {
        guard let p = s?.split(separator: ":"), p.count == 2, let m = Int(p[0]), let x = Int(p[1]) else { return -1 }
        return m * 60 + x
    }

    func testOnboardingAndRescueSession() {
        XCUIDevice.shared.system.open(appURL)
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20))
        XCTAssertTrue(safari.staticTexts["Welcome to Stillpoint"].waitForExistence(timeout: 30))
        snap("1-welcome")
        tap(safari.descendants(matching: .any), "I understand")
        snap("2-safety")
        tap(safari.buttons, "Continue")
        snap("3-sound-check")
        tap(safari.buttons, "Get started")
        XCTAssertTrue(safari.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Craving now?")).firstMatch.waitForExistence(timeout: 10))
        snap("6-home")

        tap(safari.buttons, "Craving now?")
        sleep(8)
        snap("7-player")
        let before = seconds(timeLabel())
        XCUIDevice.shared.press(.home)
        sleep(30)
        safari.activate()
        sleep(3)
        let after = seconds(timeLabel())
        snap("8-player-after-background")
        let note = "remaining before background: \(before) s, after 30 s away: \(after) s"
        print(note)
        let a = XCTAttachment(string: note); a.lifetime = .keepAlways; add(a)
        XCTAssertGreaterThan(before - after, 25, "audio should keep playing in the background")

        tap(safari.buttons, "End session")
        snap("9-confirm")
        let ends = safari.buttons.matching(NSPredicate(format: "label == 'End session'"))
        XCTAssertGreaterThan(ends.count, 1, "confirm dialog missing")
        ends.element(boundBy: ends.count - 1).tap()
        sleep(2)
        snap("10-after")
    }
}

#!/bin/zsh
# Drives Mobile Safari in the iOS Simulator against the web port (needs Xcode and XcodeGen).
#   web/tests/ios-sim/run.sh lab        lock-screen lab: background and lock, 45 s each
#   web/tests/ios-sim/run.sh long       Deep Sleep, screen locked 20 minutes (pre-rendered and live)
#   web/tests/ios-sim/run.sh app        the real app: onboarding, rescue session, background
# Start the server first: python3 web/tools/server.py --diag   (results also go to web/.diag.log)
set -e
cd "$(dirname "$0")"
command -v xcodegen >/dev/null && xcodegen generate >/dev/null
DEVICE=${DEVICE:-$(xcrun simctl list devices available | grep -m1 -E "iPhone 1[5-9] " | grep -oE "[0-9A-F-]{36}")}
xcrun simctl boot "$DEVICE" 2>/dev/null || true
OUT=${OUT:-$(mktemp -d)}
case "$1" in
  long) export TEST_RUNNER_AWAY_SECONDS=1200 TEST_RUNNER_LAB_URL="http://localhost:8000/lab/lock.html?session=sleep-deep"
        ONLY=(-only-testing:UITests/SafariLockTests/test4_ElementLock -only-testing:UITests/SafariLockTests/test6_LiveOnlyLock) ;;
  app)  ONLY=(-only-testing:UITests/SafariAppTests) ;;
  *)    export TEST_RUNNER_AWAY_SECONDS=45; ONLY=(-only-testing:UITests/SafariLockTests) ;;
esac
xcodebuild test -project SafariLab.xcodeproj -scheme UITests -destination "id=$DEVICE" "${ONLY[@]}" \
  -derivedDataPath "$OUT/dd" -resultBundlePath "$OUT/result.xcresult" 2>&1 | grep -E "^\[|^AFTER|last hidden|remaining before|error:|failed|passed \(|\*\* TEST"
xcrun xcresulttool export attachments --path "$OUT/result.xcresult" --output-path "$OUT/attachments" >/dev/null 2>&1 || true
echo "Attachments (screenshots) in $OUT/attachments"

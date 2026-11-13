#!/bin/zsh
# Tests for the web port.
#   web/run-tests.sh            audio maths, validator over every session, experiment logic,
#                               and checks on the pre-rendered files (if built)
#   web/run-tests.sh --parity   also compare the JS renderer with the Swift renderer (~1 min)
#   web/run-tests.sh --smoke    also drive the app in headless Chrome (needs ./serve-web.sh running)
cd "$(dirname "$0")"
files=(tests/audio-math.test.mjs tests/content.test.mjs tests/audio-files.test.mjs)
[[ " $* " == *" --parity "* ]] && files+=(tests/parity.test.mjs)
node --test --test-reporter=spec "${files[@]}" || exit 1
if [[ " $* " == *" --smoke "* ]]; then
  node tests/smoke-chrome.mjs || exit 1
fi

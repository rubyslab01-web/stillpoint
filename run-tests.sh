#!/bin/zsh
# Runs the audio-math unit tests on macOS. Works with full Xcode or with only Command Line Tools.
cd "$(dirname "$0")/Packages/EntrainmentKit"
if xcode-select -p | grep -q CommandLineTools; then
  D=/Library/Developer/CommandLineTools/Library/Developer
  exec swift test -Xswiftc -F$D/Frameworks -Xswiftc -I$D/usr/lib -Xswiftc -plugin-path -Xswiftc /Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing \
    -Xlinker -F$D/Frameworks -Xlinker -L$D/usr/lib -Xlinker -rpath -Xlinker $D/Frameworks -Xlinker -rpath -Xlinker $D/usr/lib "$@"
else
  exec swift test "$@"
fi

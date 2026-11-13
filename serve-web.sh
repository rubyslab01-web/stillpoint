#!/bin/zsh
# Serve the Stillpoint web port to your iPhone over Wi-Fi.
#
#   ./serve-web.sh            http://<this Mac>:8000/
#   ./serve-web.sh --https    also https://<this Mac>:8443/ (offline-capable Home Screen app)
#
# First renders any session whose pre-rendered audio is missing or out of date (needs Node and
# Swift, both on this Mac; skipped with a warning if either is missing). Serving itself needs
# only Python 3. caffeinate keeps the Mac awake while serving. Sessions are downloaded to the
# phone when they start, so after that the phone does not need the Mac.
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1 && command -v swift >/dev/null 2>&1; then
  node web/tools/build-audio.mjs || echo "\nWarning: rendering failed. Sessions without up-to-date audio will use the live engine.\n"
else
  echo "Node or Swift not found, so pre-rendered audio wasn't checked. Sessions without up-to-date audio will use the live engine."
fi
exec caffeinate -is python3 web/tools/server.py "$@"

#!/bin/zsh
# Double-click this file in Finder to try Stillpoint on this Mac.
# It opens Stillpoint in Safari. Close this window (or press Ctrl-C) to stop.
cd "$(dirname "$0")"
clear
echo "Starting Stillpoint…"
echo

# Make sure every session's audio is ready (quick if nothing changed).
if command -v node >/dev/null 2>&1 && command -v swift >/dev/null 2>&1; then
  node web/tools/build-audio.mjs --quiet || echo "(Some audio couldn't be prepared; those sessions will still play.)"
fi

# Free the port if an earlier copy is still running.
pkill -f "web/tools/server.py" 2>/dev/null
python3 web/tools/server.py --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; exit' INT TERM EXIT

for i in {1..50}; do curl -s -o /dev/null http://localhost:8000/ && break; sleep 0.1; done
[[ -z "$NO_OPEN" ]] && open -a Safari "http://localhost:8000/"

echo "Stillpoint is open in Safari:  http://localhost:8000/"
echo
echo "  • Wear headphones (the beats need them)."
echo "  • Keep your Mac's volume low to start."
echo "  • When you're finished, close this window."
echo
wait $SERVER

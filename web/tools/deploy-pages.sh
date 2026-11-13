#!/bin/zsh
# Publishes the web app to GitHub Pages (the gh-pages branch of this repo's origin).
#   web/tools/deploy-pages.sh
# Renders any stale audio, builds web/dist/, and force-pushes it as a single commit, so the
# branch never accumulates old audio. Files over 95 MB (the 8-hour noise bed) are left out
# because GitHub rejects files over 100 MB; the app plays those live instead.
set -e
cd "$(dirname "$0")/../.."
REMOTE=$(git remote get-url origin)
node web/tools/build-audio.mjs --quiet
node web/tools/build-static.mjs --max-file-mb 95
cd web/dist
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="Stillpoint deploy" -c user.email="deploy@localhost" commit -q -m "Deploy web app $(date -u +%Y-%m-%dT%H:%MZ)"
git remote add origin "$REMOTE"
git -c http.postBuffer=524288000 push -q -f origin gh-pages
rm -rf .git
echo "Published. GitHub Pages updates within a minute or two."

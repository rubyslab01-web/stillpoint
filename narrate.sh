#!/bin/zsh
# One command to regenerate narration after editing any file in Scripts/.
# Only changed segments are rebuilt. Pass --force to rebuild all.
cd "$(dirname "$0")/tools"
if [ ! -d .venv ]; then
  uv venv --python 3.12 .venv && source .venv/bin/activate && uv pip install -r requirements.txt
else
  source .venv/bin/activate
fi
python narrate.py "$@"

#!/usr/bin/env bash
# ABOUTME: Wrapper for fork_review.py — sets up a venv on first run and execs Python.
# ABOUTME: Use from chain steps. Forwards all arguments to fork_review.py.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HERE/.venv"

if [ ! -d "$VENV" ]; then
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --quiet --upgrade pip
    "$VENV/bin/pip" install --quiet -r "$HERE/requirements.txt"
fi

exec "$VENV/bin/python" "$HERE/fork_review.py" "$@"

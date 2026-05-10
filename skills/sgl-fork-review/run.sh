#!/usr/bin/env bash
# ABOUTME: Wrapper for fork_review.py. Stdlib-only — no venv needed.
# ABOUTME: Use from chain steps. Forwards all arguments to fork_review.py.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# fork_review.py uses only Python stdlib (urllib + concurrent.futures).
# If a future dependency is added to requirements.txt, this wrapper
# transparently sets up a venv and installs it.
if [ -s "$HERE/requirements.txt" ] && grep -qE '^[^#[:space:]]' "$HERE/requirements.txt"; then
    VENV="$HERE/.venv"
    if [ ! -d "$VENV" ]; then
        python3 -m venv "$VENV"
        "$VENV/bin/pip" install --quiet --upgrade pip
        "$VENV/bin/pip" install --quiet -r "$HERE/requirements.txt"
    fi
    exec "$VENV/bin/python" "$HERE/fork_review.py" "$@"
fi

exec python3 "$HERE/fork_review.py" "$@"

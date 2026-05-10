#!/usr/bin/env bash
# ABOUTME: Bash + curl + jq fallback for fork_review.py.
# ABOUTME: Sends parallel POST /v1/chat/completions with response_format=json_schema.
# ABOUTME: Best-effort prefix sharing — radix cache reuse depends on the scheduler.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENDPOINT="${ENDPOINT:-http://10.99.99.85:8003}"
MODEL="${MODEL:-RedHatAI/Qwen3.6-35B-A3B-NVFP4}"
MAX_TOKENS="${MAX_TOKENS:-4096}"
TEMPERATURE="${TEMPERATURE:-0.0}"
CODE_FILE=""
PERSONAS=("correctness" "security" "performance" "dry")

usage() {
    cat <<USAGE
Usage: $(basename "$0") --code-file PATH [--personas P1 P2 ...] [--endpoint URL]

Environment overrides: ENDPOINT, MODEL, MAX_TOKENS, TEMPERATURE.

Outputs a merged FindingsReport on stdout. Requires: curl, jq.
USAGE
    exit 1
}

while [ $# -gt 0 ]; do
    case "$1" in
        --code-file) CODE_FILE="$2"; shift 2 ;;
        --personas) shift; PERSONAS=(); while [ $# -gt 0 ] && [[ ! "$1" =~ ^-- ]]; do PERSONAS+=("$1"); shift; done ;;
        --endpoint) ENDPOINT="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown flag: $1" >&2; usage ;;
    esac
done

[ -z "$CODE_FILE" ] && { echo "ERROR: --code-file required" >&2; exit 3; }
[ -f "$CODE_FILE" ] || { echo "ERROR: $CODE_FILE not found" >&2; exit 3; }
command -v curl >/dev/null || { echo "ERROR: curl not installed" >&2; exit 3; }
command -v jq >/dev/null || { echo "ERROR: jq not installed" >&2; exit 3; }

# Health probe
if ! curl -fsS --max-time 3 "$ENDPOINT/v1/models" >/dev/null 2>&1; then
    echo "ERROR: SGLang server unreachable at $ENDPOINT" >&2
    exit 2
fi

CODE_CONTEXT="$(cat "$CODE_FILE")"
SCHEMA="$(cat "$HERE/findings.schema.json")"
PERSONAS_JSON="$(cat "$HERE/personas.json")"
SYSTEM_PROMPT="You are a senior code reviewer producing a structured JSON findings report. Every finding must include a file, line, severity, category, description, evidence, and a concrete suggested_fix. Use sequential IDs prefixed by category (CORR-001, SEC-001, PERF-001, DRY-001). Do not editorialize. Do not include any prose outside the JSON. If the focus has no findings, return an empty findings array with verdict APPROVED."

TMPDIR_FORK="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_FORK"' EXIT

START=$(date +%s.%N)

for persona in "${PERSONAS[@]}"; do
    FOCUS="$(printf '%s' "$PERSONAS_JSON" | jq -r --arg k "$persona" '.[$k] // empty')"
    [ -z "$FOCUS" ] && { echo "ERROR: unknown persona: $persona" >&2; exit 3; }

    REQ_BODY="$(jq -n \
        --arg model "$MODEL" \
        --arg sys "$SYSTEM_PROMPT" \
        --arg user1 "Code under review:\n\n$CODE_CONTEXT" \
        --arg user2 "Review focus ($persona): $FOCUS" \
        --argjson schema "$SCHEMA" \
        --argjson max_tokens "$MAX_TOKENS" \
        --argjson temperature "$TEMPERATURE" \
        '{
          model: $model,
          messages: [
            {role: "system", content: $sys},
            {role: "user", content: $user1},
            {role: "user", content: $user2}
          ],
          temperature: $temperature,
          max_tokens: $max_tokens,
          response_format: {type: "json_schema", json_schema: {name: "findings", schema: $schema}}
        }')"

    (
        curl -fsS --max-time 120 \
            -H "Content-Type: application/json" \
            -d "$REQ_BODY" \
            "$ENDPOINT/v1/chat/completions" \
            > "$TMPDIR_FORK/$persona.raw" 2> "$TMPDIR_FORK/$persona.err" \
        || echo "FORK_FAILED" > "$TMPDIR_FORK/$persona.failed"
    ) &
done
wait

END=$(date +%s.%N)
WALL=$(awk "BEGIN {printf \"%.3f\", $END - $START}")

# Merge per-persona reports
RESULTS_DIR="$TMPDIR_FORK"
PERSONAS_RUN=()
PERSONAS_DROPPED=()
ALL_FINDINGS="[]"
ALL_SUMMARIES=""

for persona in "${PERSONAS[@]}"; do
    if [ -f "$RESULTS_DIR/$persona.failed" ]; then
        PERSONAS_DROPPED+=("$persona")
        continue
    fi
    CONTENT="$(jq -r '.choices[0].message.content // empty' < "$RESULTS_DIR/$persona.raw" 2>/dev/null || true)"
    [ -z "$CONTENT" ] && { PERSONAS_DROPPED+=("$persona"); continue; }
    if ! echo "$CONTENT" | jq -e . >/dev/null 2>&1; then
        PERSONAS_DROPPED+=("$persona")
        continue
    fi
    PERSONAS_RUN+=("$persona")
    ALL_FINDINGS="$(jq --argjson new "$(echo "$CONTENT" | jq '.findings // []')" '. + $new' <<<"$ALL_FINDINGS")"
    SUMMARY="$(echo "$CONTENT" | jq -r '.summary // ""')"
    ALL_SUMMARIES+="[$persona] $SUMMARY | "
done

# Verdict
SEVERITIES="$(echo "$ALL_FINDINGS" | jq -r '[.[].severity] | unique | join(",")')"
if echo ",$SEVERITIES," | grep -qE ',(critical|high),'; then
    VERDICT="NEEDS_CHANGES"
elif [ "$(echo "$ALL_FINDINGS" | jq 'length')" -gt 0 ]; then
    VERDICT="APPROVED_WITH_NOTES"
else
    VERDICT="APPROVED"
fi

jq -n \
    --arg verdict "$VERDICT" \
    --arg summary "${ALL_SUMMARIES%| }" \
    --argjson findings "$ALL_FINDINGS" \
    --argjson wall "$WALL" \
    --argjson run "$(printf '%s\n' "${PERSONAS_RUN[@]}" | jq -R . | jq -s .)" \
    --argjson dropped "$(printf '%s\n' "${PERSONAS_DROPPED[@]}" | jq -R . | jq -s .)" \
    '{
      verdict: $verdict,
      summary: $summary,
      findings: $findings,
      metadata: {
        wall_time_seconds: $wall,
        personas_run: $run,
        personas_dropped: $dropped,
        backend: "http-fallback"
      }
    }'

---
name: sgl-fork-review
description: Parallel persona-based code review against a local SGLang server using fork() + radix prefix cache. Sends one shared prefix (system + code) and forks N persona-specific generations in parallel. Output is XGrammar-validated JSON conforming to the findings schema. Use this for step 8 of the workflow — AI source code review — to cut wall time vs sequential reviewer chains.
allowed-tools: Bash(./run.sh:*),Bash(./run-http.sh:*),Bash(python:*),Bash(python3:*)
---

# SGL Fork Review

Parallel multi-persona code review via the SGLang Python DSL. The skill sends a single shared prefix (system prompt + code under review) to the local SGLang server and forks N persona-specific generations against the cached prefix. Each fork emits XGrammar-constrained JSON matching `findings.schema.json`.

## When to use

- Step 8 of the canonical workflow (`docs/workflow-architecture.md` Section 0): AI source code review
- Inside the `local-review` chain
- Inside the revised `code-review` chain (replaces sequential warden + knight calls)
- Anytime you have a defined diff or file set and want quality + security + perf + DRY checks in parallel

## Prerequisites

- SGLang server reachable at `http://10.99.99.85:8003` (or pass `--endpoint`)
- Server runs `RedHatAI/Qwen3.6-35B-A3B-NVFP4` with `--tool-call-parser qwen3_coder`
- For 3+ parallel personas: server must be in **high-concurrency mode** (`--max-running-requests 16`, no speculative flags). The script auto-detects speculative-mode caps and either batches in pairs or aborts with a clear message — see `homelab/docs/llm-serving/qwen3.6-35b-a3b-sglang.md` for mode-switch instructions.
- Python 3.10+ with the `sglang` package (installed via `requirements.txt`)

## Quick start

```bash
# Default: review a code file with all four personas
./run.sh --code-file path/to/changes.diff

# Custom personas
./run.sh --code-file path/to/changes.diff --personas correctness security

# Custom endpoint
./run.sh --code-file path/to/changes.diff --endpoint http://localhost:30000

# JSON via stdin (piped from a chain step)
cat input.json | ./run.sh --stdin
```

## Input contract

Either CLI flags or JSON on stdin (when invoked from a chain):

```json
{
  "code_context": "string — code under review with file path headers",
  "personas": ["correctness", "security", "performance", "dry"],
  "endpoint": "http://10.99.99.85:8003",
  "max_tokens_per_fork": 4096,
  "temperature": 0.0
}
```

Default personas if omitted: `correctness`, `security`, `performance`, `dry`. Override via `personas.json` or `--personas` CLI flag.

## Output contract

Stdout is JSON conforming to `findings.schema.json`:

```json
{
  "verdict": "APPROVED | APPROVED_WITH_NOTES | NEEDS_CHANGES",
  "summary": "string",
  "findings": [
    {"id": "SEC-001", "severity": "high", "category": "security", "file": "...", "line": 42, "description": "...", "evidence": "...", "suggested_fix": "...", "auto_fixable": false}
  ],
  "metadata": {
    "wall_time_seconds": 4.6,
    "tokens_generated": 3812,
    "cache_hit_rate": 0.99,
    "personas_run": ["correctness", "security", "performance", "dry"]
  }
}
```

## Failure modes

| Condition | Behavior |
|---|---|
| SGLang server unreachable | Exit 2, stderr message, no JSON on stdout. Chain step fails fast. |
| A fork emits invalid JSON despite schema (rare; max_tokens cutoff) | That persona's findings are dropped, `metadata.personas_run` reflects only completed personas, exit 0 |
| More personas than server slots in speculative mode | Auto-batches in pairs of 2, records this in `metadata.batched: true` |
| Python `sglang` package missing | Falls back to `run-http.sh` (bash + curl + jq) if available, otherwise exits 3 |

## Files

- `fork_review.py` — primary implementation (SGL DSL `@sgl.function`, fork + join, JSON-schema constrained generation)
- `findings.schema.json` — JSON schema the XGrammar engine enforces per fork
- `personas.json` — persona key → focus instruction map (override-friendly)
- `requirements.txt` — Python deps (`sglang` pinned to server image's nightly date)
- `run.sh` — venv + Python wrapper. Use this from chains.
- `run-http.sh` — bash + curl + jq fallback for environments without the Python dep

## Performance expectation

Per the homelab benchmarks documented in the architecture (Section 7a.3):
- 4-persona review on a 7.5K-token shared prefix: ~4.6s wall time (cold prefill + 4× cached prefill + 4× ~1024 generated tokens at 250 tok/s)
- Sequential equivalent: ~18.5s
- Speedup target: ≥3× over sequential reviewer chains

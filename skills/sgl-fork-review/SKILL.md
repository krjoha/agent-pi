---
name: sgl-fork-review
description: Parallel persona-based code review against a local SGLang server using fork() + radix prefix cache. Sends one shared prefix (system + code) and forks N persona-specific generations in parallel. Output is XGrammar-validated JSON conforming to the findings schema. Use this for step 8 of the workflow — AI source code review — to cut wall time vs sequential reviewer chains.
allowed-tools: Bash(./run.sh:*),Bash(./run-http.sh:*),Bash(python:*),Bash(python3:*)
---

# SGL Fork Review

Parallel multi-persona code review against an SGLang OpenAI-compatible server. The skill sends N concurrent `POST /v1/chat/completions` requests sharing the same prefix (system + code), each with a persona-specific user turn and an XGrammar-enforced `response_format: json_schema`. SGLang's radix cache reuses the shared prefix across the parallel forks. Reasoning is disabled per request so the constrained-decoding path produces the JSON directly.

## When to use

- Step 8 of the canonical workflow (`docs/workflow-architecture.md` Section 0): AI source code review
- Inside the `local-review` chain
- Inside the revised `code-review` chain (replaces sequential warden + knight calls)
- Anytime you have a defined diff or file set and want quality + security + perf + DRY checks in parallel

## Prerequisites

- SGLang server reachable at `http://10.99.99.85:8003` (or pass `--endpoint`)
- Server runs `RedHatAI/Qwen3.6-35B-A3B-NVFP4` with `--tool-call-parser qwen3_coder`
- Server must support XGrammar — **NEXTN** speculative mode and **high-concurrency** mode work; **DFLASH** speculative mode does not (returns `BadRequestError: DFLASH speculative decoding does not support grammar-constrained decoding yet.`).
- For 4+ parallel personas at scale, prefer high-concurrency mode (`--max-running-requests 16`). NEXTN handles 2-persona reviews comfortably.
- Python 3.10+ — **stdlib only**, no third-party packages required.

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
| `python3` not found | Use `run-http.sh` (bash + curl + jq) instead |

## Files

- `fork_review.py` — primary implementation (parallel HTTP via stdlib `concurrent.futures` + `urllib`, JSON-schema enforced via SGLang's `response_format`)
- `findings.schema.json` — JSON schema the XGrammar engine enforces per fork
- `personas.json` — persona key → focus instruction map (override-friendly)
- `requirements.txt` — placeholder; no third-party deps currently required
- `run.sh` — Python wrapper. Use this from chains. Skips venv setup since stdlib is sufficient.
- `run-http.sh` — bash + curl + jq alternative for environments without Python

## Performance expectation

Per the homelab benchmarks documented in the architecture (Section 7a.3):
- 4-persona review on a 7.5K-token shared prefix: ~4.6s wall time (cold prefill + 4× cached prefill + 4× ~1024 generated tokens at 250 tok/s)
- Sequential equivalent: ~18.5s
- Speedup target: ≥3× over sequential reviewer chains

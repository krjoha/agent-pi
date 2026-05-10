#!/usr/bin/env python3
"""Parallel persona code review against an SGLang OpenAI-compatible endpoint.

Sends N parallel POST /v1/chat/completions requests sharing the same prefix
(system + code), each with a persona-specific user turn and an XGrammar
JSON-schema response_format. SGLang's radix cache reuses the shared prefix
across the parallel forks; Qwen reasoning is disabled per request so the
constrained-decoding path produces the JSON directly.

Outputs a single merged FindingsReport on stdout. Exit codes:
  0 — success (some personas may have dropped if the model emitted invalid
      JSON despite the schema; reflected in metadata.personas_dropped).
  2 — SGLang server unreachable.
  3 — fatal error (invalid input, etc.).

Stdlib-only: no third-party Python deps required.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SCHEMA = json.loads((HERE / "findings.schema.json").read_text())
PERSONAS = json.loads((HERE / "personas.json").read_text())

DEFAULT_PERSONAS = ["correctness", "security", "performance", "dry"]
DEFAULT_ENDPOINT = "http://10.99.99.85:8003"
DEFAULT_MODEL = "RedHatAI/Qwen3.6-35B-A3B-NVFP4"
DEFAULT_MAX_TOKENS = 4096
DEFAULT_TEMPERATURE = 0.0
REQUEST_TIMEOUT = 120.0

SYSTEM_PROMPT = (
    "You are a senior code reviewer producing a structured JSON findings report. "
    "Report every issue that falls inside the assigned persona's domain. Do NOT skip a "
    "finding because another persona might also report it — coverage matters more than "
    "non-overlap; the synthesizer deduplicates downstream. "
    "Each finding must include a file, line, severity, category, description, evidence, "
    "and a concrete suggested_fix. Use sequential IDs prefixed by category "
    "(CORR-001, SEC-001, PERF-001, DRY-001). "
    "Output only JSON conforming to the schema — no prose. Empty findings is only "
    "correct when you have read the code thoroughly and confirmed there is genuinely "
    "nothing in scope."
)


def health_probe(endpoint: str, timeout: float = 3.0) -> bool:
    for path in ("/v1/models", "/health"):
        url = endpoint.rstrip("/") + path
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                if 200 <= resp.status < 300:
                    return True
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
            continue
    return False


def review_one_persona(
    persona: str,
    code_context: str,
    endpoint: str,
    model: str,
    max_tokens: int,
    temperature: float,
) -> tuple[str, dict[str, Any] | None, str | None]:
    """Send one persona's review request. Returns (persona, parsed_report, error)."""
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Code under review:\n\n{code_context}"},
            {"role": "user", "content": f"Review focus ({persona}): {PERSONAS[persona]}"},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "chat_template_kwargs": {"enable_thinking": False},
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "findings", "schema": SCHEMA},
        },
    }
    req = urllib.request.Request(
        endpoint.rstrip("/") + "/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return persona, None, f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}"
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return persona, None, f"network error: {e}"

    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return persona, None, f"unexpected response shape: {json.dumps(payload)[:300]}"
    if not content:
        return persona, None, "empty content (model may have hit max_tokens)"

    try:
        return persona, json.loads(content), None
    except json.JSONDecodeError as e:
        return persona, None, f"invalid JSON despite schema: {e}"


def merge_reports(per_persona: dict[str, dict[str, Any]]) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    seen: dict[tuple[str, int, str], dict[str, Any]] = {}
    summaries: list[str] = []

    sev_order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    for persona, report in per_persona.items():
        if isinstance(report.get("summary"), str) and report["summary"].strip():
            summaries.append(f"[{persona}] {report['summary'].strip()}")
        for f in report.get("findings", []):
            key = (f.get("file", ""), int(f.get("line", 0)), f.get("category", ""))
            if key in seen:
                existing = seen[key]
                if sev_order.get(f.get("severity"), 0) > sev_order.get(existing["severity"], 0):
                    existing["severity"] = f["severity"]
                if len(f.get("description", "")) > len(existing.get("description", "")):
                    existing["description"] = f["description"]
                if len(f.get("suggested_fix", "")) > len(existing.get("suggested_fix", "")):
                    existing["suggested_fix"] = f["suggested_fix"]
                existing["auto_fixable"] = bool(existing.get("auto_fixable")) and bool(
                    f.get("auto_fixable")
                )
            else:
                seen[key] = dict(f)
                findings.append(seen[key])

    cat_prefix = {
        "correctness": "CORR",
        "security": "SEC",
        "performance": "PERF",
        "dry": "DRY",
        "documentation": "DOC",
        "best_practice": "BP",
    }
    by_cat: dict[str, int] = {}
    for f in findings:
        prefix = cat_prefix.get(f.get("category", "best_practice"), "GEN")
        by_cat[prefix] = by_cat.get(prefix, 0) + 1
        f["id"] = f"{prefix}-{by_cat[prefix]:03d}"

    sev_present = {f["severity"] for f in findings}
    if sev_present & {"critical", "high"}:
        verdict = "NEEDS_CHANGES"
    elif findings:
        verdict = "APPROVED_WITH_NOTES"
    else:
        verdict = "APPROVED"

    return {
        "verdict": verdict,
        "summary": " | ".join(summaries) if summaries else "No findings.",
        "findings": findings,
    }


def parse_input(args: argparse.Namespace) -> dict[str, Any]:
    if args.stdin:
        try:
            payload = json.load(sys.stdin)
        except json.JSONDecodeError as e:
            raise SystemExit(f"ERROR: invalid JSON on stdin: {e}")
    else:
        payload = {}

    code_file = args.code_file or payload.get("code_file")
    if code_file:
        payload["code_context"] = Path(code_file).read_text()
    if "code_context" not in payload:
        raise SystemExit("ERROR: provide --code-file or pipe JSON with code_context on stdin")

    payload.setdefault("personas", args.personas or DEFAULT_PERSONAS)
    payload.setdefault("endpoint", args.endpoint or DEFAULT_ENDPOINT)
    payload.setdefault("model", args.model or DEFAULT_MODEL)
    payload.setdefault("max_tokens_per_fork", args.max_tokens or DEFAULT_MAX_TOKENS)
    payload.setdefault(
        "temperature", args.temperature if args.temperature is not None else DEFAULT_TEMPERATURE
    )

    unknown = set(payload["personas"]) - set(PERSONAS)
    if unknown:
        raise SystemExit(
            f"ERROR: unknown personas: {sorted(unknown)}. Available: {sorted(PERSONAS)}"
        )
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--code-file", help="Path to file containing the code under review")
    parser.add_argument("--stdin", action="store_true", help="Read JSON input from stdin")
    parser.add_argument("--personas", nargs="+", help=f"Persona keys (default: {' '.join(DEFAULT_PERSONAS)})")
    parser.add_argument("--endpoint", default=None, help=f"SGLang base URL (default: {DEFAULT_ENDPOINT})")
    parser.add_argument("--model", default=None, help=f"Model ID (default: {DEFAULT_MODEL})")
    parser.add_argument("--max-tokens", type=int, default=None, help="Max tokens per fork (default: 4096)")
    parser.add_argument("--temperature", type=float, default=None, help="Sampling temperature (default: 0.0)")
    args = parser.parse_args()

    payload = parse_input(args)
    endpoint = payload["endpoint"]

    if not health_probe(endpoint):
        print(f"ERROR: SGLang server unreachable at {endpoint}", file=sys.stderr)
        return 2

    personas = list(payload["personas"])
    per_persona: dict[str, dict[str, Any]] = {}
    dropped: list[tuple[str, str]] = []

    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=len(personas)) as pool:
        futures = {
            pool.submit(
                review_one_persona,
                persona,
                payload["code_context"],
                endpoint,
                payload["model"],
                payload["max_tokens_per_fork"],
                payload["temperature"],
            ): persona
            for persona in personas
        }
        for fut in as_completed(futures):
            persona, report, err = fut.result()
            if report is not None:
                per_persona[persona] = report
            else:
                dropped.append((persona, err or "unknown error"))
    wall_time = time.monotonic() - t0

    merged = merge_reports(per_persona)
    merged["metadata"] = {
        "wall_time_seconds": round(wall_time, 3),
        "personas_run": list(per_persona.keys()),
        "personas_dropped": [p for p, _ in dropped],
        "drop_reasons": {p: e for p, e in dropped},
        "backend": "stdlib-http",
    }

    json.dump(merged, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

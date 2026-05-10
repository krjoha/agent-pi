#!/usr/bin/env python3
"""Parallel persona code review using the SGLang DSL.

Sends one shared prefix (system + code) to a local SGLang server and forks
N persona-specific generations against the cached prefix. Each fork's output
is XGrammar-constrained to match `findings.schema.json`.

Outputs a single merged FindingsReport on stdout. Exit codes:
  0 — success (some personas may have dropped if their generation hit
      max_tokens; this is reflected in metadata.personas_run).
  2 — SGLang server unreachable.
  3 — fatal error (invalid input, missing dependency, etc.).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SCHEMA = json.loads((HERE / "findings.schema.json").read_text())
PERSONAS = json.loads((HERE / "personas.json").read_text())

DEFAULT_PERSONAS = ["correctness", "security", "performance", "dry"]
DEFAULT_ENDPOINT = "http://10.99.99.85:8003"
DEFAULT_MAX_TOKENS = 4096
DEFAULT_TEMPERATURE = 0.0


def health_probe(endpoint: str, timeout: float = 3.0) -> bool:
    url = endpoint.rstrip("/") + "/health"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        # Fall back to /v1/models if /health is not implemented
        try:
            url = endpoint.rstrip("/") + "/v1/models"
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                return 200 <= resp.status < 300
        except Exception:
            return False


def get_max_running_requests(endpoint: str, timeout: float = 3.0) -> int | None:
    """Return the server's --max-running-requests if discoverable, else None."""
    candidates = ["/get_server_info", "/server_info"]
    for path in candidates:
        url = endpoint.rstrip("/") + path
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                data = json.loads(resp.read())
                for key in ("max_running_requests", "max_total_num_requests"):
                    if isinstance(data.get(key), int):
                        return int(data[key])
        except Exception:
            continue
    return None


def system_prefix() -> str:
    return (
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


def run_with_dsl(
    code_context: str,
    personas: list[str],
    endpoint: str,
    max_tokens: int,
    temperature: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Run the parallel review using the SGLang DSL. Returns (per_persona, metadata)."""
    try:
        import sglang as sgl
    except ImportError as e:
        raise SystemExit(
            "ERROR: sglang Python package not installed. "
            "Run `pip install -r requirements.txt` or use run-http.sh."
        ) from e

    sgl.set_default_backend(sgl.RuntimeEndpoint(endpoint))

    @sgl.function
    def parallel_review(s, code: str, personas: list[str]):
        s += sgl.system(system_prefix())
        s += sgl.user(f"Code under review:\n\n{code}")

        forks = s.fork(len(personas))
        for fork, persona_key in zip(forks, personas):
            fork += sgl.user(f"Review focus ({persona_key}): {PERSONAS[persona_key]}")
            # NOTE: thinking is controlled differently in SGL DSL vs the OpenAI HTTP API.
            # If the model wastes tokens on reasoning, prefer run-http.sh which sets
            # chat_template_kwargs.enable_thinking=false directly on the request.
            fork += sgl.gen(
                "report",
                max_tokens=max_tokens,
                temperature=temperature,
                json_schema=json.dumps(SCHEMA),
            )
        forks.join()
        return forks

    t0 = time.monotonic()
    forks = parallel_review.run(code=code_context, personas=personas)
    wall_time = time.monotonic() - t0

    per_persona: dict[str, Any] = {}
    dropped: list[str] = []
    for persona_key, fork in zip(personas, forks):
        raw = fork["report"]
        try:
            per_persona[persona_key] = json.loads(raw)
        except json.JSONDecodeError:
            dropped.append(persona_key)

    metadata = {
        "wall_time_seconds": round(wall_time, 3),
        "personas_run": list(per_persona.keys()),
        "personas_dropped": dropped,
    }
    return per_persona, metadata


def merge_reports(per_persona: dict[str, Any]) -> dict[str, Any]:
    """Merge per-persona findings into a single deduplicated report."""
    findings: list[dict[str, Any]] = []
    seen: dict[tuple[str, int, str], dict[str, Any]] = {}
    summaries: list[str] = []

    for persona_key, report in per_persona.items():
        if isinstance(report.get("summary"), str):
            summaries.append(f"[{persona_key}] {report['summary']}")
        for f in report.get("findings", []):
            key = (f.get("file", ""), int(f.get("line", 0)), f.get("category", ""))
            if key in seen:
                # Keep highest severity, longer description, more concrete fix
                existing = seen[key]
                sev_order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
                if sev_order.get(f["severity"], 0) > sev_order.get(existing["severity"], 0):
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

    # Renumber IDs sequentially per category
    by_cat: dict[str, int] = {}
    for f in findings:
        cat = f.get("category", "best_practice")
        prefix = {
            "correctness": "CORR",
            "security": "SEC",
            "performance": "PERF",
            "dry": "DRY",
            "documentation": "DOC",
            "best_practice": "BP",
        }.get(cat, "GEN")
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
    payload.setdefault("max_tokens_per_fork", args.max_tokens or DEFAULT_MAX_TOKENS)
    payload.setdefault("temperature", args.temperature if args.temperature is not None else DEFAULT_TEMPERATURE)

    unknown = set(payload["personas"]) - set(PERSONAS)
    if unknown:
        raise SystemExit(f"ERROR: unknown personas: {sorted(unknown)}. Available: {sorted(PERSONAS)}")

    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--code-file", help="Path to file containing the code under review")
    parser.add_argument("--stdin", action="store_true", help="Read JSON input from stdin")
    parser.add_argument("--personas", nargs="+", help="Persona keys to run (default: all four)")
    parser.add_argument("--endpoint", default=None, help=f"SGLang base URL (default: {DEFAULT_ENDPOINT})")
    parser.add_argument("--max-tokens", type=int, default=None, help="Max tokens per fork (default: 4096)")
    parser.add_argument("--temperature", type=float, default=None, help="Sampling temperature (default: 0.0)")
    args = parser.parse_args()

    payload = parse_input(args)
    endpoint = payload["endpoint"]

    if not health_probe(endpoint):
        print(f"ERROR: SGLang server unreachable at {endpoint}", file=sys.stderr)
        return 2

    cap = get_max_running_requests(endpoint)
    personas = list(payload["personas"])
    batched = False
    per_persona: dict[str, Any] = {}
    total_wall = 0.0
    dropped_total: list[str] = []

    if cap is not None and cap < len(personas):
        # Auto-batch in groups of `cap`
        batched = True
        for i in range(0, len(personas), cap):
            batch = personas[i : i + cap]
            pp, md = run_with_dsl(
                payload["code_context"],
                batch,
                endpoint,
                payload["max_tokens_per_fork"],
                payload["temperature"],
            )
            per_persona.update(pp)
            total_wall += md["wall_time_seconds"]
            dropped_total.extend(md.get("personas_dropped", []))
    else:
        per_persona, md = run_with_dsl(
            payload["code_context"],
            personas,
            endpoint,
            payload["max_tokens_per_fork"],
            payload["temperature"],
        )
        total_wall = md["wall_time_seconds"]
        dropped_total = md.get("personas_dropped", [])

    merged = merge_reports(per_persona)
    merged["metadata"] = {
        "wall_time_seconds": round(total_wall, 3),
        "personas_run": list(per_persona.keys()),
        "personas_dropped": dropped_total,
        "batched": batched,
        "server_max_running_requests": cap,
    }

    json.dump(merged, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

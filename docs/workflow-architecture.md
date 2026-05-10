# Architecture: Workflow Adaptation with Berget.AI and SGLang

**Status:** Draft  
**Date:** 2026-05-06  
**Scope:** Adapting agent-pi to a standardized personal workflow with EU cloud (Berget.AI) and local inference (SGLang / Qwen3.6-35B-A3B-NVFP4).

---

## 0. Canonical Workflow

The target workflow has three phases with explicit human approval gates. Every phase is a separate chain invocation. The human drives transitions between phases.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PLAN                                                                        │
│                                                                             │
│  1. Human: describe task  →  2. AI: plan  ⇄  3. Human: review plan         │
│                                                  ↓ Approved                │
└──────────────────────────────────────────────────┼──────────────────────────┘
                                                   │
┌──────────────────────────────────────────────────▼──────────────────────────┐
│ BUILD                                                                       │
│                                                                             │
│  4. AI: implement  →  5. AI: test  →  6. Human: test                       │
│       ↑                                    ↓ No                            │
│       └────────────────────────────────────┘                               │
│                                            ↓ (continues)                   │
│                              7. Human: review code structure                │
│                                    ↓ No ──────────────────────────→ step 4 │
│                                    ↓ Yes                                   │
│                              8. AI: review source code  ←── (SGL fork)     │
│                                    ↓                                       │
│                              9. Human: review findings                      │
│                                    ↓ Not addressed ────────────→ step 4    │
│                                    ↓ Findings addressed                    │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────────┐
│ SHIP                                                                        │
│                                                                             │
│  10. Human: review source code  →  Final approval?  →  11. Manual: Publish │
│                                         ↓ No                               │
│                                    (back to Build step 4)                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Step-to-agent mapping

| Step | Actor | Agent / Chain | Provider |
|---|---|---|---|
| 1. Describe task | Human | — | — |
| 2. Plan implementation | AI | `planner` | berget / gemma-4-31b |
| 3. Review plan | Human | interactive gate | — |
| 4. Implement feature | AI | `builder` | sglang / qwen3.6 |
| 5. Test feature | AI | `tester` + `herald` | sglang / qwen3.6 |
| 6. Test feature | Human | interactive gate | — |
| 7. Review code structure | Human | interactive gate | — |
| 8. Review source code | AI | **sgl-fork-review** → `synthesizer` | sglang / qwen3.6 |
| 9. Review findings | Human | interactive gate | — |
| 10. Review source code | Human | interactive gate | — |
| 11. Publish | Human | manual | — |

### Key design constraints from the workflow

- **Chains must terminate at human gates.** Each phase is a discrete chain run. The human decides when to move to the next phase, not the chain executor.
- **AI runs before humans wherever both can evaluate the same thing.** AI tokens are cheap, human attention is the bottleneck. Step 5 (AI test) precedes step 6 (human test). Step 8 (AI source review) precedes step 9 (human reads findings). The AI's job is to pre-filter and produce a concrete, actionable findings report — anything trivially detectable by AI should never reach the human's eyes unflagged.
- **Step 8 is the primary AI code review and the cost center to optimize.** Every second saved here is a second the human gets back. This is where the SGL fork pays off most: 4 persona reviews (correctness, security, performance, DRY) running in parallel against a shared cached prefix completes in roughly the wall time of a single review.
- **The loop target is always step 4.** When any human gate rejects (steps 6, 7, 9, 10), the re-entry point is step 4 (re-implement). The chain structure should make this natural: the `build-test` chain is re-invoked with the prior output and the rejection reason as input.
- **Findings must be machine-parseable, not free prose.** Step 8's output feeds step 9 (human review). A structured JSON findings report (XGrammar-enforced — see Section 7) lets the chain executor render the same data multiple ways: a terse summary for triage, a deep-dive view per finding, and an "auto-fix" payload for paladin if the human wants AI to address the findings before re-reading.

### Chain-to-phase mapping

| Phase | Chain(s) | Human trigger |
|---|---|---|
| Plan | `plan` (new: planner → interactive) | User runs chain, approves output |
| Build: implement + test | `build-test` (new: builder → tester → herald) | User verifies tests pass, reviews structure |
| Build: AI review | `local-review` or `code-review` | User triggers after confirming steps 6–7 |
| Ship | No chain — manual step | User does final read + publishes |

---

## 1. Goals

1. **Provider integration** — wire Berget.AI (EU cloud, OpenAI-compatible) and the local SGLang inference server as first-class providers alongside the existing Anthropic provider.
2. **Agent cleanup** — remove agents that do not fit the personal workflow; reassign core agent roles to the best-fit model for each task.
3. **SGLang performance** — exploit radix caching, speculative decoding, and structured output (XGrammar) for maximum tokens-per-second on local inference.
4. **Parallel forked review** — use the SGL runtime's prefix-sharing behavior to run N persona-specific reviews against the same code+context at near the cost of one.
5. **Workflow chains** — align `agent-chain.yaml` and `pipeline-team.yaml` with the above.

---

## 2. Current State

### 2.1 Agent inventory

`agents/models.json` maps each named agent role to a `provider` + `model` pair. The current map:

| Role | Provider | Model | Notes |
|---|---|---|---|
| default | anthropic | claude-haiku-4-5-20251001 | catch-all |
| scout | x-ai | grok-4.1-fast | fast exploration |
| ranger | openai-codex | gpt-5.4 | DRY / pattern review |
| builder | anthropic | claude-haiku-4-5 | code generation |
| paladin | anthropic | claude-opus-4-6 | remediation |
| reviewer | anthropic | claude-opus-4-6 | code review |
| warden | anthropic | claude-opus-4-6 | synthesis / validation |
| planner | openai-codex | gpt-5.4 | planning |
| tester | openai-codex | gpt-5.4 | test writing |
| herald | openai-codex | gpt-5.4 | test verification |
| red-team | openai-codex | gpt-5.4 | security |
| knight | openai-codex | gpt-5.4 | security review |
| rlm-subcall | anthropic | claude-haiku-4-5 | internal |

`agents/teams.yaml` also defines a `toolkit` team (copilot-agent, cursor-agent, codex-agent, gemini-agent, qwen-agent, opencode-agent, groq-agent, droid-agent, crush-agent) with corresponding `agents/*.md` files and `agents/toolkit-models.json`. These simulate other AI coding tools and do not fit the personal workflow.

### 2.2 What needs to change

- The toolkit agent family is noise; it should be removed from `teams.yaml` and its model file retired.
- `reviewer`, `warden`, and `paladin` on claude-opus are the most expensive roles per token — these are the best candidates for the local SGLang server on tasks that fit within 2 concurrent request slots.
- The code-review chain runs 11 sequential agents. With radix caching, the scout steps that read the same files can share KV; with forked parallel calls, the persona-specific review steps (warden quality, knight security) can run concurrently.
- No provider definition exists for Berget or SGLang — that must be added first.

### 2.3 Local SGLang reference

Server: `http://10.99.99.85:8003/v1` (OpenAI-compatible)  
Model: `RedHatAI/Qwen3.6-35B-A3B-NVFP4`  
Relevant benchmarks (RTX 5090, per homelab docs):

| Scenario | Throughput |
|---|---|
| Single-stream decode (NEXTN speculative, 2-slot mode) | ~253 tok/s |
| Cached prefill (7.5K tokens, 99% reuse) | 0.16 s wall |
| Cold prefill (7.5K tokens) | 0.53 s wall |
| Aggregate at N=8 (high-concurrency, no speculative) | ~884 tok/s |
| Max concurrent requests (speculative mode) | 2 |
| Max concurrent requests (high-concurrency mode) | 16+ |

Tool calling is handled server-side via `--tool-call-parser qwen3_coder` (XGrammar-backed). Thinking tokens route to `reasoning_content` via `--reasoning-parser qwen3`.

---

## 3. Provider Layer

### 3.1 Berget.AI

- **Base URL:** `https://api.berget.ai/v1`
- **Auth:** API key format `sk_ber_...`, stored in `~/.pi/agent/auth.json` as `{"berget": {"type": "api_key", "key": "sk_ber_..."}}`
- **File permissions:** `0600`
- **Provider type:** `openai-completions`
- **Compatibility flag:** `supportsDeveloperRole: false`

Available models:

| Model ID | Context | Capabilities |
|---|---|---|
| `zai-org/GLM-4.7-FP8` | 200K | reasoning, text |
| `openai/gpt-oss-120b` | 128K | reasoning, text + vision |
| `google/gemma-4-31b-it` | 256K | reasoning, text + vision |
| `mistralai/Mistral-Medium-3.5-128B` | 256K | reasoning, text + vision |

Use Berget for: long-context tasks (> 131K tokens), EU-residency privacy constraints, or when the local GPU is unavailable.

### 3.2 SGLang local

- **Base URL:** `http://10.99.99.85:8003/v1`
- **Auth:** none (pass `apiKey: "EMPTY"` in the provider config to satisfy the OpenAI client)
- **Model:** `RedHatAI/Qwen3.6-35B-A3B-NVFP4`
- **Context:** 262K (KV pool ~266K)
- **Provider type:** `openai-completions`

Use SGLang for: high-frequency agent turns (scout, builder, reviewer), parallel forked reviews, and any task where radix caching of repeated context gives measurable speedup.

### 3.3 Provider registration

Add both providers to `~/.pi/agent/models.json` following the existing Berget pi integration format. The local provider entry mirrors the Berget structure but points to the LAN address and uses a dummy key. Concretely, `models.json` needs a top-level `providers` section (or the equivalent pi config key for custom provider endpoints) containing:

```json
{
  "berget": {
    "type": "openai-completions",
    "baseURL": "https://api.berget.ai/v1",
    "supportsDeveloperRole": false
  },
  "sglang": {
    "type": "openai-completions",
    "baseURL": "http://10.99.99.85:8003/v1",
    "apiKey": "EMPTY",
    "supportsDeveloperRole": false
  }
}
```

The exact key names depend on how pi reads provider configurations — confirm against the Berget pi integration docs for the authoritative field names before editing the file.

---

## 4. Agent Inventory Cleanup

### 4.1 Remove: toolkit agents

The following agents exist solely to simulate other AI coding tools and add no value to a personal workflow. Remove them from `teams.yaml` (the `toolkit` and `all` team lists) and retire their `.md` files and the `toolkit-models.json` config:

```
agents/builder-gemini-3-1-flash-lite-preview.md
agents/builder-gpt-5-1-codex-mini.md
agents/builder-kimi-k2-5.md
agents/builder-minimax-m2-5.md
agents/builder-qwen3-5-122b-a10b.md
agents/builder-qwen3-5-flash-02-23.md
agents/builder-qwen3-coder.md
agents/builder-qwen3-coder-next.md
agents/copilot-agent.md
agents/toolkit-models.json
```

The `team-b-builders` team in `teams.yaml` references all of these; remove that block too.

### 4.2 Core agent model reassignment

The updated `agents/models.json` should reflect the following reasoning:

| Role | Proposed Provider | Proposed Model | Rationale |
|---|---|---|---|
| default | anthropic | claude-haiku-4-5-20251001 | unchanged; catch-all for anything not in the map |
| scout | sglang | RedHatAI/Qwen3.6-35B-A3B-NVFP4 | fast prefill + radix cache → codebase exploration reuses system prompt KV on every call |
| ranger | sglang | RedHatAI/Qwen3.6-35B-A3B-NVFP4 | DRY/pattern analysis reads many files; prefix caching compounds across a session |
| builder | sglang | RedHatAI/Qwen3.6-35B-A3B-NVFP4 | code generation with native XGrammar tool-call enforcement |
| reviewer | sglang | RedHatAI/Qwen3.6-35B-A3B-NVFP4 | primary review workload; see forked review section |
| warden | berget | google/gemma-4-31b-it | synthesis needs long context (256K) and is typically one-shot; EU cloud acceptable |
| planner | berget | google/gemma-4-31b-it | 256K context, reasoning model — good fit for architecture planning |
| paladin | berget | openai/gpt-oss-120b | remediation agent; benefits from 120B scale for fix quality |
| tester | sglang | RedHatAI/Qwen3.6-35B-A3B-NVFP4 | test generation is code-shaped; local speed preferred |
| herald | sglang | RedHatAI/Qwen3.6-35B-A3B-NVFP4 | test verification; same reasoning |
| red-team | berget | mistralai/Mistral-Medium-3.5-128B | adversarial security analysis; different model family adds diversity |
| knight | berget | zai-org/GLM-4.7-FP8 | security review; reasoning model, 200K context |
| rlm-subcall | sglang | RedHatAI/Qwen3.6-35B-A3B-NVFP4 | internal sub-calls; local speed preferred |

**Concurrency note:** The SGLang server runs in speculative mode (NEXTN) with `--max-running-requests 2`. Any chain that fires more than 2 parallel SGLang agents simultaneously will queue. For pipelines with heavy parallelism (the 4-parallel-scout step in `code-review`), either: (a) accept the queue and keep speculative mode for better single-stream speed, or (b) restart SGLang in high-concurrency mode (`--max-running-requests 16`, drop speculative flags) before running the pipeline. Document this tradeoff in the chain descriptions.

### 4.3 New agents to create

**`sgl-reviewer`** (`agents/sgl-reviewer.md`) — a specialized reviewer variant whose system prompt is structured for maximum radix cache efficiency (see Section 5.2). Used as the leaf agent in forked review calls. Identical role semantics to `reviewer`, but the system prompt is written as a stable, cacheable prefix with only the persona and task injected at the end.

**`synthesizer`** (`agents/synthesizer.md`) — aggregates N parallel review outputs into a single consolidated report. Role: read-only, no tools except `read`. This replaces the `warden` "Step 5: Context Synthesis" sub-role that currently appears inline in the `code-review` chain prompt.

---

## 5. SGLang Performance Optimization

### 5.1 Radix cache strategy

SGLang's RadixAttention reuses KV for any shared prefix. The reuse key is byte-for-byte identity of the token sequence. For agent-pi chains, this means:

**Structure prompts in this order (most-stable first):**
1. System prompt (role definition, constraints, output format) — never changes across turns
2. Shared context (codebase overview, the file(s) being reviewed) — stable within a chain run
3. Per-step instructions — varies; placed last, so everything above is cached

The current `code-review` chain embeds step-specific instructions inside the system prompt section of some agents. This breaks caching. When rewriting agent prompts, move everything task-specific into the `user` turn.

**Practical impact:** In a 5-step review chain where each step re-sends a 7.5K token system+codebase prefix, only the first step pays the 0.53s cold prefill; steps 2–5 each pay ~0.16s (99% cache hit). On a 10-file codebase review this is ~2s saved per chain run.

### 5.2 Agent prompt structure for cache efficiency

Every agent `.md` file that will route to the SGLang provider should be structured as:

```
[System section — stable role definition, output format rules, constraints]

--- DO NOT put task-specific content above this line ---

[User turn (injected at invocation time): the actual task, file content, prior step output]
```

The `builder.md` and `reviewer.md` prompts currently follow this pattern well. The longer chain-embedded prompts in `agent-chain.yaml` (e.g., the `code-review` chain) mix stable instructions with step-specific content — these should be factored so that the stable instructions live in the agent `.md` file and only the step-specific part is passed as the chain's `prompt:` field.

### 5.3 Sampling parameters for Qwen3.6

The SGLang server docs (and Unsloth recommendation) call for:
- `temperature: 0.6`
- `top_p: 0.95`
- `presence_penalty: 1.5`
- **Do not pass** `top_k` — SGLang's strict OpenAI validation rejects it and returns a 422 error.

For agents that need deterministic output (tester, structured JSON responses), use `temperature: 0.0`. For thinking mode, the server already exposes it per-request via `chat_template_kwargs: {enable_thinking: true/false}`.

### 5.4 Concurrency mode selection

Add a note to `agents/models.json` (or a companion README) documenting the two SGLang operating modes and when to switch:

| Mode | Server flags | Solo decode | N=8 aggregate | Best for |
|---|---|---|---|---|
| Speculative (NEXTN) | `--max-running-requests 2` + speculative flags | 253 tok/s | N/A (queues) | Single user, tool loops |
| High-concurrency | `--max-running-requests 16`, no speculative | 158 tok/s | 884 tok/s | Multi-agent chains |

The switch command is documented in `homelab/docs/llm-serving/qwen3.6-35b-a3b-sglang.md` under "Switching to high-concurrency mode."

---

## 6. SGL Fork Integration for Parallel Review

### 6.1 The problem

The current `code-review` chain runs reviewers sequentially: scout → ranger → (3 more scouts) → warden → warden → knight → paladin → warden → herald → warden. The middle steps that independently analyze the same code (quality review + security review) could run in parallel, but the current chain structure is linear.

More importantly, any step that sends the same `system + code_context` prefix to the model pays the full prefill cost each time because consecutive agents are separate HTTP requests and (in the current setup) may not share the same LLM process.

When routing to SGLang, all requests within a session share the same radix cache. Parallel requests with the same prefix each pay the cache hit cost (~0.16s for 7.5K tokens), not the cold prefill cost (~0.53s). This means N parallel persona-specific reviews cost approximately: `cold_prefill_once + N × cached_prefill + N × generation`.

### 6.2 Implementation approach

**Recommended: SGL DSL `fork()` program in Python.** Reference implementation in Section 7a.3.

The DSL is preferred over parallel HTTP calls because: (1) it guarantees prefix sharing as a single atomic program execution rather than relying on radix cache hits across separately-arriving requests, (2) it gives access to `select()` and `json_schema=` constraints that aren't available via the OpenAI-compatible HTTP interface alone, and (3) it eliminates a layer of bash glue between the chain step and the result.

A parallel-HTTP fallback (no Python dependency) is documented at the bottom of this section for environments where adding the `sglang` Python package is undesirable.

### 6.3 Skill specification

Layout:

```
skills/sgl-fork-review/
  SKILL.md             — invocation contract (input/output format, prerequisites)
  fork_review.py       — @sgl.function program + CLI (see Section 7a.3)
  findings.schema.json — JSON schema enforced on each fork's output (see Section 7.2)
  personas.json        — persona key → focus instruction map (overridable per call)
  requirements.txt     — sglang pinned to the server image's nightly date
  run.sh               — wrapper that activates a venv and shells to fork_review.py
```

**Input contract** (passed via stdin as JSON):

```json
{
  "code_context": "string — the code under review, file paths included as headers",
  "personas": ["correctness", "security", "performance", "dry"],
  "endpoint": "http://10.99.99.85:8003",
  "max_tokens_per_fork": 4096,
  "temperature": 0.0
}
```

**Output contract** (printed to stdout as JSON, validated against `findings.schema.json`):

```json
{
  "verdict": "NEEDS_CHANGES",
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

The XGrammar-enforced JSON schema on `gen()` guarantees each fork's output validates; the merge step in the same Python program concatenates the per-persona findings, deduplicates by `(file, line, category)`, and emits the final structure.

**Failure modes:**
- SGLang server unreachable → exit code 2, stderr message, no JSON on stdout. Chain step should fail fast and surface the error to the human.
- A fork generates invalid JSON despite the schema constraint (rare; happens if the model hits `max_tokens` mid-object) → that persona's findings are dropped, `metadata.personas_run` reflects only completed personas, exit code 0, processing continues.
- More than 2 personas requested while the server is in speculative mode → the script detects this via a probe to `/health` (or `--max-running-requests` reflected in server info) and either auto-batches in pairs or refuses with a clear error directing the user to switch to high-concurrency mode.

### 6.4 Fallback: parallel HTTP without the SGL DSL

If the Python sglang dependency is undesirable, an equivalent skill can be built with bash + curl + jq. Send N concurrent `POST /v1/chat/completions` calls with `response_format: {type: "json_schema", json_schema: {schema: ...}}` to enforce the same per-fork output contract. Radix cache reuse is still automatic when the prefixes match byte-for-byte, but prefix sharing is best-effort rather than guaranteed (if requests arrive out-of-order relative to the prefill scheduler, the second through Nth may pay extra cost). Documented as `skills/sgl-fork-review/run-http.sh` for completeness.

### 6.5 New chain using forked review

Add to `agent-chain.yaml`:

```yaml
local-code-review:
  description: "Fast parallel code review via SGLang radix cache + forked personas"
  steps:
    - agent: scout
      prompt: "Identify change scope and gather architecture context: $INPUT"
    - agent: sgl-fork-review   # new skill step, not a standard agent
      prompt: "Run parallel review against the gathered context: $INPUT"
    - agent: synthesizer
      prompt: "Consolidate the parallel review outputs into a structured report: $INPUT"
    - agent: paladin
      prompt: "Apply fixes for Critical and High findings: $INPUT"
```

The `sgl-fork-review` step type needs a mechanism to invoke a skill rather than an agent. If the current chain executor does not support this natively, the intermediate solution is to wrap the skill call inside a lightweight `sgl-fork-agent` agent (a thin `.md` file whose system prompt instructs it to invoke the skill via bash and return the result).

---

## 7. XGrammar and Structured Output

XGrammar is SGLang's grammar-constrained decoding engine. It enforces output structure at the token level — the model's logits are masked at every step so only tokens that keep the output on a valid grammar path are sampled. This is fundamentally different from prompt-level "please return JSON" instructions, which the model can violate.

For agent-pi this matters because every structured handoff between chain steps becomes guaranteed-parseable. No more retry loops on malformed JSON, no more regex extraction from prose, no more "the synthesizer choked because warden returned markdown instead of JSON."

### 7.1 Three layers of constrained output

**Layer 1 — Tool calling (already active)**

Server flag: `--tool-call-parser qwen3_coder`. Active for all SGLang traffic. When an agent fires a tool call, XGrammar enforces the function-call grammar; the model cannot emit malformed `<tool_call>` blocks. This was the source of the NGRAM speculative breakage documented in the homelab notes — NEXTN+XGrammar produces structurally valid drafts.

No code changes needed. Any agent routed to SGLang that uses tools gets this for free.

**Layer 2 — JSON schema response (per-request)**

OpenAI-compatible field: `response_format: {type: "json_schema", json_schema: {schema: {...}}}`. Pass a JSON schema and the model output is guaranteed to validate against it. Use this for any agent step whose output is consumed structurally by the next step.

In agent-pi: the **synthesizer**, **sgl-fork-review**, and any agent producing a "findings" report should pass a schema. The schema becomes part of the contract between chain steps.

**Layer 3 — Regex / EBNF constraint (per-generation)**

SGL DSL's `gen(name, regex="...")` or `gen(name, choices=[...])`. Most useful inside SGL fork programs for forcing one-token decisions ("yes"/"no") or fixed enum values. These are also XGrammar-enforced.

### 7.2 Concrete schemas for the workflow

The findings report from `sgl-fork-review` and `synthesizer` should use this schema (this is the contract; the agents and skill must produce this format):

```json
{
  "type": "object",
  "required": ["verdict", "summary", "findings"],
  "properties": {
    "verdict": {"enum": ["APPROVED", "APPROVED_WITH_NOTES", "NEEDS_CHANGES"]},
    "summary": {"type": "string", "maxLength": 1000},
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "severity", "category", "file", "line", "description", "suggested_fix"],
        "properties": {
          "id": {"type": "string", "pattern": "^[A-Z]+-\\d{3}$"},
          "severity": {"enum": ["critical", "high", "medium", "low"]},
          "category": {"enum": ["correctness", "security", "performance", "dry", "documentation", "best_practice"]},
          "file": {"type": "string"},
          "line": {"type": "integer"},
          "description": {"type": "string"},
          "evidence": {"type": "string"},
          "suggested_fix": {"type": "string"},
          "auto_fixable": {"type": "boolean"}
        }
      }
    }
  }
}
```

Why this matters operationally:
- The chain executor can render the same JSON as a terse summary, a per-finding deep dive, or a "fix list" payload to paladin.
- Human gate at step 9 becomes mechanical: the human triages findings by severity, marks `auto_fixable: true` ones for paladin, manually addresses the rest.
- Cross-run comparison is trivial — the findings JSON from two consecutive runs of `local-review` can be diffed to see what got fixed.

### 7.3 Constrained output for triage decisions

Several places in the chain use the model to make a one-bit decision ("does this code have any critical findings?", "is this fix sufficient?"). For these, use SGL DSL's `select()` against the SGLang server:

```python
@sgl.function
def quick_triage(s, code: str):
    s += sgl.system("You are a code triage agent.")
    s += sgl.user(f"Does the following code have any critical bugs?\n\n{code}")
    s += sgl.assistant("My answer: ")
    s += sgl.select("verdict", choices=["yes", "no"])
```

`select()` uses XGrammar to mask all tokens except those starting "yes" or "no", and only generates as many tokens as needed to disambiguate. This is **one to two tokens of output**, not a paragraph. For triage agents this collapses generation cost from ~500ms to ~10ms.

### 7.4 When to use which layer

| Use case | Mechanism | Where |
|---|---|---|
| Agent calls a tool | tool-call-parser (auto) | Any SGLang-routed agent |
| Agent produces a findings report | `response_format: json_schema` | synthesizer, sgl-fork-review, knight, warden |
| Agent picks from a fixed enum | SGL DSL `select()` | Triage agents, gate decisions |
| Agent emits a fixed-format string (e.g., commit message) | SGL DSL `gen(regex=...)` | herald (commit messages), documenter (file headers) |

---

## 7a. SGL DSL Beyond Fork

The SGL Python library exposes more than just `fork()`. The fork primitive is the headline feature for this architecture, but several other DSL primitives apply to specific agent-pi use cases. All are XGrammar-backed where applicable.

### 7a.1 The full primitive set

| Primitive | Behavior | agent-pi use |
|---|---|---|
| `s += sgl.system(text)` | Append system message | Stable role prefix (cached) |
| `s += sgl.user(text)` | Append user turn | Per-task input (varies) |
| `s += sgl.assistant(text)` | Append assistant turn (no generation) | Persona priming inside forks |
| `s += sgl.gen(name, ...)` | Generate continuation | Standard generation step |
| `s += sgl.select(name, choices=[...])` | Constrained pick from list | Triage / gate decisions |
| `s.fork(N)` | Fork into N parallel streams sharing prefix | Parallel persona review |
| `forks.join()` | Wait for all forks | Synchronization |
| `gen(..., regex=R)` | Generation constrained by regex | Format compliance |
| `gen(..., json_schema=J)` | Generation constrained by JSON schema | Structured output |
| `s += sgl.image(path)` | Multimodal input | Not applicable to Qwen3.6 (text-only via SGLang) |

### 7a.2 The fork pattern (canonical implementation)

The `sgl-fork-review` skill should be implemented in Python using SGL DSL (Approach B in Section 6.2), not via parallel HTTP calls (Approach A). The reasons:

1. **Guaranteed prefix sharing.** With parallel HTTP calls, the SGLang scheduler may or may not coalesce them depending on arrival timing — close-in-time calls hit the radix cache but the scheduler can still re-prefill if requests interleave with other traffic. `s.fork()` is a single program execution that the runtime treats atomically.
2. **`select()` and `json_schema` access.** Approach A can pass `response_format` per request, but `select()` for one-token persona verdicts is only available via the DSL.
3. **Programmatic merge.** The DSL's `forks.join()` returns the N completed states, which the same Python script can merge directly without a separate `merge.py`.
4. **One Python dependency.** The `sglang` package is the single new dependency. No additional shell scripting layer.

Move the recommendation in Section 6.2 from Approach A (HTTP) to **Approach B (SGL DSL) as the primary implementation**. Approach A remains documented as the simpler fallback if the user wants to avoid the Python dependency on the agent-pi host.

### 7a.3 Reference fork program

```python
# skills/sgl-fork-review/fork_review.py
import sglang as sgl
import json
from pathlib import Path

PERSONAS = {
    "correctness": "Focus on logic errors, edge cases, null handling, and race conditions.",
    "security":    "Focus on injection, auth gaps, secrets exposure, and unsafe deserialization.",
    "performance": "Focus on N+1 queries, blocking I/O, memory leaks, and missing caching.",
    "dry":         "Focus on duplication, unnecessary new abstractions, and missed reuse of existing code.",
}

FINDINGS_SCHEMA = json.loads(Path(__file__).parent.joinpath("findings.schema.json").read_text())

@sgl.function
def parallel_review(s, code_context: str, personas: list[str]):
    s += sgl.system(
        "You are a senior code reviewer. Produce a structured JSON findings report. "
        "Do not editorialize; every finding must have a file, line, severity, and concrete suggested fix."
    )
    s += sgl.user(f"Code under review:\n\n{code_context}")

    forks = s.fork(len(personas))
    for fork, persona_key in zip(forks, personas):
        fork += sgl.user(f"Review focus: {PERSONAS[persona_key]}")
        fork += sgl.gen("report", max_tokens=4096, json_schema=FINDINGS_SCHEMA)
    forks.join()

    return {p: json.loads(f["report"]) for p, f in zip(personas, forks)}

if __name__ == "__main__":
    import sys, argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--code-file", required=True)
    parser.add_argument("--personas", nargs="+", default=list(PERSONAS.keys()))
    parser.add_argument("--endpoint", default="http://10.99.99.85:8003")
    args = parser.parse_args()

    sgl.set_default_backend(sgl.RuntimeEndpoint(args.endpoint))
    code = Path(args.code_file).read_text()
    result = parallel_review.run(code_context=code, personas=args.personas)
    json.dump(result, sys.stdout, indent=2)
```

The shared prefix (system + code) is prefilled once; each fork only generates its persona-specific findings. Per the homelab benchmarks: a 7.5K-token shared prefix takes 0.53s cold, then each fork's generation runs at ~250 tok/s with NEXTN. Four 1024-token persona reports complete in roughly `0.53s + (1024 / 250) ≈ 4.6s` total wall time, versus `4 × (0.53s + 4.1s) = 18.5s` for four sequential reviews. **~4× speedup on the most expensive step in the chain.**

Note: the SGLang server's `--max-running-requests 2` cap in speculative mode limits concurrent forks to 2. Four-persona reviews require restarting the server in high-concurrency mode (Section 5.4) before invoking the chain. The skill should detect this and either error early with a clear message or auto-batch the forks in pairs.

### 7a.4 Other DSL applications in agent-pi

- **herald commit messages**: `gen("commit_msg", regex=r"^(feat|fix|refactor|docs|test|chore)(\([^)]+\))?: .{1,72}$")` enforces conventional-commit format at decode time.
- **planner phase boundaries**: `select("phase_count", choices=["1", "2", "3", "4", "5"])` forces an explicit phase count before generating phase content.
- **paladin auto-fix decisions**: for each finding from synthesizer, `select("apply_fix", choices=["yes", "skip", "needs_review"])` triages whether to attempt an auto-fix, with one-token cost per finding.

---

## 8. Chain Redesign

The chain structure is reorganized around the 3-phase workflow from Section 0. Each phase maps to one or two chains. The human invokes the appropriate chain at each phase boundary.

### 8.1 Phase 1: Plan chains

```yaml
# Workflow steps 1-3: Human describes → AI plans → Human approves
plan:
  description: "Plan the implementation — AI produces a structured plan for human approval"
  steps:
    - agent: planner
      prompt: "Create a detailed, phased implementation plan for: $INPUT"

# For complex tasks: plan → critique → revise before human review
plan-refine:
  description: "Plan with built-in critique cycle before presenting to human"
  steps:
    - agent: planner
      prompt: "Create a detailed implementation plan for: $INPUT"
    - agent: reviewer
      prompt: "Critique this plan for gaps, risks, and missed alternatives:\n\n$INPUT\n\nOriginal request: $ORIGINAL"
    - agent: planner
      prompt: "Revise the plan addressing every critique raised:\n\nOriginal request: $ORIGINAL\n\nCritique:\n$INPUT"
```

The human reads the output, requests revisions (re-runs the chain with feedback as $INPUT), or approves and moves to Build.

### 8.2 Phase 2: Build chains

```yaml
# Workflow steps 4-5: AI implements then AI tests
build-test:
  description: "Implement and test — AI builds from an approved plan, then runs tests"
  steps:
    - agent: builder
      prompt: "Implement the following approved plan:\n\n$INPUT"
    - agent: tester
      prompt: "Write and run tests for this implementation. Report results.\n\n$INPUT"
    - agent: herald
      prompt: "Verify all tests pass. Fix any test failures caused by the implementation.\n\n$INPUT"

# Workflow step 8: AI source code review (after human confirms steps 6-7)
# This is the primary consumer of the SGL fork skill
local-review:
  description: "Parallel AI source code review via SGLang fork — step 8 in the workflow"
  steps:
    - agent: scout
      prompt: "Identify change scope and gather architecture context for review: $INPUT"
    - agent: sgl-fork-review
      prompt: "Run parallel persona reviews against the gathered context: $INPUT"
    - agent: synthesizer
      prompt: "Consolidate parallel review outputs into a structured findings report: $INPUT"
```

The human invokes `build-test` after plan approval (step 4–5). After human testing and structure review (steps 6–7), the human invokes `local-review` (step 8). The human then reads the findings report (step 9) and decides: loop to `build-test` with fix instructions, or proceed to Ship.

### 8.3 Phase 3: Ship

No chain needed. Step 10 is a human source code review (git diff, reading the files). Step 11 is a manual publish action. The AI's role in the Ship phase is zero unless the human finds issues and sends the work back to Build.

### 8.4 Chains to keep (unchanged)

- `investigate-fix` — bug fix flow; maps loosely to a Build re-entry after a rejection
- `audit` — comprehensive project audit; useful outside the normal feature workflow
- `sentry-setup`, `sentry-logs` — observability workflows; unchanged
- `performance` — performance audit; unchanged
- `secure` — AI security sweep; unchanged
- `network-security-local` — network inspection; unchanged

### 8.5 Chains to retire or rename

- `plan-build-review` — superseded by the 3-phase split. Retire or keep as a convenience alias that runs `plan` → `build-test` → `local-review` without human gates (useful for low-stakes tasks where human gates aren't needed).
- `plan-build` — superseded by the split. Retire or alias.
- `plan-review-plan` — absorbed into `plan-refine` above.
- `test-fix` — keep as a focused re-entry chain when the human wants AI to fix a specific test failure.
- `full-pipeline` — retire; replaced by the 3-phase workflow.

### 8.6 Revising `code-review`

The existing `code-review` chain (11 steps, warden-heavy) remains valuable for a thorough non-workflow code review (e.g., reviewing an external PR or unfamiliar codebase). Keep it but make two structural changes:

1. Extract step-specific instructions from the chain `prompt:` fields into the respective agent `.md` system prompts (for radix cache efficiency — see Section 5.2).
2. Collapse steps 6 (warden quality review) and 7 (knight security review) into a single `sgl-fork-review` step that runs both in parallel. The merged output feeds step 8 (paladin remediation). This reduces total step count from 11 to 9 and cuts wall time on the review step by ~40–50% (two concurrent SGLang streams sharing the code prefix).

The revised structure:

```
scout (arch)  →  ranger (DRY)  →  scout (deps)  →  scout (tests)
     ↓               ↓                ↓                ↓
                  warden (synthesis)
                         ↓
              sgl-fork-review [quality + security in parallel]
                         ↓
                    paladin (remediation)
                         ↓
                    warden (validation)
                         ↓
                    herald (test verification)
                         ↓
                    warden (final report)
```

---

## 9. File Change Summary

| File | Action | Description |
|---|---|---|
| `~/.pi/agent/models.json` | Modify | Add `berget` and `sglang` provider definitions |
| `~/.pi/agent/auth.json` | Modify | Add Berget API key entry |
| `agents/models.json` | Modify | Reassign agent roles to new providers per Section 4.2 |
| `agents/teams.yaml` | Modify | Remove toolkit team, team-b-builders; clean up `all` list |
| `agents/toolkit-models.json` | Remove | No longer needed |
| `agents/builder-*.md` (8 files) | Remove | Toolkit builder variants |
| `agents/copilot-agent.md` | Remove | Toolkit agent |
| `agents/sgl-reviewer.md` | New | Cache-optimized reviewer for fork steps |
| `agents/synthesizer.md` | New | Aggregates parallel review outputs |
| `skills/sgl-fork-review/` | New | Parallel forked review skill (Approach A or B) |
| `agents/agent-chain.yaml` | Modify | Add `plan`, `plan-refine`, `build-test`, `local-review`; revise `code-review`; retire `plan-build-review`, `full-pipeline` |
| `agents/pipeline-team.yaml` | Modify | Add 3-phase pipeline entries mirroring new chains |
| `agents/reviewer.md` | Modify | Restructure system prompt for radix cache efficiency |
| `agents/scout.md` | Modify | Same — stable prefix, variable task in user turn |
| `agents/builder.md` | Modify | Same |

---

## 10. Implementation Order

**Phase 1 — Provider wiring (blocking, do first)**

Register both providers in `~/.pi/agent/` config. Verify by running a single scout agent and confirming it routes to SGLang. Test Berget with a planner call. No agent-pi repo changes yet.

**Phase 2 — Agent cleanup**

Remove toolkit agents and `toolkit-models.json`. Update `teams.yaml`. Update `agents/models.json` with new model assignments. All existing chains continue to work; they now use different models.

**Phase 3 — Prompt restructuring**

Rewrite `reviewer.md`, `scout.md`, `builder.md`, and `warden.md` system prompts to put stable content first and task-specific content in the user turn. Verify that chain runs show cache hits in SGLang logs (`cached-token:` field in prefill log lines).

**Phase 4 — New agents**

Create `sgl-reviewer.md` and `synthesizer.md`. These can be minimal initially — the goal is to have named agents that the chain executor can reference before the forked skill exists.

**Phase 5 — SGL fork skill**

Implement `skills/sgl-fork-review/` (start with Approach A: parallel HTTP calls). Wire into a new `local-review` chain. Benchmark the wall time against the sequential `code-review` chain on the same diff.

**Phase 6 — Code-review chain revision**

Refactor the 11-step `code-review` chain to use the forked skill for the parallel quality/security steps. Preserve the full chain as `code-review-full` for completeness; make the faster forked version the default `code-review`.

---

## 11. Operations, Verification, Failure Modes

### 11.1 Verifying the architecture is working

Each phase of the rollout has an objective check:

| Phase | Check | Command / signal |
|---|---|---|
| Provider wiring | Berget call returns 200 | `curl -H "Authorization: Bearer $BERGET_KEY" https://api.berget.ai/v1/models` |
| Provider wiring | SGLang call returns 200 | `curl http://10.99.99.85:8003/v1/models` |
| Agent routing | Scout routes to SGLang | Run a scout-only chain, watch `docker logs sglang-qwen36 -f` for the request |
| Cache hits | Sequential agents hit the cache | `docker logs sglang-qwen36 2>&1 \| grep "cached-token"` — should show ≥80% reuse on second+ steps |
| Fork timing | 4-persona review completes in ~5s | `metadata.wall_time_seconds` in the skill output |
| XGrammar | Findings JSON always validates | Skill exit code 0 + downstream synthesizer never sees parse errors |
| Tool calling | No malformed tool calls | Grep agent transcripts for `<tool_call>` strings — should be zero with NEXTN |

### 11.2 Logging and observability

SGLang server logs are the source of truth for cache and decode performance. Per-request log lines include `Prefill batch ... cached-token: N input throughput (token/s): X` and `Decode batch ... gen throughput (token/s): Y accept rate: 0.NN`. The `agent-pi` extension layer should optionally tail and aggregate these into a per-chain-run report:

- Total wall time
- Total tokens generated
- Cache hit rate across all chain steps
- Mean accept rate (NEXTN speculative)
- Per-step prefill and decode contributions

This lives naturally in `extensions/lib/` as a new `sglang-metrics.ts`, surfaced in the existing completion-report viewer. Without it, performance regressions in agent prompts (someone edits a system prompt and breaks caching) are silent until the user notices a chain feels slow.

### 11.3 Failure modes and fallbacks

| Failure | Detection | Fallback |
|---|---|---|
| SGLang server down | Health probe to `/health` fails | Route SGLang-assigned agents to `default` (anthropic / claude-haiku) for the run; surface a warning to the human |
| Berget rate-limited (429) | OpenAI client returns 429 | Backoff + retry once; if still failing, route Berget-assigned agents to SGLang (high-concurrency mode) or to anthropic |
| SGLang in speculative mode but chain wants 4 forks | Skill probes `--max-running-requests` | Skill auto-batches in pairs of 2 (two prefill+decode rounds, ~9s instead of ~5s) and notes this in `metadata` |
| KV pool exhaustion (long context > 200K) | SGLang returns `Input length exceeds maximum allowed` | Route that specific call to Berget (Gemma 4 31B at 256K) instead |
| Prefix cache miss when expected to hit | `cached-token: 0` on a request that should be cached | Likely cause: agent prompt was edited. Surface as a warning in the per-run metrics; the architecture still works, just slower |

The fallback policy should be encoded in `agents/models.json` as an optional `fallback` field per agent:

```json
"reviewer": {
  "provider": "sglang",
  "model": "RedHatAI/Qwen3.6-35B-A3B-NVFP4",
  "fallback": {"provider": "anthropic", "model": "claude-haiku-4-5"}
}
```

### 11.4 Token budget tracking

The user goal is "as much tokens per second as possible." This is well-defined for SGLang (the server's `gen throughput (token/s)` field), but at the chain level the relevant number is **end-to-end completion tokens per wall-clock second**. The metrics layer in 11.2 should compute this per chain run so changes can be evaluated against a baseline:

- Baseline: current `code-review` chain on a fixed test diff = X tok/s effective
- After Phase 5 (fork skill): same diff = Y tok/s effective
- Target: Y / X ≥ 3x

If the ratio is below target, suspect one of: cache-busting prompt edits, fork batching due to slot limits, or speculative mode rejection breaking acceptance rate.

### 11.5 Migration: running new and old chains in parallel

During Phases 3–6, both the legacy `code-review` and the new `local-review` should be runnable side-by-side so the human can A/B them on real diffs. Concretely:

- Do not delete `code-review` — only revise it (Section 8.6).
- `local-review` is a new chain entry, not a replacement.
- Default chain for the workflow is the new one; the legacy one is invoked explicitly (`/agent-chain code-review-full`).
- Once the new chain has run on ~10 real diffs and produced equivalent or better findings, retire the legacy chain.

---

## 12. Open Questions

1. **Pi provider config format** — the exact JSON structure for registering a custom OpenAI-compatible provider in `~/.pi/agent/models.json` needs to be confirmed against the live Berget integration docs (the reference at `https://docs.berget.ai/integrations/pi` shows the auth format but not the full provider schema). Verify before editing.

2. **Chain executor skill step support** — the current `agent-chain.yaml` executor (in `extensions/agent-chain.ts`) dispatches steps to agent `.md` files. Does it support invoking a skill (bash script) as a step? If not, the `sgl-fork-review` step must be wrapped in a thin agent that calls the skill via bash.

3. **Radix cache key stability** — SGLang matches prefixes byte-for-byte at the token level. Any change to the system prompt breaks the cache for all subsequent requests in that session. This means model version changes (e.g., upgrading agent `.md` files) should be treated as cache-busting events; plan chain runs accordingly.

4. **Berget context limits vs local** — Berget's Gemma 4 31B has a 256K context limit matching the local SGLang server, but the local server's KV pool is sized to ~266K tokens total (shared across all concurrent slots). A single 200K-token context in speculative mode (2 slots) would consume most of the pool. For very long-context chains, route to Berget instead of SGLang to avoid pool exhaustion.

5. **Thinking mode** — Qwen3.6 supports thinking via `chat_template_kwargs: {enable_thinking: true}`. This produces `reasoning_content` in the response. No current agent in agent-pi reads `reasoning_content`. If thinking is desired for planner or reviewer, the agent invocation layer needs to either expose this content or collapse it into the main content. Determine whether to enable thinking per-agent before Phase 3.

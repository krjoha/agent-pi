# Workflow cheat sheet

A one-page reference for driving the Plan / Build / Ship workflow inside Pi. For the full rationale and architecture, see [`workflow-architecture.md`](./workflow-architecture.md).

## Mental model

```
PLAN  →  (human approves)  →  BUILD  →  (human approves)  →  SHIP
```

Three phases, two human approval gates. **Each phase is one chain invocation.** A chain terminates at the gate — the human reads the output, then invokes the next chain manually. The chain executor never advances a phase on its own.

## Commands by phase

### Plan
1. `/chain` → select `plan` (single-pass) or `plan-refine` (plan → critique → revise).
2. Type the task as your next message. The agent calls `run_chain`, the chain produces a structured plan.
3. Read it. If it needs revisions, re-invoke with the rejection reason as the new input. Once approved, move on.

### Build
1. `/chain` → select `build-test` (implement → test → herald-verify → health-gate).
2. Send the approved plan as input.
3. Read the output. If `HEALTH_GATE: FAIL`, the chain stopped before the human-review step because at least one file is below the 9.9 Code Health threshold — see "Code Health gate" below.
4. If tests pass and `HEALTH_GATE: PASS`, do your manual review (steps 6–7 in the workflow doc).

### AI review (before human review)
1. `/chain` → select `local-review` (parallel persona review via SGLang fork, fast) or `code-review` (the full 10-step pass with scout/ranger/warden/paladin, deeper).
2. Send the change scope or just the word "diff" if you want it to look at unstaged changes.
3. Read the findings report. Loop back to `build-test` with fix instructions if needed.

### Ship
No chain. Manually: read the diff, run any final checks, commit, push.

## Shortcut chains (select-and-run in one shot)

These are slash commands that both pick the chain **and** kick it off — no separate task message needed:

| Command | What it runs |
|---|---|
| `/audit` | Full project audit (Discovery → Deep Scan → Findings → Hardening Plan) |
| `/code-review` | The 10-step `code-review` chain |
| `/performance` | Performance audit (Discovery → Deep Scan → Stress → Findings → Plan) |
| `/sentry-setup` | Verify Sentry CLI / SDK setup |
| `/sentry-logs` | Fetch Sentry issues, root-cause, fix plan |

## How `/chain` works (gotcha)

`/chain` only **selects** the active chain. It does **not** start it. After selecting, the notification says: *"Type a task to start, or `/chain-list` to switch."* The chain runs only once you send a normal message — the main agent then calls `run_chain` under the hood.

Two other commands:

- `/chain-list` — show every chain with its step flow.
- `/chain-clear` — hide the chain widget (chain remains active; this only removes the visual).

## Keyboard

- `shift+tab` — cycles **thinking levels** (off / low / medium / high). It does **not** switch chains.
- There is no keybinding for chain switching; use the `/chain` slash command.
- `Ctrl+P` — model picker (selecting a Berget or SGLang model).

## Code Health gate

Every review-style chain (`build-test`, `local-review`, `code-review`, `investigate-fix`, `test-fix`) ends with a `health-gate` step. The gate calls CodeScene against every changed file and refuses to hand the chain back to the human until each file scores **≥ 9.9**.

The gate's last line of output is one of:

- `HEALTH_GATE: PASS` — every changed code file is ≥ 9.9 (or SKIP for non-code files like markdown/YAML). The chain advances to the next step or hands off to the human.
- `HEALTH_GATE: FAIL` — at least one file is below 9.9. The gate's table names the files and the top findings (Large Method, Deep Nested Complexity, etc.).

On `FAIL`: re-invoke `build-test` (or the bug-fix chain) with the failing-file list as your new task. The remediation agent (`paladin`) and the builder will pull the score back up. Then re-run the original review chain.

Threshold override: pass `HEALTH_THRESHOLD=9.5` (or any value in `[8.0, 10.0]`) as part of your task input if you need to dial it down for legacy areas. Values below `8.0` are refused — at that point the gate doesn't add value.

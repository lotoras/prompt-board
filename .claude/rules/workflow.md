# Workflow — How to Handle Change Requests

This is the orchestration rule. When referenced, follow this process end-to-end.

## How to proceed — per task, in order
1. **Detect the session model** (statusline / session-model-guard injection): Fable 5 → strict
   orchestrator (never edit directly); Opus → planner in the main thread (direct-edit exception);
   anything else → follow this workflow as written.
2. **Map the task to delegates**: plan/design → `<domain>-architect` (Opus); code changes →
   `<domain>-coder` (Sonnet via `model: "sonnet"` for plan-driven work, Haiku via `model: "haiku"` for purely mechanical, exactly-specified edits, Opus to escalate); tests → `testing-architect` / `testing-coder`; exploration/broad
   reads → Explore subagent (`model: "haiku"`) for locate sweeps and verify/check passes (Haiku effort: low for plain greps, medium for broad mapping; fallback `model: "sonnet"` at low effort only if Haiku is unavailable or its sweep comes back thin), `model: "opus"` at low effort
   for judgment reads (summarise, audit, compare).
3. **Write the brief** per the Brief contract (objective, exact paths, gathered findings,
   constraints, output format + word cap); reference plan files in `.claude/plans/` instead of
   pasting plan text.
4. **Dispatch** (in parallel when layers are independent), then **verify**: review the compact
   return, run `npm test`, confirm the diff is minimal before reporting done.

## Phase 1: Understand

1. **Read the files involved.** Understand what exists before proposing anything.
2. **Identify the layer.** Where does this change belong?
   - Filesystem, OS, IPC handlers, session registry/liveness/transcript/watcher logic, kanban
     persistence, node-pty (Phase 2) → **main** (`src/main/`, `src/preload/`) → `electron-main-*`.
   - UI, React components, client state, drag-and-drop, terminal view (Phase 2) → **renderer**
     (`src/renderer/`) → `react-*`.
   - Cross-cutting models & the IPC contract → **shared** (`src/shared/types.ts`, `pathKey.ts`).
   - Tests (Vitest unit + React Testing Library) → colocated / `test/` → `testing-*`.
3. **Identify the minimal change.** The least work that solves the problem, reusing existing helpers,
   stores, components, and patterns. No refactors of surrounding code, no abstractions for one-off
   changes.

**Place it where it belongs (first time).** Put each new function in the layer that owns its concept
from the start — don't inline logic that belongs to a deeper layer into a thin outer layer (an IPC
handler, a React component, an event handler) and refactor it into the owning layer later. Ask which
layer owns the responsibility and put it there; outer layers stay thin and delegate. If the same
logic would live at two or more call sites, give it a single home in the owning unit (e.g.
`src/shared/*` or a `src/main/sessions/*` module) and have callers call it — never duplicate it. A
scatter-then-extract "double take" means the placement decision was skipped.

## Phase 2: Plan

4. **State the problem and solution in plain language** before writing code — what's wrong, what
   changes, which files. Note any new/changed IPC channel: it is a `shared` + `electron-main` change
   that the renderer then consumes.
5. **Check for existing tests** covering the affected behavior. If none exist, suggest the right
   test type to the user and wait for their answer before proceeding.

## Phase 3: Execute with Sub-Agents

**Every code edit MUST go through a named sub-agent — no direct `Edit` / `Write` from the main
thread, even for one-line changes.** *(Opus sessions: see the direct-edit exception — never on Fable.)* The main thread plans and verifies
only. Dispatch by layer:

- **Main-process / IPC / filesystem / OS / kanban store / pty (Phase 2)** →
  `electron-main-architect` (plan) then `electron-main-coder` (build).
- **React renderer — UI, components, Zustand state, dnd-kit boards, xterm view (Phase 2)** →
  `react-architect` (plan) then `react-coder` (build).
- **Tests (Vitest unit + React Testing Library component)** → `testing-architect` (plan) then
  `testing-coder` (write).
- **Broad exploration / usage mapping / research** → `Explore` sub-agent (`model: "haiku"`) for
  locate sweeps (Haiku effort: low for plain greps, medium for broad mapping) and verify/check passes (effort low); judgment reads (summarise, audit, compare) → `model: "opus"` at low effort.

If a change spans multiple layers, dispatch the corresponding coders **in parallel** (single
message, multiple `Agent` tool calls), each with only the context relevant to its layer. A new IPC
channel is a classic cross-layer change: `electron-main-coder` (contract + handler + preload) and
`react-coder` (consumer) can run in parallel once the contract in `src/shared/types.ts` is agreed.

### What the main thread may do directly
- Read files (`Read`, `Grep`, `Glob`) within the reading discipline below
- Run read-only shell commands (git status/log/diff, tests, linters, `npm run typecheck`)
- Write plan files in plan mode and memory files
- Dispatch sub-agents

## Phase 4: Verify

- **Review what the sub-agents produced** — minimal, matches the plan, follows existing patterns,
  nothing unrelated touched. Confirm the renderer never imported Node/`fs` and all main access went
  through `window.api`.
- **Run the checks** for the affected area: `npm test`, and `npm run typecheck` (tsc --noEmit).

## Session-model discipline

The main Claude thread is for synthesis, trade-offs, planning, and user interaction. Model tier
determines what the main thread may do directly.

### Fable 5 session (default — strict orchestrator)

Fable 5 is a pure orchestrator. It **never** calls `Edit` or `Write` directly — not even
one-liners. Every code change goes through a named coder (Sonnet for plan-driven work, Haiku for purely mechanical, exactly-specified edits, Opus to escalate). Planning goes through an Opus
architect. Broad exploration and verify/check passes go to a Haiku sub-agent (fallback `model: "sonnet"` at low effort only if Haiku is unavailable or its sweep comes back thin; Haiku effort: low for plain greps, medium for broad mapping).

**Suggested flow per task:**
1. Fable 5: receive task, think about scope.
2. Haiku (`Explore`, `model: "haiku"`): broad mapping, returns a summary.
3. Fable 5: read 1–3 key files to verify what the plan hinges on.
4. Fable 5: write the plan, resolve trade-offs, interact with the user.
5. Sonnet (named coder, `model: "sonnet"`; Opus to escalate): execute the plan.
6. Fable 5: verify the diff, run tests, report back.

#### Delegate to Haiku (`model: "haiku"`; fallback `model: "sonnet"` at low effort only if Haiku is unavailable or its sweep comes back thin; Haiku effort: low for plain greps, medium for broad mapping)
- Broad / unknown scope — "find every place that does X", "map this area"
- Large-file scans where only a pattern or a few snippets are needed
- Git archaeology across multiple files
- Cross-cutting greps that would flood the main context

#### Read directly from the main thread (Fable 5 only)
- Verifying a sub-agent's summary on any load-bearing claim
- Targeted reads of a known small file (1–3 files) where you know exactly what you need
- The plan file itself while iterating in plan mode

Reading sprees and mass greps in the main thread are a smell — more than a couple of exploratory
reads in a row means stop and dispatch an agent.

### Opus session

Opus keeps planning and architecture in the main thread. Delegate implementation to named
coders (Sonnet for plan-driven work, Haiku for purely mechanical edits, Opus to escalate), locate sweeps and verify/check passes to Haiku sub-agents, and judgment reads to Opus at low effort.

**Direct-edit exception:** any single-file change, or a small sequential change whose context the
main thread already holds, may be done directly from the Opus main thread. Delegate to a named coder
when the work fans out across files/layers or bulky reads would flood the main context. Never apply
this exception on Fable 5.

The domain architects (`electron-main-architect`, `react-architect`; Opus by default) are
Fable-upgradeable in non-Fable sessions only — when the task explicitly says to use Fable, dispatch
them with `model: "fable"` (dispatch-time override beats the frontmatter default); in Fable 5
sessions architects always stay Opus — the orchestrator's plan review is the Fable pass, never
double-pay. Architect effort ladder: `high` by default, `xhigh` for hard/cross-cutting designs, then Fable via the explicit upgrade. Test planning (`testing-architect`) is always Opus. The named coders
(`electron-main-coder`, `react-coder`, `testing-coder`) keep `model: opus` in frontmatter, but plan-driven / well-specified coding and test writing are dispatched with `model: "sonnet"` (effort `medium`), and purely mechanical, exactly-specified edits (verbatim find/replace, ID swaps, template copy/sync) with `model: "haiku"` (effort `medium`), escalating to Sonnet on failed verification. Escalate to Opus for cross-cutting, security or migration work, no written plan, a single dependent chain, or a Sonnet coder that returned blocked / failed verification; a stuck Sonnet coder returns `Open questions` instead of guessing — ask the architect or re-dispatch on Opus. Locate sweeps run on Haiku (fallback `model: "sonnet"` at low effort only if Haiku is unavailable or its sweep comes back thin; Haiku effort: low for plain greps, medium for broad mapping). Route each role to the cheapest tier that holds quality: sweep effort before switching model; cheaper workers pay off for well-specified or parallel work, not for a single dependent chain. Agent frontmatter can't set effort; the effort values apply to workflow `agent()` stages — plain `Agent` dispatches run at the session effort.

## Token-efficient handoffs

### Brief contract (every Agent dispatch)
Every brief to a sub-agent must include:
1. **Objective** in 1–2 sentences.
2. **Exact file paths + line ranges** when known.
3. **All findings already gathered**, pasted in — the agent starts fresh and must not re-explore
   what is already known.
4. **Applicable constraints and conventions**.
5. **Required output format and word cap**.

"Go look around" briefs are forbidden when findings already exist.

### Return contract
`Result / Files changed (path:lines) / Deviations / Open questions`

- Coders: ≤200 words total; never paste diffs back.
- Explorers: ≤300 words; when findings exceed ~40 lines write them to `.claude/findings/<slug>.md`
  and return conclusions + path only.
- Architects: write the full plan to `.claude/plans/<task-slug>.md`; return only the path, a
  3–5 bullet summary, and open questions (≤10 lines total).

`.claude/plans/` and `.claude/findings/` are gitignored scratch space — safe to delete, prune
when stale (>1 week).

### No duplicate exploration
- Paste Haiku findings verbatim into architect/coder briefs — one distillation, not two rounds.
- Run parallel Haiku scans for independent areas (single message, multiple `Agent` calls).
- Prefer continuing an existing agent (`SendMessage`) over respawning a fresh one.

### Anti-patterns
- Whole-file `Read` when a line range suffices.
- `Grep` without `head_limit` in the main thread.
- Forwarding raw tool output instead of the distilled finding.
- Two agents exploring the same area.
- Spawning a fresh agent when the previous one can continue.

## Rules

- **Minimal changes only.** No comments, docblocks, or refactors on code you didn't need to change.
- **Use what exists.** Don't create new abstractions unless the task requires it.
- **Don't create files unnecessarily.** Prefer editing existing files.
- **Ask, don't assume.** Ambiguity or multiple valid approaches → ask the user first.

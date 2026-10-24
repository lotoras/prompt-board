# Workflow — how to handle change requests

Work in one main loop: read, plan, edit, run the checks and verify yourself, loading skills and
tools on demand. Spawn agents only for a context reason (step 4), never to split by role.

1. **Understand** — read the files involved and find the layer that owns the change:
   - **main** (`src/main/`, `src/preload/`) — filesystem, OS, IPC handlers, session
     registry/liveness/transcript/watcher logic, kanban persistence, node-pty (Phase 2) →
     `electron-main-*`.
   - **renderer** (`src/renderer/`) — UI, React components, client state, drag-and-drop, terminal
     view (Phase 2) → `react-*`.
   - **shared** (`src/shared/types.ts`, `pathKey.ts`) — cross-cutting models and the IPC contract.
   - **tests** (Vitest unit + React Testing Library, colocated / `test/`) → `testing-*`.

   Put new logic in the layer that owns it from the start; outer layers stay thin and delegate.
   Logic needed at two or more call sites gets one home in the owning unit.
2. **Plan** — for multi-step work, write `.claude/plans/<slug>.md` with acceptance criteria and
   revise it as results come in. Minimal change, existing helpers and patterns, no unrelated
   refactors, no new files or abstractions the task doesn't need. Ambiguity or several valid
   approaches → ask the user.
3. **Tests** — check for existing tests covering the behavior; if none exist, suggest the right
   test type and ask. Planned multi-file work → `testing-coder` writes the red tests from the plan
   first (black-box; Codex writes them only when the user says "use codex"). Small changes → write
   the test yourself.
4. **Build** — in the main loop. Spawn only for:
   - **bulky reads** whose raw output you don't need (unknown-scope sweeps, big logs, git
     archaeology) → Haiku `Explore`, ≤300-word return; known files you read yourself;
   - **independent parallel work** that benefits from fresh contexts (multi-concern review,
     research sweep, many-file mechanical edits, independent layers) → a Workflow; every `agent()`
     sets `agentType` or `model` — `electron-main-coder` / `react-coder` / `testing-coder` with
     `model: "sonnet"` for well-specified code, `model: "haiku"` for verbatim edits; Opus for
     judgment;
   - **black-box verification** → `testing-coder` red tests or a Codex review.

   The architects (`electron-main-architect`, `react-architect`, `testing-architect`) are
   on-demand: use one only when the user asks for a separate design pass.
5. **Verify** — run `npm test` and `npm run typecheck` (tsc --noEmit) yourself and read the diff
   before reporting done. Simplify and Review are offered by the global threebrain Stop hook, not
   here.

## Spawned agents
Briefs are self-contained: objective, exact paths + line ranges, findings already gathered,
constraints, output format + word cap. Returns: `Result / Files changed (path:lines) / Deviations /
Open questions`, ≤200 words (explorers ≤300). Plans and large findings travel as files
(`.claude/plans/`, `.claude/findings/` — gitignored scratch). Prefer continuing an agent
(`SendMessage`) over respawning. Waiting on background work: end the turn; never spawn a
placeholder agent.

## Project specifics
- **IPC channels.** A new or changed IPC channel is a `shared` + `electron-main` change that the
  renderer then consumes: agree the contract in `src/shared/types.ts` first; then main (contract +
  handler + preload) and renderer (consumer) can proceed in parallel.
- **Shared-logic homes.** When logic would live at two or more call sites, give it a single home
  (e.g. `src/shared/*` or a `src/main/sessions/*` module) — never inline it into an IPC handler,
  React component or event handler and extract it later.
- **Process boundary check (verify).** Confirm the renderer never imported Node/`fs` and all main
  access went through `window.api`.
- **Red tests.** When red tests exist, the implementation's goal is to make them pass; never edit
  those tests — if one looks wrong, flag it and decide with the user.
- **Plan acceptance criteria.** Plans for planned work carry acceptance criteria; the red tests
  are derived from them.
- **Escalation.** After 2 failed fix rounds, stop retrying: use an Opus coder, or hand off to
  `/codex:rescue` when the user asked for Codex.
- **Codex tests.** When the user says "use codex", dispatch `codex:codex-rescue`
  (`--model gpt-6.1-sol --effort medium`; `--effort high` for auth/billing/migrations/concurrency/
  money-date math/complex parsing) to write the failing tests; fall back to `testing-coder` if
  Codex is unavailable or out of quota.
- **Threebrain Stop hook.** Review auto-switches to adversarial when `src/auth/**`,
  `**/migrations/**` or `**/billing/**` are touched; explicit review phrases ("review this",
  "tear this apart", "rescue") still fire on their own; the Codex stop-review gate stays disabled.

# prompt-board

A personal **command-center desktop app** for Claude Code work: one window showing all your Claude
CLI sessions **grouped by project** with live status, plus a **manual kanban** board per project and
one global overview board. Phase 2 adds embedded interactive terminals you launch and type into.

> Greenfield — not yet scaffolded. A refined implementation plan will follow; do not start building
> app code until then. The approved design lives at
> `~/.claude/plans/maybe-to-describe-what-greedy-crown.md`.

## Stack
- **Electron + React + TypeScript**, scaffolded with **electron-vite**, packaged with electron-builder.
- Renderer state via **Zustand**; kanban drag-and-drop via **dnd-kit**.
- Phase 2 terminals: **xterm.js** (renderer) + **node-pty** (main; needs `@electron/rebuild`).
- Tests: **Vitest** (+ `@testing-library/react` for components).

## Architecture (three surfaces, strict boundaries)
- **main** (`src/main/`) — Node/Electron. ALL filesystem / OS access lives here: session-registry &
  transcript readers, chokidar watchers, PID-liveness, the kanban store, the Phase-2 pty manager.
- **preload** (`src/preload/index.ts`) — exposes a typed `window.api` via `contextBridge`
  (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`).
- **renderer** (`src/renderer/`) — pure React; reaches main only through `window.api`. No Node, no `fs`.
- **shared** (`src/shared/`) — `types.ts` (models + IPC contract — the single source of truth),
  `pathKey.ts` (normalize real `cwd` → stable `projectKey`).

## Data substrate (read-only source of truth — always group by the REAL `cwd`)
- **Live registry** `~/.claude/sessions/<pid>.json`: pid, sessionId, cwd, status
  (busy|idle|waiting), waitingFor, startedAt/updatedAt/statusUpdatedAt (epoch ms), procStart.
  Verify liveness (`process.kill(pid,0)` + start-time/`procStart` check to defeat PID reuse);
  files can be stale after an unclean exit.
- **Transcripts** `~/.claude/projects/<enc-cwd>/<sessionId>.jsonl`: one JSON object per line;
  assistant lines carry `message.model` and nested `message.usage`; an `ai-title` line carries the
  human title in `aiTitle`. Never read whole — tail by byte offset (retain latest title + running
  token sum). The encoded directory name is lossy — use the `cwd` field, normalized via `pathKey`.
- **Prompt history** `~/.claude/history.jsonl`: per-project `{display, timestamp, project, sessionId}`
  (Phase-1 optional).

## Repo layout (target)
```
src/main/{index,ipc}.ts
src/main/sessions/{registry,liveness,transcript,watcher}.ts
src/main/kanban/store.ts
src/main/pty/manager.ts            # Phase 2
src/preload/index.ts               # window.api bridge
src/renderer/{main.tsx,App.tsx}
src/renderer/features/{sessions,kanban,terminal}/   # terminal/* = Phase 2
src/renderer/store/                # Zustand
src/shared/{types.ts,pathKey.ts}
```

## Phasing
- **Phase 1 (no native deps):** project-grouped session board (live status, model, token totals,
  last-activity, `aiTitle`) + manual kanban (per-project + global) with atomic-write persistence.
- **Phase 2:** embedded interactive terminals (node-pty + xterm) that spawn `clauded`, reconciled
  with the registry by cwd+pid. Externally-started sessions stay read-only status cards.

## Kanban model
Cards are global entities carrying a `projectKey`; a project board filters by its `projectKey`, the
global board (`projectKey: "__global__"`) aggregates across projects over a shared column set.
Reorder writes a fractional-index `order` (no mass renumber). Persist to
`app.getPath('userData')/boards.json` via atomic temp-file → rename.

## Workflow

**For any change request, follow `.claude/rules/workflow.md`** — understand the code first, plan
the minimal change, delegate to sub-agents, then verify.

**All code edits MUST go through sub-agents — no direct `Edit` / `Write` from the main thread, even
for one-line changes.** The main Claude plans and verifies only. Dispatch by layer:
- **Main-process / IPC / filesystem / OS / kanban store / pty (Phase 2)** →
  `electron-main-architect` (plan) then `electron-main-coder` (build).
- **React renderer — UI, components, Zustand state, dnd-kit boards, xterm view (Phase 2)** →
  `react-architect` (plan) then `react-coder` (build).
- **Tests (Vitest unit + React Testing Library component)** → `testing-architect` (plan) then
  `testing-coder` (write).
- **Broad exploration / usage mapping / research** → `Explore` sub-agent (`model: "haiku"`).

**Model policy:** domain architects run on **Opus** by default and are **Fable-upgradeable** in
non-Fable sessions only — when the task explicitly says to use Fable (e.g. via cc-enhance "use
fable") and the session is NOT on Fable 5, dispatch them with `model: "fable"` (dispatch-time
override beats the frontmatter default); in Fable 5 sessions architects always stay Opus — the
orchestrator's plan review is the Fable pass, never double-pay. Test planning (`testing-architect`) is
always **Opus**; all coders execute on **Sonnet**; exploration is always **Haiku** (`Explore` /
`general-purpose` with `model: "haiku"`). **Fable 5 sessions** are strict orchestrators — no direct
`Edit`/`Write`, ever. **Opus sessions** plan in the main thread; the micro-edit exception (one file,
a few lines, location known) applies only to Opus, never Fable. The after-task simplify/review pass
is handled by the global threebrain Stop hook — its routing lives there, not here.

Multi-layer changes dispatch multiple coders **in parallel** (single message, multiple `Agent` tool
calls). See `.claude/rules/workflow.md` → "Session-model discipline" for the full reading rule.
Briefs are self-contained and returns compact — see `.claude/rules/workflow.md` → Token-efficient
handoffs.

Plans and large findings travel as files (`.claude/plans/`, `.claude/findings/`), not inline text.
Per task: detect session model → map delegates → brief per contract → dispatch → verify. Full
procedure: `.claude/rules/workflow.md` → How to proceed.

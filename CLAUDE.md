# prompt-board

A personal **command-center desktop app** for Claude Code work: one window showing all your Claude
CLI sessions **grouped by project** with live status, plus a **manual kanban** board per project and
one global overview board. Phase 2 adds embedded interactive terminals you launch and type into.

> Greenfield — not yet scaffolded. A refined implementation plan will follow; do not start building
> app code until then. The approved design lives at
> `~/.claude/plans/maybe-to-describe-what-greedy-crown.md`.

## "My tasks" = cards on the board (NOT app-development work)
"What tasks should I do next?" / "what should I work on?" means the user's **kanban cards**, not
improvements to this app (suggest app work only if asked about the tool itself). Answer from the
board data, read-only:
- `%APPDATA%\prompt-board\boards.json` — cards (each with a `projectKey`) + per-board columns
  (e.g. Todo / Start coding / Doing / Done); the global board is `projectKey: "__global__"`.
- `%APPDATA%\prompt-board\projects.json` — project names + `basePath`s.
List open cards (not Done) grouped by project and suggest an order.

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

**For any change request, follow `.claude/rules/workflow.md`.** Work in one main loop — read, plan
(`.claude/plans/<slug>.md` for multi-step work), edit, run the checks and verify yourself. Spawn
only for a context reason: bulky reads (Haiku `Explore`), independent parallel work (a Workflow;
every `agent()` sets `agentType` or `model`), or black-box verification (`testing-coder` red tests
from the plan for planned multi-file work; Codex only when the user says "use codex").

Agents in `.claude/agents/`:
- `electron-main-architect` / `electron-main-coder` — main process, IPC, filesystem/OS, kanban store, preload bridge, pty (Phase 2).
- `react-architect` / `react-coder` — React renderer: components, Zustand state, dnd-kit boards, xterm view (Phase 2).
- `testing-architect` / `testing-coder` — Vitest unit + React Testing Library tests.

The architects are on-demand (a separate design pass when asked); the coders are for parallel
fan-out, not sequential work. Verify with `npm test` and `npm run typecheck`.

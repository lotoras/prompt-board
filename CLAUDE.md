# prompt-board

A personal **command-center desktop app** for Claude Code work: one window showing all your Claude
CLI sessions **grouped by project** with live status, plus a **manual kanban** board per project and
one global overview board. Chats are T3-style: projects on the left, the project's chats as tabs
on top, a rendered chat driven by the **Claude Agent SDK**, and a composer with model / effort /
Codex / Ultra / worktree / branch controls. The visual contract is `design/preview.html`.

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
- Chats: **@anthropic-ai/claude-agent-sdk** in main (ESM-only → loaded with a real dynamic
  `import()`; uses the user's `claude.exe`, preset `claude_code`, all setting sources, bypass
  permissions; `AskUserQuestion` / `ExitPlanMode` arrive at `canUseTool` → native cards).
- Terminal drawer: **xterm.js** (renderer) + **node-pty** (main; N-API prebuilds, no rebuild needed).
- UI: **react-markdown** + remark-gfm, **lucide-react**, Inter (bundled), **diff** for edit diffs.
- Tests: **Vitest** (+ `@testing-library/react` for components).

## Architecture (three surfaces, strict boundaries)
- **main** (`src/main/`) — Node/Electron. ALL filesystem / OS access lives here: session-registry &
  transcript readers, chokidar watchers, PID-liveness, the kanban store, the chat service
  (`src/main/chat/*`: SDK runner, transcript parser, chat store, attachments), git worktrees
  (`src/main/git/git.ts`) and the pty manager (terminal drawer, Open in TUI).
- **preload** (`src/preload/index.ts`) — exposes a typed `window.api` via `contextBridge`
  (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`).
- **renderer** (`src/renderer/`) — pure React; reaches main only through `window.api`. No Node, no `fs`.
- **shared** (`src/shared/`) — `types.ts` (models + IPC contract — the single source of truth),
  `pathKey.ts` (normalize real `cwd` → stable `projectKey`), `chat.ts` (composePrompt /
  parseDirectives, context window, model labels, slugs).

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

## Repo layout
```
src/main/{index,ipc}.ts
src/main/chat/{service,runner,transcriptParser,store,attachments,diff,defaults}.ts
src/main/git/git.ts
src/main/sessions/{registry,liveness,transcript,watcher,merge,snapshot,acks}.ts
src/main/kanban/store.ts
src/main/pty/{manager,reconcile,persistence,queryInjector}.ts
src/preload/index.ts               # window.api bridge
src/renderer/src/{main.tsx,App.tsx,Shell.tsx}
src/renderer/src/features/{chat,kanban,projects,sync,terminal}/
src/renderer/src/store/            # Zustand (chatsSlice, boards, projects, sessions, ui, sync)
src/shared/{types.ts,chat.ts,pathKey.ts}
design/preview.html                # signed-off visual contract
```

## Chats
- Own chats persist in `userData/chats.json` (one-time migration from `terminals.json`); a new chat
  gets a pre-assigned `sessionId`, so the card link and transcript are known before the first send.
- The transcript is the source of truth for history; the live SDK stream only adds an overlay.
- Live sessions started elsewhere show as read-only tabs (`ext:<sessionId>`), live-tailed.
- Claude 1 / Claude 2: `account` on a chat picks the config dir (`~/.claude` or `~/.claude-2`) through `withAccountEnv` in `src/main/accounts.ts`. Choose it on a draft; it is fixed after the first send.
- New-chat workspace toggles run `git worktree add` under `<repo>/.claude/worktrees/<slug>`
  (ignored via `.git/info/exclude`) and/or `git switch -c` before the first send.
- Ultra = `applyFlagSettings({ultracode})` + `ultrathink`; every effort change resends `ultracode`.

## Dev
- `npm run dev:isolated` runs the app with its own data profile (`PROMPT_BOARD_PROFILE`,
  `%APPDATA%prompt-board-<profile>`, seeded from the real boards/projects, sync off) next to the
  everyday app; `npm run smoke:isolated` checks it over CDP 9223 (`--screenshot <png> --width`).
- electron-vite dev hot-reloads only the renderer; restart the app after main-process changes.

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

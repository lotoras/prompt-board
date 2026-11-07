/**
 * Single source of truth for cross-process models and the typed IPC contract.
 * Main implements the `ipcMain.handle`/`webContents.send` side per these
 * channels; preload exposes `window.api` matching the `Api` interface below;
 * renderer only ever talks to main through `window.api`.
 *
 * All payloads must stay JSON-serializable (no functions, class instances,
 * or absolute-path leakage the renderer shouldn't see).
 */

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SessionStatus = 'busy' | 'idle' | 'waiting'

export interface SessionInfo {
  pid: number
  sessionId: string
  cwd: string
  status: SessionStatus
  waitingFor?: string
  startedAt: number
  updatedAt: number
  statusUpdatedAt: number
  procStart?: number
  name?: string
  aiTitle?: string
  model?: string
  totalTokens?: number
  acknowledged?: boolean
}

export function canAcknowledge(status: SessionStatus): boolean {
  return status === 'waiting' || status === 'idle'
}

type AckState = Pick<SessionInfo, 'status' | 'acknowledged'>

export function sessionNeedsAttention(s: AckState): boolean {
  return canAcknowledge(s.status) && !s.acknowledged
}

export function statusTone(s: AckState): SessionStatus | 'attention' {
  return sessionNeedsAttention(s) ? 'attention' : s.acknowledged ? 'idle' : s.status
}

export type ProjectSource = 'manual' | 'auto' | 'both'

export interface ProjectView {
  projectKey: string
  name: string
  basePath?: string
  source: ProjectSource
  needsAttention: boolean
  sessions: SessionInfo[]
}

export interface SessionsSnapshot {
  projects: ProjectView[]
}

// ---------------------------------------------------------------------------
// Projects (manual, CRUD)
// ---------------------------------------------------------------------------

export interface Project {
  projectKey: string
  name: string
  basePath: string
  createdAt: number
  updatedAt: number
}

export interface ProjectInput {
  name: string
  basePath: string
}

// ---------------------------------------------------------------------------
// Kanban
// ---------------------------------------------------------------------------

export const GLOBAL_BOARD_PROJECT_KEY = '__global__'
export const FOR_LATER_COLUMN_ID = 'for-later'
export const DONE_COLUMN_ID = 'done'

export interface KanbanColumn {
  id: string
  title: string
  order: number
}

export interface Board {
  projectKey: string
  columns: KanbanColumn[]
}

export interface CardLink {
  sessionId: string
  cwd: string
}

export interface KanbanCard {
  id: string
  projectKey: string
  columnId: string
  title: string
  body: string
  tags: string[]
  order: string
  link?: CardLink
  /** Local calendar date, 'YYYY-MM-DD'. Absent = no due date. */
  dueDate?: string
  createdAt: number
  updatedAt: number
}

export interface KanbanState {
  boards: Board[]
  cards: KanbanCard[]
}

export type KanbanCardPatch = Partial<
  Omit<KanbanCard, 'id' | 'createdAt' | 'updatedAt' | 'dueDate'>
> & { dueDate?: string | null }

export type KanbanMutation =
  | { type: 'createCard'; card: Omit<KanbanCard, 'id' | 'createdAt' | 'updatedAt'> }
  | {
      type: 'updateCard'
      id: string
      patch: KanbanCardPatch
    }
  | { type: 'moveCard'; id: string; columnId: string; order: string }
  | { type: 'deleteCard'; id: string }
  | { type: 'upsertBoard'; board: Board }

// ---------------------------------------------------------------------------
// Sync (Supabase multi-device sync)
// ---------------------------------------------------------------------------

export interface SyncSession {
  accessToken: string
  refreshToken: string
}

export interface SyncConfig {
  url: string
  anonKey: string
  email: string
  session?: SyncSession
  deviceId: string
  encryptedPassword?: string
}

export interface SyncConfigView {
  url: string
  anonKey: string
  email: string
  hasPassword: boolean
}

export type SyncState = 'disabled' | 'connecting' | 'online' | 'offline' | 'error'

export interface SyncStatus {
  state: SyncState
  pendingOps: number
  lastSyncAt?: number
  error?: string
}

export interface SyncConfigureInput {
  url: string
  anonKey: string
  email: string
  password: string
}

// ---------------------------------------------------------------------------
// Pty (Phase 2 — types defined now, implemented later)
// ---------------------------------------------------------------------------

export interface PtySpawnInput {
  projectKey: string
  initialQuery?: string
  resumeSessionId?: string
  freshFallback?: boolean // caller knows the previous session is unresumable; print the notice
  /** Working dir: the project basePath (default) or a path inside `<basePath>/.claude/worktrees/`. */
  cwd?: string
  /** `claude` (default) runs clauded; `shell` opens a plain PowerShell (terminal drawer). */
  mode?: 'claude' | 'shell'
}

export interface PtySpawnResult {
  ptyId: string
  resumed: boolean // false when a requested resume was downgraded to a fresh session
}

export interface PtyDataEvent {
  ptyId: string
  data: string
  replay?: boolean
}

export interface PtyExitEvent {
  ptyId: string
  exitCode: number
  resumeFailed?: boolean
}

export interface PtySessionEvent {
  ptyId: string
  sessionId: string
}

export interface PersistedTerminal {
  projectKey: string
  sessionId: string
  title: string
}

export interface PersistedTerminalsState {
  terminals: PersistedTerminal[] // in tab order
  activeSessionByProject: Record<string, string> // projectKey -> active sessionId
}

// ---------------------------------------------------------------------------
// Chats (Agent-SDK driven conversations — the T3-style chat view)
// ---------------------------------------------------------------------------

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type CodexLevel = 'off' | 'tests' | 'full'
/**
 * Claude Code permission modes offered in the composer: `bypassPermissions` = "Full access"
 * (today's clauded behaviour), `acceptEdits` = "Accept edits", `default` = "Ask", `plan` = "Plan".
 */
export type PermissionModeId = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

/** Per-chat composer switches; sticky per chat, defaults remembered per project. */
export interface ChatToggles {
  codex: CodexLevel
  ultra: boolean
}

/** New-chat workspace choice, applied once before the first send. */
export interface WorkspacePlan {
  newWorktree: boolean
  newBranch: boolean
  /** Required when `newBranch`; e.g. `pb/context-meter`. */
  branchName?: string
  /** Branch/commit to start from; defaults to the repo's current branch. */
  baseBranch?: string
}

/**
 * - `sdk`: driven by this app through the Agent SDK (composer enabled)
 * - `external`: a live session started outside the app (read-only, live-tailed)
 * - `tui`: this chat is temporarily continued in the terminal drawer (`clauded --resume`)
 */
export type ChatMode = 'sdk' | 'external' | 'tui'

export interface ChatMeta {
  /** Stable tab id. Own chats: a UUID. External sessions: `ext:<sessionId>`. */
  chatId: string
  projectKey: string
  /** Claude session id. Pre-assigned for new chats, so it is known before the first send. */
  sessionId: string
  title: string
  /** Absolute working directory: the project basePath, or the worktree path. */
  cwd: string
  branch?: string
  /** Worktree path relative to the repo root (e.g. `.claude/worktrees/context-meter`). */
  worktreePath?: string
  /** Model alias (`opus`, `fable`, `sonnet`, `haiku`) or a full model id. */
  model: string
  effort: EffortLevel
  toggles: ChatToggles
  permissionMode: PermissionModeId
  contextTokens?: number
  contextWindow?: number
  totalTokens?: number
  status: SessionStatus
  waitingFor?: string
  acknowledged?: boolean
  statusUpdatedAt?: number
  mode: ChatMode
  /** False while the chat is a draft (no session exists yet). */
  started: boolean
  /** Kanban card this chat was started from (linked on the first send). */
  cardId?: string
  createdAt: number
  updatedAt: number
}

/** What `chats.json` stores per own chat (live fields are recomputed). */
export type PersistedChat = Omit<
  ChatMeta,
  | 'status'
  | 'waitingFor'
  | 'acknowledged'
  | 'statusUpdatedAt'
  | 'mode'
  | 'contextTokens'
  | 'contextWindow'
  | 'totalTokens'
>

export interface PersistedChatsState {
  /** Own chats in tab order (all projects). */
  chats: PersistedChat[]
  /** projectKey -> active tab: a chatId, or `'board'` for the pinned Board tab. */
  activeByProject: Record<string, string>
}

export type ToolStatus = 'running' | 'ok' | 'error'

export interface DiffLine {
  type: 'ctx' | 'add' | 'del'
  oldNo?: number
  newNo?: number
  text: string
}

export interface DiffBlock {
  file: string
  added: number
  removed: number
  lines: DiffLine[]
}

export interface AskQuestionOption {
  label: string
  description: string
  preview?: string
}

export interface AskQuestion {
  question: string
  header: string
  multiSelect: boolean
  options: AskQuestionOption[]
}

export interface ChatAttachment {
  /** Absolute path on disk (pasted images are saved by main first). */
  path: string
  name: string
  kind: 'image' | 'file'
  size: number
  /** Small data: URL for image chips; only set by main. */
  thumbDataUrl?: string
}

/** Composer switches recovered from a sent prompt (see `parseDirectives`). */
export interface ParsedDirectives {
  codex: CodexLevel
  ultra: boolean
}

export type ChatItem =
  | {
      kind: 'user'
      id: string
      /** The text the user typed, with the directive trailer and file list removed. */
      text: string
      directives: ParsedDirectives
      attachments: { name: string; kind: 'image' | 'file' }[]
      ts?: number
      /**
       * Transcript `parentUuid` of this prompt: the chain entry an edit forks from
       * (`resumeSessionAt`). `null` = first message of the session; absent = not from a transcript.
       */
      parentUuid?: string | null
    }
  | { kind: 'assistant'; id: string; markdown: string; streaming?: boolean }
  | { kind: 'thinking'; id: string; text: string }
  | {
      kind: 'tool'
      /** The tool_use id. */
      id: string
      name: string
      /** One-line target, e.g. a file path, a command or a search pattern. */
      summary: string
      status: ToolStatus
      /** Short result line, e.g. `312 passed`, `9 results`, or the error text. */
      result?: string
      diff?: DiffBlock
    }
  | {
      kind: 'agent'
      /** The Agent/Task tool_use id. */
      id: string
      agentType: string
      description: string
      status: ToolStatus
      result?: string
      toolCount?: number
    }
  | {
      kind: 'question'
      /** The AskUserQuestion tool_use id. */
      id: string
      questions: AskQuestion[]
      state: 'pending' | 'answered' | 'skipped'
      answers?: Record<string, string>
    }
  | {
      kind: 'plan'
      /** The ExitPlanMode tool_use id. */
      id: string
      plan: string
      state: 'pending' | 'approved' | 'rejected'
    }
  | {
      kind: 'permission'
      /** The tool_use id awaiting permission. */
      id: string
      toolName: string
      /** Prompt sentence, e.g. "Claude wants to run npm test" (the SDK's `title` when given). */
      title: string
      description?: string
      summary: string
      /** Offer "Allow for this chat" (the SDK sent suggestions and did not suppress the rule). */
      canAlwaysAllow: boolean
      state: 'pending' | 'allowed' | 'denied'
    }
  | { kind: 'system'; id: string; text: string; tone?: 'info' | 'error' }
  | { kind: 'command'; id: string; name: string; args: string }
  | { kind: 'turn-end'; id: string; durationMs: number }

export interface ChatItemsEvent {
  chatId: string
  /** Replace the whole list (history load). */
  reset?: ChatItem[]
  /** Insert or replace by `id`, keeping first-seen order. */
  upsert?: ChatItem[]
  remove?: string[]
}

export interface ChatCreateInput {
  projectKey: string
  /** Pre-fills the composer (not sent), e.g. `/cc-enhance <card body>`. */
  draftText?: string
  cardId?: string
  /** Open an existing session (e.g. a card's linked session) as a chat. */
  resumeSessionId?: string
  title?: string
}

export interface ChatCreateResult {
  chat: ChatMeta
  draftText?: string
}

export type ChatPatch = Partial<
  Pick<ChatMeta, 'model' | 'effort' | 'toggles' | 'title' | 'permissionMode'>
>

export interface ChatSendInput {
  chatId: string
  text: string
  attachments: ChatAttachment[]
  toggles: ChatToggles
  /** Only honoured on the first send of a draft. */
  workspace?: WorkspacePlan
  /** "Stop and send": interrupt the running turn first, then send. */
  interrupt?: boolean
}

export type PlanDecision = { approve: true } | { approve: false; feedback: string }

export type PermissionDecision = { allow: true; always?: boolean } | { allow: false; message?: string }

/** Edit a sent user message: fork at its parent and send `text` instead. */
export interface ChatRewindInput {
  chatId: string
  /** The `user` item being edited (its transcript uuid). */
  userItemId: string
  text: string
  attachments: ChatAttachment[]
  toggles: ChatToggles
  /** Also restore files to their state at that message (`rewindFiles`). */
  revertFiles: boolean
}

/** Tab reload: `resume` restarts the SDK process on the same session; `fresh` starts a new session. */
export type ChatRestartMode = 'resume' | 'fresh'

/** A past session of a project, for the resume picker. */
export interface PastSession {
  sessionId: string
  title: string
  /** First line of the first prompt (directive trailer removed). */
  firstPrompt: string
  /** Transcript mtime, epoch ms. */
  lastActivity: number
  cwd: string
  /** `.claude/worktrees/<slug>` when the session ran in a worktree of the project. */
  worktreeRel?: string
  model?: string
  /** An own chat tab already shows this session. */
  openChatId?: string
}

/** A slash command or skill the composer can suggest after `/` (from the SDK's supportedCommands). */
export interface SlashCommandInfo {
  /** Without the leading slash, e.g. `ai-brain:cc-enhance` or `compact`. */
  name: string
  description: string
  argumentHint: string
  aliases?: string[]
  builtin?: boolean
}

export type RateLimitWindowId = 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet'

export interface RateLimitWindow {
  id: RateLimitWindowId
  /** Percent used, 0-100. */
  pct: number
  /** Epoch ms when the window resets. */
  resetsAt?: number
  status?: 'allowed' | 'allowed_warning' | 'rejected'
}

export interface RateLimits {
  /** False for API-key / 3P sessions or before the first successful probe. */
  available: boolean
  windows: RateLimitWindow[]
  updatedAt: number
}

export interface GitInfo {
  isRepo: boolean
  branch?: string
  detached?: boolean
  isWorktree: boolean
  /** Absolute path of the main repository root. */
  repoRoot?: string
  /** Worktree path relative to `repoRoot`, when `isWorktree`. */
  worktreeRel?: string
  dirty?: boolean
}

export interface ModelOption {
  id: string
  name: string
  description: string
}

// ---------------------------------------------------------------------------
// IPC channel name constants
// ---------------------------------------------------------------------------

export const IPC_CHANNELS = {
  sessions: {
    list: 'sessions:list',
    changed: 'sessions:changed',
    acknowledge: 'sessions:acknowledge',
    unacknowledge: 'sessions:unacknowledge'
  },
  projects: {
    list: 'projects:list',
    create: 'projects:create',
    update: 'projects:update',
    delete: 'projects:delete',
    pickDirectory: 'projects:pickDirectory',
    changed: 'projects:changed'
  },
  kanban: {
    getBoards: 'kanban:getBoards',
    mutate: 'kanban:mutate',
    changed: 'kanban:changed'
  },
  sync: {
    getStatus: 'sync:getStatus',
    configure: 'sync:configure',
    signOut: 'sync:signOut',
    status: 'sync:status',
    getConfig: 'sync:getConfig'
  },
  pty: {
    spawn: 'pty:spawn',
    write: 'pty:write',
    resize: 'pty:resize',
    kill: 'pty:kill',
    attach: 'pty:attach',
    data: 'pty:data',
    exit: 'pty:exit',
    session: 'pty:session',
    loadPersisted: 'pty:loadPersisted',
    savePersisted: 'pty:savePersisted',
    bindings: 'pty:bindings'
  },
  clipboard: {
    writeText: 'clipboard:writeText',
    readText: 'clipboard:readText'
  },
  window: {
    getInset: 'window:getInset',
    insetChanged: 'window:insetChanged'
  },
  chat: {
    list: 'chat:list',
    create: 'chat:create',
    update: 'chat:update',
    send: 'chat:send',
    interrupt: 'chat:interrupt',
    answer: 'chat:answer',
    decidePlan: 'chat:decidePlan',
    close: 'chat:close',
    history: 'chat:history',
    setActive: 'chat:setActive',
    openInTui: 'chat:openInTui',
    decidePermission: 'chat:decidePermission',
    rewind: 'chat:rewind',
    restart: 'chat:restart',
    listSessions: 'chat:listSessions',
    listCommands: 'chat:listCommands',
    changed: 'chat:changed',
    items: 'chat:items'
  },
  git: {
    info: 'git:info',
    branches: 'git:branches'
  },
  rate: {
    get: 'rate:get',
    changed: 'rate:changed'
  },
  attachments: {
    pick: 'attachments:pick',
    describe: 'attachments:describe',
    saveImage: 'attachments:saveImage'
  }
} as const

// ---------------------------------------------------------------------------
// window.api shape
// ---------------------------------------------------------------------------

export interface Api {
  caps: {
    pty: boolean
  }
  sessions: {
    list(): Promise<SessionsSnapshot>
    acknowledge(sessionId: string, statusUpdatedAt: number): Promise<void>
    unacknowledge(sessionId: string): Promise<void>
    onChanged(cb: (snapshot: SessionsSnapshot) => void): () => void
  }
  projects: {
    list(): Promise<Project[]>
    create(input: ProjectInput): Promise<Project>
    update(projectKey: string, patch: Partial<ProjectInput>): Promise<Project>
    delete(projectKey: string): Promise<void>
    pickDirectory(): Promise<string | null>
    onChanged(cb: (projects: Project[]) => void): () => void
  }
  kanban: {
    getBoards(): Promise<KanbanState>
    mutate(mutation: KanbanMutation): Promise<KanbanState>
    onChanged(cb: (state: KanbanState) => void): () => void
  }
  sync: {
    getStatus(): Promise<SyncStatus>
    configure(input: SyncConfigureInput): Promise<SyncStatus>
    signOut(): Promise<void>
    getConfig(): Promise<SyncConfigView | null>
    onStatus(cb: (status: SyncStatus) => void): () => void
  }
  pty: {
    spawn(input: PtySpawnInput): Promise<PtySpawnResult>
    write(ptyId: string, data: string): Promise<void>
    resize(ptyId: string, cols: number, rows: number): Promise<void>
    kill(ptyId: string): Promise<void>
    attach(ptyId: string): Promise<void>
    getPathForFile(file: File): string
    onData(cb: (payload: PtyDataEvent) => void): () => void
    onExit(cb: (payload: PtyExitEvent) => void): () => void
    onSession(cb: (payload: PtySessionEvent) => void): () => void
    loadPersisted(): Promise<PersistedTerminalsState>
    savePersisted(state: PersistedTerminalsState): Promise<void>
    getBindings(): Promise<PtySessionEvent[]>
  }
  clipboard: {
    writeText(text: string): Promise<void>
    readText(): Promise<string>
  }
  window: {
    getInset(): Promise<number>
    onInsetChanged(cb: (inset: number) => void): () => void
  }
  chat: {
    /** Own chats (tab order) plus live external sessions, and the active tab per project. */
    list(): Promise<{ chats: ChatMeta[]; activeByProject: Record<string, string> }>
    create(input: ChatCreateInput): Promise<ChatCreateResult>
    update(chatId: string, patch: ChatPatch): Promise<ChatMeta>
    send(input: ChatSendInput): Promise<void>
    interrupt(chatId: string): Promise<void>
    /** `answers` null = the user skipped the question. */
    answer(chatId: string, toolUseId: string, answers: Record<string, string> | null): Promise<void>
    decidePlan(chatId: string, toolUseId: string, decision: PlanDecision): Promise<void>
    close(chatId: string): Promise<void>
    history(chatId: string): Promise<ChatItem[]>
    setActive(projectKey: string, tab: string): Promise<void>
    openInTui(chatId: string): Promise<{ ptyId: string }>
    decidePermission(chatId: string, toolUseId: string, decision: PermissionDecision): Promise<void>
    rewind(input: ChatRewindInput): Promise<void>
    restart(chatId: string, mode: ChatRestartMode): Promise<ChatMeta>
    /** Past sessions of the project, newest first (max 50). */
    listSessions(projectKey: string): Promise<PastSession[]>
    /** Slash commands and skills available in that chat's folder (cached per cwd). */
    listCommands(chatId: string): Promise<SlashCommandInfo[]>
    onChanged(cb: (chats: ChatMeta[]) => void): () => void
    onItems(cb: (event: ChatItemsEvent) => void): () => void
  }
  git: {
    info(cwd: string): Promise<GitInfo>
    /** Local branches of the project's repo, current branch first. */
    branches(projectKey: string): Promise<string[]>
  }
  rate: {
    get(): Promise<RateLimits>
    onChanged(cb: (limits: RateLimits) => void): () => void
  }
  attachments: {
    /** Opens the native file picker (multi-select). */
    pick(): Promise<ChatAttachment[]>
    /** Size, kind and thumbnail for dropped paths. */
    describe(paths: string[]): Promise<ChatAttachment[]>
    /** Saves a pasted image (data: URL) under userData and returns it as an attachment. */
    saveImage(dataUrl: string, name?: string): Promise<ChatAttachment>
  }
}

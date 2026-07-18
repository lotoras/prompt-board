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

export function sessionNeedsAttention(s: SessionInfo): boolean {
  return s.status === 'waiting' || (s.status === 'idle' && !s.acknowledged)
}

export function isIdleUnacknowledged(s: SessionInfo): boolean {
  return s.status === 'idle' && !s.acknowledged
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
  createdAt: number
  updatedAt: number
}

export interface KanbanState {
  boards: Board[]
  cards: KanbanCard[]
}

export type KanbanMutation =
  | { type: 'createCard'; card: Omit<KanbanCard, 'id' | 'createdAt' | 'updatedAt'> }
  | {
      type: 'updateCard'
      id: string
      patch: Partial<Omit<KanbanCard, 'id' | 'createdAt' | 'updatedAt'>>
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
}

export interface PtyDataEvent {
  ptyId: string
  data: string
  replay?: boolean
}

export interface PtyExitEvent {
  ptyId: string
  exitCode: number
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
// IPC channel name constants
// ---------------------------------------------------------------------------

export const IPC_CHANNELS = {
  sessions: {
    list: 'sessions:list',
    changed: 'sessions:changed',
    acknowledge: 'sessions:acknowledge'
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
    savePersisted: 'pty:savePersisted'
  },
  clipboard: {
    writeText: 'clipboard:writeText',
    readText: 'clipboard:readText'
  },
  window: {
    getInset: 'window:getInset',
    insetChanged: 'window:insetChanged'
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
    spawn(input: PtySpawnInput): Promise<{ ptyId: string }>
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
  }
  clipboard: {
    writeText(text: string): Promise<void>
    readText(): Promise<string>
  }
  window: {
    getInset(): Promise<number>
    onInsetChanged(cb: (inset: number) => void): () => void
  }
}

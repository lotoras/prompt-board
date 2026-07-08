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
// Pty (Phase 2 — types defined now, implemented later)
// ---------------------------------------------------------------------------

export interface PtySpawnInput {
  projectKey: string
  initialQuery?: string
}

export interface PtyDataEvent {
  ptyId: string
  data: string
}

export interface PtyExitEvent {
  ptyId: string
  exitCode: number
}

export interface PtySessionEvent {
  ptyId: string
  sessionId: string
}

// ---------------------------------------------------------------------------
// IPC channel name constants
// ---------------------------------------------------------------------------

export const IPC_CHANNELS = {
  sessions: {
    list: 'sessions:list',
    changed: 'sessions:changed'
  },
  projects: {
    list: 'projects:list',
    create: 'projects:create',
    update: 'projects:update',
    delete: 'projects:delete',
    pickDirectory: 'projects:pickDirectory'
  },
  kanban: {
    getBoards: 'kanban:getBoards',
    mutate: 'kanban:mutate'
  },
  pty: {
    spawn: 'pty:spawn',
    write: 'pty:write',
    resize: 'pty:resize',
    kill: 'pty:kill',
    data: 'pty:data',
    exit: 'pty:exit',
    session: 'pty:session'
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
    onChanged(cb: (snapshot: SessionsSnapshot) => void): () => void
  }
  projects: {
    list(): Promise<Project[]>
    create(input: ProjectInput): Promise<Project>
    update(projectKey: string, patch: Partial<ProjectInput>): Promise<Project>
    delete(projectKey: string): Promise<void>
    pickDirectory(): Promise<string | null>
  }
  kanban: {
    getBoards(): Promise<KanbanState>
    mutate(mutation: KanbanMutation): Promise<KanbanState>
  }
  pty: {
    spawn(input: PtySpawnInput): Promise<{ ptyId: string }>
    write(ptyId: string, data: string): Promise<void>
    resize(ptyId: string, cols: number, rows: number): Promise<void>
    kill(ptyId: string): Promise<void>
    onData(cb: (payload: PtyDataEvent) => void): () => void
    onExit(cb: (payload: PtyExitEvent) => void): () => void
    onSession(cb: (payload: PtySessionEvent) => void): () => void
  }
}

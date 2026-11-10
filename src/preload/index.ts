import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC_CHANNELS,
  type Api,
  type ChatCreateInput,
  type ChatItemsEvent,
  type ChatMeta,
  type ChatPatch,
  type ChatRestartMode,
  type ChatRewindInput,
  type ChatSendInput,
  type PermissionDecision,
  type PlanDecision,
  type RateLimits,
  type KanbanMutation,
  type KanbanState,
  type PersistedTerminalsState,
  type Project,
  type ProjectInput,
  type PtyDataEvent,
  type PtyExitEvent,
  type PtySessionEvent,
  type PtySpawnInput,
  type SessionsSnapshot,
  type SyncConfigureInput,
  type SyncConfigView,
  type SyncStatus
} from '../shared/types'

const api: Api = {
  caps: {
    pty: true
  },
  sessions: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.sessions.list),
    acknowledge: (sessionId: string, statusUpdatedAt: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.sessions.acknowledge, sessionId, statusUpdatedAt),
    unacknowledge: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sessions.unacknowledge, sessionId),
    onChanged: (cb: (snapshot: SessionsSnapshot) => void) => {
      const listener = (_event: unknown, snapshot: SessionsSnapshot): void => cb(snapshot)
      ipcRenderer.on(IPC_CHANNELS.sessions.changed, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.sessions.changed, listener)
    }
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.projects.list),
    create: (input: ProjectInput) => ipcRenderer.invoke(IPC_CHANNELS.projects.create, input),
    update: (projectKey: string, patch: Partial<ProjectInput>) =>
      ipcRenderer.invoke(IPC_CHANNELS.projects.update, projectKey, patch),
    delete: (projectKey: string) => ipcRenderer.invoke(IPC_CHANNELS.projects.delete, projectKey),
    pickDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.projects.pickDirectory),
    onChanged: (cb: (projects: Project[]) => void) => {
      const listener = (_event: unknown, projects: Project[]): void => cb(projects)
      ipcRenderer.on(IPC_CHANNELS.projects.changed, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.projects.changed, listener)
    }
  },
  kanban: {
    getBoards: () => ipcRenderer.invoke(IPC_CHANNELS.kanban.getBoards),
    mutate: (mutation: KanbanMutation) => ipcRenderer.invoke(IPC_CHANNELS.kanban.mutate, mutation),
    onChanged: (cb: (state: KanbanState) => void) => {
      const listener = (_event: unknown, state: KanbanState): void => cb(state)
      ipcRenderer.on(IPC_CHANNELS.kanban.changed, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.kanban.changed, listener)
    }
  },
  sync: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.sync.getStatus),
    configure: (input: SyncConfigureInput) => ipcRenderer.invoke(IPC_CHANNELS.sync.configure, input),
    signOut: () => ipcRenderer.invoke(IPC_CHANNELS.sync.signOut),
    getConfig: (): Promise<SyncConfigView | null> => ipcRenderer.invoke(IPC_CHANNELS.sync.getConfig),
    onStatus: (cb: (status: SyncStatus) => void) => {
      const listener = (_event: unknown, status: SyncStatus): void => cb(status)
      ipcRenderer.on(IPC_CHANNELS.sync.status, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.sync.status, listener)
    }
  },
  pty: {
    spawn: (input: PtySpawnInput) => ipcRenderer.invoke(IPC_CHANNELS.pty.spawn, input),
    write: (ptyId: string, data: string) => ipcRenderer.invoke(IPC_CHANNELS.pty.write, ptyId, data),
    resize: (ptyId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.pty.resize, ptyId, cols, rows),
    kill: (ptyId: string) => ipcRenderer.invoke(IPC_CHANNELS.pty.kill, ptyId),
    attach: (ptyId: string) => ipcRenderer.invoke(IPC_CHANNELS.pty.attach, ptyId),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    onData: (cb: (payload: PtyDataEvent) => void) => {
      const listener = (_event: unknown, payload: PtyDataEvent): void => cb(payload)
      ipcRenderer.on(IPC_CHANNELS.pty.data, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.pty.data, listener)
    },
    onExit: (cb: (payload: PtyExitEvent) => void) => {
      const listener = (_event: unknown, payload: PtyExitEvent): void => cb(payload)
      ipcRenderer.on(IPC_CHANNELS.pty.exit, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.pty.exit, listener)
    },
    onSession: (cb: (payload: PtySessionEvent) => void) => {
      const listener = (_event: unknown, payload: PtySessionEvent): void => cb(payload)
      ipcRenderer.on(IPC_CHANNELS.pty.session, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.pty.session, listener)
    },
    loadPersisted: (): Promise<PersistedTerminalsState> =>
      ipcRenderer.invoke(IPC_CHANNELS.pty.loadPersisted),
    savePersisted: (state: PersistedTerminalsState): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.pty.savePersisted, state),
    getBindings: (): Promise<PtySessionEvent[]> => ipcRenderer.invoke(IPC_CHANNELS.pty.bindings)
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.clipboard.writeText, text),
    readText: () => ipcRenderer.invoke(IPC_CHANNELS.clipboard.readText)
  },
  window: {
    getInset: () => ipcRenderer.invoke(IPC_CHANNELS.window.getInset),
    onInsetChanged: (cb: (inset: number) => void) => {
      const listener = (_event: unknown, inset: number): void => cb(inset)
      ipcRenderer.on(IPC_CHANNELS.window.insetChanged, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.window.insetChanged, listener)
    }
  },
  chat: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.chat.list),
    create: (input: ChatCreateInput) => ipcRenderer.invoke(IPC_CHANNELS.chat.create, input),
    update: (chatId: string, patch: ChatPatch) =>
      ipcRenderer.invoke(IPC_CHANNELS.chat.update, chatId, patch),
    send: (input: ChatSendInput) => ipcRenderer.invoke(IPC_CHANNELS.chat.send, input),
    interrupt: (chatId: string) => ipcRenderer.invoke(IPC_CHANNELS.chat.interrupt, chatId),
    answer: (chatId: string, toolUseId: string, answers: Record<string, string> | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.chat.answer, chatId, toolUseId, answers),
    decidePlan: (chatId: string, toolUseId: string, decision: PlanDecision) =>
      ipcRenderer.invoke(IPC_CHANNELS.chat.decidePlan, chatId, toolUseId, decision),
    close: (chatId: string) => ipcRenderer.invoke(IPC_CHANNELS.chat.close, chatId),
    history: (chatId: string) => ipcRenderer.invoke(IPC_CHANNELS.chat.history, chatId),
    setActive: (projectKey: string, tab: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.chat.setActive, projectKey, tab),
    openInTui: (chatId: string) => ipcRenderer.invoke(IPC_CHANNELS.chat.openInTui, chatId),
    decidePermission: (chatId: string, toolUseId: string, decision: PermissionDecision) =>
      ipcRenderer.invoke(IPC_CHANNELS.chat.decidePermission, chatId, toolUseId, decision),
    rewind: (input: ChatRewindInput) => ipcRenderer.invoke(IPC_CHANNELS.chat.rewind, input),
    restart: (chatId: string, mode: ChatRestartMode) =>
      ipcRenderer.invoke(IPC_CHANNELS.chat.restart, chatId, mode),
    listSessions: (projectKey: string, opts?: { offset?: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.chat.listSessions, projectKey, opts),
    takeOver: (chatId: string) => ipcRenderer.invoke(IPC_CHANNELS.chat.takeOver, chatId),
    listCommands: (chatId: string) => ipcRenderer.invoke(IPC_CHANNELS.chat.listCommands, chatId),
    onChanged: (cb: (chats: ChatMeta[]) => void) => {
      const listener = (_event: unknown, chats: ChatMeta[]): void => cb(chats)
      ipcRenderer.on(IPC_CHANNELS.chat.changed, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.chat.changed, listener)
    },
    onItems: (cb: (event: ChatItemsEvent) => void) => {
      const listener = (_event: unknown, payload: ChatItemsEvent): void => cb(payload)
      ipcRenderer.on(IPC_CHANNELS.chat.items, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.chat.items, listener)
    }
  },
  git: {
    info: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.git.info, cwd),
    branches: (projectKey: string) => ipcRenderer.invoke(IPC_CHANNELS.git.branches, projectKey),
    changes: (cwd: string, dirs?: string[]) => ipcRenderer.invoke(IPC_CHANNELS.git.changes, cwd, dirs)
  },
  rate: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.rate.get),
    onChanged: (cb: (limits: RateLimits) => void) => {
      const listener = (_event: unknown, limits: RateLimits): void => cb(limits)
      ipcRenderer.on(IPC_CHANNELS.rate.changed, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.rate.changed, listener)
    }
  },
  accounts: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.accounts.list)
  },
  attachments: {
    pick: () => ipcRenderer.invoke(IPC_CHANNELS.attachments.pick),
    describe: (paths: string[]) => ipcRenderer.invoke(IPC_CHANNELS.attachments.describe, paths),
    saveImage: (dataUrl: string, name?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.attachments.saveImage, dataUrl, name)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}

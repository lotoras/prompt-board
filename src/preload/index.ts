import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC_CHANNELS,
  type Api,
  type KanbanMutation,
  type ProjectInput,
  type PtyDataEvent,
  type PtyExitEvent,
  type PtySessionEvent,
  type PtySpawnInput,
  type SessionsSnapshot
} from '../shared/types'

const api: Api = {
  caps: {
    pty: true
  },
  sessions: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.sessions.list),
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
    pickDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.projects.pickDirectory)
  },
  kanban: {
    getBoards: () => ipcRenderer.invoke(IPC_CHANNELS.kanban.getBoards),
    mutate: (mutation: KanbanMutation) => ipcRenderer.invoke(IPC_CHANNELS.kanban.mutate, mutation)
  },
  pty: {
    spawn: (input: PtySpawnInput) => ipcRenderer.invoke(IPC_CHANNELS.pty.spawn, input),
    write: (ptyId: string, data: string) => ipcRenderer.invoke(IPC_CHANNELS.pty.write, ptyId, data),
    resize: (ptyId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.pty.resize, ptyId, cols, rows),
    kill: (ptyId: string) => ipcRenderer.invoke(IPC_CHANNELS.pty.kill, ptyId),
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
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

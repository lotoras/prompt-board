import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type { IPty } from 'node-pty'
import { IPC_CHANNELS } from '../../shared/types'
import type { PtySpawnInput } from '../../shared/types'
import { listProjects } from '../projects/store'
import { clearPendingSpawn, registerPendingSpawn } from './reconcile'
import { scheduleQueryInjection } from './queryInjector'

type PtyModule = typeof import('node-pty')

let ptyModule: PtyModule | null | undefined

function loadPty(): PtyModule | null {
  if (ptyModule !== undefined) return ptyModule
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyModule = require('node-pty') as PtyModule
  } catch (err) {
    console.error('node-pty unavailable:', err)
    ptyModule = null
  }
  return ptyModule
}

export function isPtyAvailable(): boolean {
  return loadPty() !== null
}

interface PtySession {
  pty: IPty
  projectKey: string
}

const sessions = new Map<string, PtySession>()

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Spawn `clauded` for a manually configured project (requires a
 * `basePath`). Windows can't exec a `.cmd` directly, so we run it through
 * `cmd.exe /c`.
 */
export async function spawnPty(
  getWindow: () => BrowserWindow | null,
  input: PtySpawnInput
): Promise<{ ptyId: string }> {
  const pty = loadPty()
  if (!pty) throw new Error('pty not available')

  const projects = await listProjects()
  const project = projects.find((p) => p.projectKey === input.projectKey)
  if (!project || !project.basePath) {
    throw new Error(`Project has no base path to spawn a terminal in: ${input.projectKey}`)
  }

  const ptyId = randomUUID()
  const ptyProcess = pty.spawn('cmd.exe', ['/c', 'clauded'], {
    cwd: project.basePath,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    useConpty: true,
    env: process.env as Record<string, string>
  })

  sessions.set(ptyId, { pty: ptyProcess, projectKey: input.projectKey })

  const spawnedAt = Date.now()
  registerPendingSpawn(ptyId, input.projectKey, spawnedAt)

  ptyProcess.onData((data) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.pty.data, { ptyId, data })
    }
  })

  ptyProcess.onExit(({ exitCode }) => {
    sessions.delete(ptyId)
    clearPendingSpawn(ptyId)
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.pty.exit, { ptyId, exitCode })
    }
  })

  if (input.initialQuery) {
    scheduleQueryInjection(ptyProcess, input.initialQuery, spawnedAt)
  }

  return { ptyId }
}

export function writePty(ptyId: string, data: string): void {
  sessions.get(ptyId)?.pty.write(data)
}

export function resizePty(ptyId: string, cols: number, rows: number): void {
  sessions.get(ptyId)?.pty.resize(cols, rows)
}

export function killPty(ptyId: string): void {
  const session = sessions.get(ptyId)
  if (!session) return
  session.pty.kill()
  sessions.delete(ptyId)
  clearPendingSpawn(ptyId)
}

export function killAllPtys(): void {
  for (const [ptyId, session] of sessions) {
    session.pty.kill()
    clearPendingSpawn(ptyId)
  }
  sessions.clear()
}

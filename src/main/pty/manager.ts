import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type { IPty } from 'node-pty'
import { IPC_CHANNELS } from '../../shared/types'
import type { PtySpawnInput } from '../../shared/types'
import { assertProjectDirectory, listProjects } from '../projects/store'
import { clearPendingSpawn, preclaimSession, registerPendingSpawn } from './reconcile'
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
const buffers = new Map<string, string>()
const MAX_BUFFER = 256 * 1024

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Spawn `clauded` for a manually configured project (requires a
 * `basePath`). We host it in PowerShell, which resolves `clauded.cmd` by
 * name via PATH/PATHEXT.
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

  try {
    await assertProjectDirectory(project.basePath)
  } catch (err) {
    throw new Error(`Cannot start a terminal for "${project.name}": ${(err as Error).message}`)
  }

  const ptyId = randomUUID()
  const args = input.resumeSessionId
    ? ['-NoLogo', '-NoProfile', '-Command', `claude --resume ${input.resumeSessionId}`]
    : ['-NoLogo', '-NoProfile', '-Command', 'clauded']
  const ptyProcess = pty.spawn('powershell.exe', args, {
    cwd: project.basePath,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    useConpty: true,
    env: { ...process.env, CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1' } as Record<string, string>
  })

  sessions.set(ptyId, { pty: ptyProcess, projectKey: input.projectKey })
  buffers.set(ptyId, '')

  const spawnedAt = Date.now()
  if (input.resumeSessionId) {
    preclaimSession(input.resumeSessionId)
  }
  registerPendingSpawn(ptyId, input.projectKey, spawnedAt, input.resumeSessionId)

  ptyProcess.onData((data) => {
    const next = (buffers.get(ptyId) ?? '') + data
    buffers.set(ptyId, next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next)
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.pty.data, { ptyId, data })
    }
  })

  ptyProcess.onExit(({ exitCode }) => {
    sessions.delete(ptyId)
    buffers.delete(ptyId)
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
  try {
    sessions.get(ptyId)?.pty.write(data)
  } catch (err) {
    console.error('pty write failed', err)
  }
}

export function resizePty(ptyId: string, cols: number, rows: number): void {
  try {
    sessions.get(ptyId)?.pty.resize(cols, rows)
  } catch (err) {
    console.error('pty resize failed', err)
  }
}

export function killPty(ptyId: string): void {
  const session = sessions.get(ptyId)
  if (!session) return
  try {
    session.pty.kill()
  } catch (err) {
    console.error('pty kill failed', err)
  }
  sessions.delete(ptyId)
  buffers.delete(ptyId)
  clearPendingSpawn(ptyId)
}

export function killAllPtys(): void {
  for (const [ptyId, session] of sessions) {
    session.pty.kill()
    clearPendingSpawn(ptyId)
  }
  sessions.clear()
  buffers.clear()
}

/**
 * Main is single-threaded and `webContents.send` is FIFO per channel, so
 * replaying the backlog on the same `pty.data` channel (tagged `replay:true`)
 * keeps ordering intact: the renderer discards live data for a pty until it
 * sees that pty's replay chunk, applies the replay, then live data — each
 * byte is shown exactly once.
 */
export function attachPty(getWindow: () => BrowserWindow | null, ptyId: string): void {
  const win = getWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC_CHANNELS.pty.data, { ptyId, data: buffers.get(ptyId) ?? '', replay: true })
}

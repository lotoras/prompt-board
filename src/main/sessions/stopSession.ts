import { execFile } from 'child_process'
import { promisify } from 'util'
import type { SessionInfo } from '../../shared/types'
import { filterAliveSessions } from './liveness'

const execFileAsync = promisify(execFile)

const POLL_MS = 150
const POLL_ATTEMPTS = 40

export interface StopDeps {
  /** True while the process is confirmed to still be this session (guards against PID reuse). */
  isAlive(session: SessionInfo): Promise<boolean>
  killTree(pid: number): Promise<void>
  sleep(ms: number): Promise<void>
  selfPid: number
}

async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    // /T also ends the session's children (MCP servers, background commands); /F because a
    // console process does not answer a polite close request.
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  } else {
    process.kill(pid, 'SIGTERM')
  }
}

const defaultDeps: StopDeps = {
  isAlive: async (session) => (await filterAliveSessions([session])).length > 0,
  killTree: killProcessTree,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  selfPid: process.pid
}

/**
 * End the process that runs `session` elsewhere and wait until it is gone, so the session can be
 * resumed here without two processes writing to one transcript. A process that is already gone
 * is not an error. The transcript is append-only, so only a turn still in flight is lost.
 */
export async function stopSessionProcess(
  session: SessionInfo,
  deps: StopDeps = defaultDeps
): Promise<void> {
  if (session.pid === deps.selfPid) throw new Error('Refusing to stop this app itself')
  if (!(await deps.isAlive(session))) return
  // A failed kill (e.g. the process exited just now) is settled by the check below.
  await deps.killTree(session.pid).catch(() => undefined)
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    if (!(await deps.isAlive(session))) return
    await deps.sleep(POLL_MS)
  }
  throw new Error('Could not stop the session in the other terminal')
}

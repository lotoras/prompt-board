import { execFile } from 'child_process'
import { promisify } from 'util'
import type { SessionInfo } from '../../shared/types'

const execFileAsync = promisify(execFile)

const START_TIME_TOLERANCE_MS = 2000
const CACHE_TTL_MS = 5000

let startTimeCache: Map<number, number> = new Map()
let cacheFetchedAt = 0
let inflightFetch: Promise<Map<number, number>> | null = null

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function parseWindowsDate(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const legacyMatch = value.match(/\/Date\((\d+)\)\//)
  if (legacyMatch) return Number(legacyMatch[1])
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

async function fetchStartTimesWindows(pids: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  if (pids.length === 0) return map

  try {
    const idList = pids.join(',')
    const script = `Get-Process -Id ${idList} -ErrorAction SilentlyContinue | Select-Object Id,StartTime | ConvertTo-Json -Compress`
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      timeout: 4000
    })
    const trimmed = stdout.trim()
    if (!trimmed) return map
    const parsed: unknown = JSON.parse(trimmed)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue
      const id = (row as Record<string, unknown>).Id
      const startTime = parseWindowsDate((row as Record<string, unknown>).StartTime)
      if (typeof id === 'number' && startTime !== undefined) {
        map.set(id, startTime)
      }
    }
  } catch {
    // best-effort: leave map empty, caller falls back
  }

  return map
}

async function fetchStartTimesPosix(pids: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  if (pids.length === 0) return map

  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')], {
      timeout: 4000
    })
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const match = trimmed.match(/^(\d+)\s+(.*)$/)
      if (!match) continue
      const pid = Number(match[1])
      const startTime = Date.parse(match[2])
      if (!Number.isNaN(startTime)) map.set(pid, startTime)
    }
  } catch {
    // best-effort
  }

  return map
}

async function getStartTimes(pids: number[]): Promise<Map<number, number>> {
  const now = Date.now()
  if (now - cacheFetchedAt < CACHE_TTL_MS && startTimeCache.size > 0) {
    return startTimeCache
  }
  if (inflightFetch) return inflightFetch

  inflightFetch = (process.platform === 'win32'
    ? fetchStartTimesWindows(pids)
    : fetchStartTimesPosix(pids)
  ).then((map) => {
    startTimeCache = map
    cacheFetchedAt = Date.now()
    inflightFetch = null
    return map
  })

  return inflightFetch
}

/**
 * Batched liveness check for a set of sessions. Returns the subset of pids
 * confirmed alive: `process.kill(pid, 0)` succeeds AND (when an OS start
 * time is available) it matches `procStart` within tolerance — this defeats
 * PID reuse. When the OS start time cannot be determined, falls back to the
 * kill(0) check alone (registry `updatedAt` freshness is handled upstream).
 */
export async function filterAliveSessions(sessions: SessionInfo[]): Promise<SessionInfo[]> {
  const alive = sessions.filter((s) => isProcessAlive(s.pid))
  if (alive.length === 0) return []

  const startTimes = await getStartTimes(alive.map((s) => s.pid))

  return alive.filter((s) => {
    const osStart = startTimes.get(s.pid)
    if (osStart === undefined) return true
    if (typeof s.procStart === 'number') {
      return Math.abs(osStart - s.procStart) <= START_TIME_TOLERANCE_MS
    }
    // No procStart recorded: a reused pid's process necessarily starts after
    // this session was registered, so a much-later osStart implies reuse.
    return osStart <= s.startedAt + START_TIME_TOLERANCE_MS
  })
}

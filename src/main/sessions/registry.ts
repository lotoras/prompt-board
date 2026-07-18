import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import type { SessionInfo, SessionStatus } from '../../shared/types'

export function sessionsDir(): string {
  return join(os.homedir(), '.claude', 'sessions')
}

const VALID_STATUSES: SessionStatus[] = ['busy', 'idle', 'waiting']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseRegistryFile(raw: unknown): SessionInfo | null {
  if (!isRecord(raw)) return null
  const { pid, sessionId, cwd, status, startedAt, updatedAt, statusUpdatedAt, procStart } = raw

  if (typeof pid !== 'number') return null
  if (typeof sessionId !== 'string') return null
  if (typeof cwd !== 'string') return null
  if (typeof status !== 'string' || !VALID_STATUSES.includes(status as SessionStatus)) return null
  if (typeof startedAt !== 'number') return null
  if (typeof updatedAt !== 'number') return null
  if (typeof statusUpdatedAt !== 'number') return null

  const info: SessionInfo = {
    pid,
    sessionId,
    cwd,
    status: status as SessionStatus,
    startedAt,
    updatedAt,
    statusUpdatedAt
  }

  // Windows writes procStart as a non-epoch string; intentionally ignored (only numeric epoch-ms is accepted).
  if (typeof procStart === 'number') info.procStart = procStart
  if (typeof raw.waitingFor === 'string') info.waitingFor = raw.waitingFor
  if (typeof raw.name === 'string') info.name = raw.name

  return info
}

/**
 * Enumerate and parse `~/.claude/sessions/*.json`. Malformed or partial
 * files are skipped rather than throwing.
 */
export async function readRegistry(): Promise<SessionInfo[]> {
  const dir = sessionsDir()
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }

  const jsonFiles = entries.filter((name) => name.endsWith('.json'))
  const sessions: SessionInfo[] = []

  for (const name of jsonFiles) {
    try {
      const raw = await fs.readFile(join(dir, name), 'utf-8')
      const parsed = parseRegistryFile(JSON.parse(raw))
      if (parsed) sessions.push(parsed)
    } catch {
      // skip malformed/partial file
    }
  }

  return sessions
}

import { promises as fs } from 'fs'
import { join } from 'path'
import { CLAUDE_ACCOUNTS } from '../../shared/types'
import type { ClaudeAccountId, SessionInfo, SessionStatus } from '../../shared/types'
import { accountConfigDir } from '../accounts'
import { readJsonFile } from '../lib/atomicWrite'

export function sessionsDir(account: ClaudeAccountId = 1): string {
  return join(accountConfigDir(account), 'sessions')
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

let lastGood = new Map<string, SessionInfo>()

/**
 * Enumerate and parse `~/.claude/sessions/*.json`. A malformed or partial
 * file (e.g. read mid-write) falls back to its last successful parse; files
 * that have never parsed are skipped rather than throwing.
 */
export async function readRegistry(): Promise<SessionInfo[]> {
  const next = new Map<string, SessionInfo>()

  for (const { id: account } of CLAUDE_ACCOUNTS) {
    const dir = sessionsDir(account)
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      continue
    }

    for (const name of entries.filter((n) => n.endsWith('.json'))) {
      const path = join(dir, name)
      let parsed: SessionInfo | null = null
      try {
        parsed = parseRegistryFile(await readJsonFile<unknown>(path, null))
      } catch {
        // partial/unreadable file: fall back to last-good
      }
      if (parsed) parsed.account = account
      const info = parsed ?? lastGood.get(path)
      if (info) next.set(path, info)
    }
  }

  lastGood = next
  return [...next.values()]
}

import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'

export interface TranscriptEnrichment {
  aiTitle?: string
  model?: string
  totalTokens?: number
}

interface FileState extends TranscriptEnrichment {
  offset: number
  remainder: string
  totalTokens: number
}

export function projectsDir(): string {
  return join(os.homedir(), '.claude', 'projects')
}

const fileStates = new Map<string, FileState>()
const sessionPathCache = new Map<string, string>()

function newState(): FileState {
  return { offset: 0, remainder: '', totalTokens: 0 }
}

function sumUsageTokens(usage: unknown): number {
  if (typeof usage !== 'object' || usage === null) return 0
  const record = usage as Record<string, unknown>
  const fields = [
    'input_tokens',
    'output_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens'
  ]
  let sum = 0
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'number') sum += value
  }
  return sum
}

function applyLine(state: FileState, line: string): void {
  if (!line.trim()) return
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return
  }
  if (typeof parsed !== 'object' || parsed === null) return
  const obj = parsed as Record<string, unknown>

  if (typeof obj.aiTitle === 'string') {
    state.aiTitle = obj.aiTitle
  }

  const message = obj.message
  if (typeof message === 'object' && message !== null) {
    const messageRecord = message as Record<string, unknown>
    if (typeof messageRecord.model === 'string') {
      state.model = messageRecord.model
    }
    if (messageRecord.usage !== undefined) {
      state.totalTokens += sumUsageTokens(messageRecord.usage)
    }
  }
}

/**
 * Locate a session's transcript file by scanning each project directory for
 * `<sessionId>.jsonl` under `~/.claude/projects/`. Result is cached per
 * sessionId.
 */
export async function locateTranscript(sessionId: string): Promise<string | null> {
  const cached = sessionPathCache.get(sessionId)
  if (cached) {
    try {
      await fs.access(cached)
      return cached
    } catch {
      sessionPathCache.delete(sessionId)
    }
  }

  const root = projectsDir()
  let projectDirs: string[]
  try {
    projectDirs = await fs.readdir(root)
  } catch {
    return null
  }

  for (const dir of projectDirs) {
    const candidate = join(root, dir, `${sessionId}.jsonl`)
    try {
      await fs.access(candidate)
      sessionPathCache.set(sessionId, candidate)
      return candidate
    } catch {
      // not here, keep scanning
    }
  }

  return null
}

/**
 * Incrementally tail a transcript file: reads only appended bytes since the
 * last known byte offset for `filePath`, parses complete lines (carrying a
 * partial trailing line across calls), and merges into the running
 * enrichment (latest aiTitle, latest model, running token sum). Handles
 * truncation (offset beyond current size) by resetting.
 */
export async function tailTranscript(filePath: string): Promise<TranscriptEnrichment> {
  let state = fileStates.get(filePath)
  if (!state) {
    state = newState()
    fileStates.set(filePath, state)
  }

  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    return { aiTitle: state.aiTitle, model: state.model, totalTokens: state.totalTokens }
  }

  if (stat.size < state.offset) {
    // File was truncated/rotated: reset and re-read from scratch.
    state = newState()
    fileStates.set(filePath, state)
  }

  if (stat.size > state.offset) {
    const handle = await fs.open(filePath, 'r')
    try {
      const length = stat.size - state.offset
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, state.offset)
      state.offset = stat.size

      const chunk = state.remainder + buffer.toString('utf-8')
      const lines = chunk.split('\n')
      state.remainder = lines.pop() ?? ''

      for (const line of lines) {
        applyLine(state, line)
      }
    } finally {
      await handle.close()
    }
  }

  return { aiTitle: state.aiTitle, model: state.model, totalTokens: state.totalTokens }
}

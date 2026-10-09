import { app } from 'electron'
import { join } from 'path'
import type { PersistedTerminalsState } from '../../shared/types'
import { readJsonFile, writeJsonFile } from '../lib/atomicWrite'
import { restoreLog } from '../lib/restoreLog'

function filePath(): string {
  return join(app.getPath('userData'), 'terminals.json')
}

let cache: PersistedTerminalsState | null = null

export async function loadPersisted(): Promise<PersistedTerminalsState> {
  if (cache) {
    restoreLog('load', { fromCache: true, count: cache.terminals.length })
    return cache
  }
  try {
    cache = await readJsonFile<PersistedTerminalsState>(filePath(), {
      terminals: [],
      activeSessionByProject: {}
    })
  } catch (err) {
    restoreLog('load:error', { error: String(err) })
    throw err
  }
  restoreLog('load', {
    fromCache: false,
    count: cache.terminals.length,
    sessionIds: cache.terminals.map((t) => t.sessionId)
  })
  return cache
}

export async function savePersisted(state: PersistedTerminalsState): Promise<void> {
  const prev = cache?.terminals.length ?? 0
  cache = state
  restoreLog('save', {
    count: state.terminals.length,
    prevCount: prev,
    sessionIds: state.terminals.map((t) => t.sessionId)
  })
  try {
    await writeJsonFile(filePath(), state)
  } catch (err) {
    restoreLog('save:error', { error: String(err) })
    throw err
  }
}

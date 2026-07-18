import { app } from 'electron'
import { join } from 'path'
import type { PersistedTerminalsState } from '../../shared/types'
import { readJsonFile, writeJsonFile } from '../lib/atomicWrite'

function filePath(): string {
  return join(app.getPath('userData'), 'terminals.json')
}

let cache: PersistedTerminalsState | null = null

export async function loadPersisted(): Promise<PersistedTerminalsState> {
  if (cache) return cache
  cache = await readJsonFile<PersistedTerminalsState>(filePath(), {
    terminals: [],
    activeSessionByProject: {}
  })
  return cache
}

export async function savePersisted(state: PersistedTerminalsState): Promise<void> {
  cache = state
  await writeJsonFile(filePath(), state)
}

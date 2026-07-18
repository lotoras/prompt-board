import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { SyncConfig } from '../../shared/types'
import { readJsonFile, writeJsonFile } from '../lib/atomicWrite'

export interface OutboxOp {
  id: string
  table: 'projects' | 'cards'
  row: Record<string, unknown>
}

export interface OutboxState {
  ops: OutboxOp[]
  lastPulledAt?: number
}

function configPath(): string {
  return join(app.getPath('userData'), 'sync.json')
}

function outboxPath(): string {
  return join(app.getPath('userData'), 'sync-outbox.json')
}

let configCache: SyncConfig | null | undefined
let outboxCache: OutboxState | null = null

export async function loadSyncConfig(): Promise<SyncConfig | null> {
  if (configCache !== undefined) return configCache
  configCache = await readJsonFile<SyncConfig | null>(configPath(), null)
  return configCache
}

export async function saveSyncConfig(config: SyncConfig | null): Promise<void> {
  configCache = config
  if (config === null) {
    configCache = null
    await fs.rm(configPath(), { force: true })
    return
  }
  await writeJsonFile(configPath(), config)
}

export async function saveSessionTokens(session: {
  accessToken: string
  refreshToken: string
}): Promise<void> {
  const config = await loadSyncConfig()
  if (!config) return
  await saveSyncConfig({ ...config, session })
}

export async function loadOutbox(): Promise<OutboxState> {
  if (outboxCache) return outboxCache
  outboxCache = await readJsonFile<OutboxState>(outboxPath(), { ops: [] })
  return outboxCache
}

export async function saveOutbox(state: OutboxState): Promise<void> {
  outboxCache = state
  await writeJsonFile(outboxPath(), state)
}

/** Test-only: clear in-memory caches so a fresh load re-reads from disk. */
export function resetSyncCaches(): void {
  configCache = undefined
  outboxCache = null
}

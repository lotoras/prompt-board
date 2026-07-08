import type { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { IPC_CHANNELS } from '../../shared/types'
import type {
  CardLink,
  KanbanCard,
  Project,
  SyncConfig,
  SyncConfigureInput,
  SyncStatus
} from '../../shared/types'
import { loadOutbox, loadSyncConfig, saveOutbox, saveSyncConfig, type OutboxOp } from './config'
import { applyRemoteProject, deleteProject, listProjects } from '../projects/store'
import { applyRemoteCard, deleteCardById, getBoards } from '../kanban/store'

interface RemoteProjectRow {
  project_key: string
  name: string
  base_path: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  device_id: string
}

interface RemoteCardRow {
  id: string
  project_key: string
  column_id: string
  title: string
  body: string
  tags: string[]
  order: string
  link: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  device_id: string
}

const SUPABASE_OPTS = { auth: { persistSession: false, autoRefreshToken: true } }
const MIN_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 60000

let client: SupabaseClient | null = null
let channel: RealtimeChannel | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let backoffMs = MIN_BACKOFF_MS
let getWindowRef: (() => BrowserWindow | null) | null = null
let applyingRemote = false
let lastRemoteSeenMs = 0
let status: SyncStatus = { state: 'disabled', pendingOps: 0 }

export function isApplyingRemote(): boolean {
  return applyingRemote
}

/** Clock-skew guard: local mutation timestamps never fall behind the newest remote timestamp seen. */
export function nextTimestamp(): number {
  return Math.max(Date.now(), lastRemoteSeenMs + 1)
}

function noteRemoteTimestamp(ms: number): void {
  if (ms > lastRemoteSeenMs) lastRemoteSeenMs = ms
}

export function shouldApplyRemote(remoteUpdatedAt: number, localUpdatedAt: number | undefined): boolean {
  if (localUpdatedAt === undefined) return true
  return remoteUpdatedAt > localUpdatedAt
}

export function getSyncStatus(): SyncStatus {
  return status
}

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  const win = getWindowRef?.()
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.sync.status, status)
  }
}

function projectToRow(project: Project, deviceId: string, deletedAtMs?: number): RemoteProjectRow {
  return {
    project_key: project.projectKey,
    name: project.name,
    base_path: project.basePath,
    created_at: new Date(project.createdAt).toISOString(),
    updated_at: new Date(project.updatedAt).toISOString(),
    deleted_at: deletedAtMs ? new Date(deletedAtMs).toISOString() : null,
    device_id: deviceId
  }
}

function rowToProject(row: RemoteProjectRow): Project {
  return {
    projectKey: row.project_key,
    name: row.name,
    basePath: row.base_path,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime()
  }
}

function cardToRow(card: KanbanCard, deviceId: string, deletedAtMs?: number): RemoteCardRow {
  return {
    id: card.id,
    project_key: card.projectKey,
    column_id: card.columnId,
    title: card.title,
    body: card.body,
    tags: card.tags,
    order: card.order,
    link: card.link ? JSON.stringify(card.link) : null,
    created_at: new Date(card.createdAt).toISOString(),
    updated_at: new Date(card.updatedAt).toISOString(),
    deleted_at: deletedAtMs ? new Date(deletedAtMs).toISOString() : null,
    device_id: deviceId
  }
}

function rowToCard(row: RemoteCardRow): KanbanCard {
  return {
    id: row.id,
    projectKey: row.project_key,
    columnId: row.column_id,
    title: row.title,
    body: row.body,
    tags: row.tags ?? [],
    order: row.order,
    link: row.link ? (JSON.parse(row.link) as CardLink) : undefined,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime()
  }
}

/** Queue a raw remote row for push; a no-op until sync has been configured. */
async function enqueueRow(table: 'projects' | 'cards', row: Record<string, unknown>): Promise<void> {
  const config = await loadSyncConfig()
  if (!config) return
  const key = table === 'projects' ? (row.project_key as string) : (row.id as string)
  const id = `${table}:${key}`
  const outbox = await loadOutbox()
  const ops: OutboxOp[] = [...outbox.ops.filter((op) => op.id !== id), { id, table, row }]
  await saveOutbox({ ...outbox, ops })
  setStatus({ pendingOps: ops.length })
  scheduleFlush(0)
}

/** Called by the projects store after every local mutation (skipped while applying a remote change). */
export async function enqueueProject(project: Project, deletedAtMs?: number): Promise<void> {
  if (applyingRemote) return
  const config = await loadSyncConfig()
  if (!config) return
  await enqueueRow('projects', projectToRow(project, config.deviceId, deletedAtMs) as unknown as Record<string, unknown>)
}

/** Called by the kanban store after every local mutation (skipped while applying a remote change). */
export async function enqueueCard(card: KanbanCard, deletedAtMs?: number): Promise<void> {
  if (applyingRemote) return
  const config = await loadSyncConfig()
  if (!config) return
  await enqueueRow('cards', cardToRow(card, config.deviceId, deletedAtMs) as unknown as Record<string, unknown>)
}

function scheduleFlush(delayMs: number): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    void flush()
  }, delayMs)
}

async function flush(): Promise<void> {
  if (!client) return
  const outbox = await loadOutbox()
  const [op, ...rest] = outbox.ops
  if (!op) {
    backoffMs = MIN_BACKOFF_MS
    return
  }
  try {
    const onConflict = op.table === 'projects' ? 'user_id,project_key' : 'user_id,id'
    const { error } = await client.from(op.table).upsert(op.row, { onConflict })
    if (error) throw error
    await saveOutbox({ ...outbox, ops: rest })
    backoffMs = MIN_BACKOFF_MS
    setStatus({ pendingOps: rest.length, state: 'online', lastSyncAt: Date.now(), error: undefined })
    if (rest.length > 0) scheduleFlush(0)
  } catch (err) {
    setStatus({ state: 'offline', error: err instanceof Error ? err.message : String(err) })
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
    scheduleFlush(backoffMs)
  }
}

async function mergeRemoteProject(row: RemoteProjectRow, myDeviceId: string): Promise<void> {
  if (row.device_id === myDeviceId) return
  const remoteUpdatedAt = new Date(row.updated_at).getTime()
  noteRemoteTimestamp(remoteUpdatedAt)
  const local = (await listProjects()).find((p) => p.projectKey === row.project_key)
  if (!shouldApplyRemote(remoteUpdatedAt, local?.updatedAt)) return
  applyingRemote = true
  try {
    if (row.deleted_at) {
      await deleteProject(row.project_key)
    } else {
      await applyRemoteProject(rowToProject(row))
    }
  } finally {
    applyingRemote = false
  }
}

async function mergeRemoteCard(row: RemoteCardRow, myDeviceId: string): Promise<void> {
  if (row.device_id === myDeviceId) return
  const remoteUpdatedAt = new Date(row.updated_at).getTime()
  noteRemoteTimestamp(remoteUpdatedAt)
  const local = (await getBoards()).cards.find((c) => c.id === row.id)
  if (!shouldApplyRemote(remoteUpdatedAt, local?.updatedAt)) return
  applyingRemote = true
  try {
    if (row.deleted_at) {
      await deleteCardById(row.id)
    } else {
      await applyRemoteCard(rowToCard(row))
    }
  } finally {
    applyingRemote = false
  }
}

async function unionPushLocal(
  remoteProjects: RemoteProjectRow[],
  remoteCards: RemoteCardRow[],
  deviceId: string
): Promise<void> {
  const remoteProjectMap = new Map(remoteProjects.map((r) => [r.project_key, r]))
  for (const project of await listProjects()) {
    const remote = remoteProjectMap.get(project.projectKey)
    if (!remote || new Date(remote.updated_at).getTime() < project.updatedAt) {
      await enqueueRow('projects', projectToRow(project, deviceId) as unknown as Record<string, unknown>)
    }
  }
  const remoteCardMap = new Map(remoteCards.map((r) => [r.id, r]))
  const { cards } = await getBoards()
  for (const card of cards) {
    const remote = remoteCardMap.get(card.id)
    if (!remote || new Date(remote.updated_at).getTime() < card.updatedAt) {
      await enqueueRow('cards', cardToRow(card, deviceId) as unknown as Record<string, unknown>)
    }
  }
}

async function pull(config: SyncConfig): Promise<void> {
  if (!client) return
  const outbox = await loadOutbox()
  const since = outbox.lastPulledAt
  const isFirstSync = since === undefined

  const projectsQuery = client.from('projects').select('*')
  const cardsQuery = client.from('cards').select('*')
  const [projectsRes, cardsRes] = await Promise.all([
    since !== undefined ? projectsQuery.gt('updated_at', new Date(since).toISOString()) : projectsQuery,
    since !== undefined ? cardsQuery.gt('updated_at', new Date(since).toISOString()) : cardsQuery
  ])
  if (projectsRes.error) throw projectsRes.error
  if (cardsRes.error) throw cardsRes.error

  const remoteProjects = (projectsRes.data ?? []) as RemoteProjectRow[]
  const remoteCards = (cardsRes.data ?? []) as RemoteCardRow[]

  for (const row of remoteProjects) await mergeRemoteProject(row, config.deviceId)
  for (const row of remoteCards) await mergeRemoteCard(row, config.deviceId)

  if (isFirstSync) {
    await unionPushLocal(remoteProjects, remoteCards, config.deviceId)
  }

  const latest = await loadOutbox()
  await saveOutbox({ ...latest, lastPulledAt: Date.now() })
}

function subscribeRealtime(config: SyncConfig): void {
  if (!client) return
  channel = client
    .channel('prompt-board-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'projects' },
      (payload) => {
        void mergeRemoteProject(payload.new as RemoteProjectRow, config.deviceId)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cards' },
      (payload) => {
        void mergeRemoteCard(payload.new as RemoteCardRow, config.deviceId)
      }
    )
    .subscribe((subStatus) => {
      if (subStatus === 'SUBSCRIBED') setStatus({ state: 'online' })
      else if (subStatus === 'CHANNEL_ERROR' || subStatus === 'TIMED_OUT') {
        setStatus({ state: 'offline' })
      }
    })
}

export async function startSync(getWindow: () => BrowserWindow | null): Promise<void> {
  getWindowRef = getWindow
  const config = await loadSyncConfig()
  if (!config || !config.session) {
    setStatus({ state: 'disabled', pendingOps: 0 })
    return
  }
  setStatus({ state: 'connecting' })
  client = createClient(config.url, config.anonKey, SUPABASE_OPTS)
  await client.auth.setSession({
    access_token: config.session.accessToken,
    refresh_token: config.session.refreshToken
  })
  subscribeRealtime(config)
  try {
    await pull(config)
    setStatus({ state: 'online', lastSyncAt: Date.now(), error: undefined })
  } catch (err) {
    setStatus({ state: 'error', error: err instanceof Error ? err.message : String(err) })
  }
  const pendingOps = (await loadOutbox()).ops.length
  setStatus({ pendingOps })
  scheduleFlush(0)
}

export function stopSync(): void {
  if (channel) {
    void channel.unsubscribe()
    channel = null
  }
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  client = null
  backoffMs = MIN_BACKOFF_MS
  setStatus({ state: 'disabled', pendingOps: 0, error: undefined })
}

export async function configure(
  input: SyncConfigureInput,
  getWindow: () => BrowserWindow | null
): Promise<SyncStatus> {
  const authClient = createClient(input.url, input.anonKey, SUPABASE_OPTS)
  const { data, error } = await authClient.auth.signInWithPassword({
    email: input.email,
    password: input.password
  })
  if (error || !data.session) {
    throw new Error(error?.message ?? 'Sign-in failed')
  }
  const existing = await loadSyncConfig()
  const config: SyncConfig = {
    url: input.url,
    anonKey: input.anonKey,
    email: input.email,
    deviceId: existing?.deviceId ?? randomUUID(),
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token
    }
  }
  await saveSyncConfig(config)
  stopSync()
  await startSync(getWindow)
  return getSyncStatus()
}

export async function signOut(): Promise<void> {
  stopSync()
  await saveSyncConfig(null)
  await saveOutbox({ ops: [] })
}

import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { IPC_CHANNELS } from '../../shared/types'
import type {
  CardLink,
  KanbanCard,
  Project,
  SyncConfig,
  SyncConfigureInput,
  SyncConfigView,
  SyncStatus
} from '../../shared/types'
import {
  loadOutbox,
  loadSyncConfig,
  saveOutbox,
  saveSessionTokens,
  saveSyncConfig,
  type OutboxOp
} from './config'
import { decryptSecret, encryptSecret } from './secret'
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
  due_date: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  device_id: string
}

function errMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

const SUPABASE_OPTS = { auth: { persistSession: false, autoRefreshToken: true } }
/**
 * For a sign-in-only client whose session is handed to the main client. In Node the auto-refresh
 * ticker never stops by itself, and Supabase refresh tokens are single-use: two clients refreshing
 * one session reuse a spent token, and Supabase then revokes the session.
 */
const SIGN_IN_ONLY_OPTS = { auth: { persistSession: false, autoRefreshToken: false } }
const MIN_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 60000

let client: SupabaseClient | null = null
let channel: RealtimeChannel | null = null
let authSub: { unsubscribe: () => void } | null = null
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
    due_date: card.dueDate || null,
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
    dueDate: row.due_date ?? undefined,
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
    setStatus({ state: 'offline', error: errMessage(err) })
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
  if (!config) {
    setStatus({ state: 'disabled', pendingOps: 0 })
    return
  }
  setStatus({ state: 'connecting' })
  const c = createClient(config.url, config.anonKey, SUPABASE_OPTS)
  client = c
  started = false
  const { data: authListener } = c.auth.onAuthStateChange((event, session) => {
    syncLog('auth', { event })
    if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session) {
      void saveSessionTokens({
        accessToken: session.access_token,
        refreshToken: session.refresh_token
      })
    } else if (event === 'SIGNED_OUT' && started) {
      // A refresh failed for good (revoked / expired refresh token). Defer: auth calls inside
      // this callback would deadlock the auth lock.
      setTimeout(() => {
        if (client === c) void connect(c, false)
      }, 0)
    }
  })
  authSub = authListener.subscription
  await connect(c, true)
}

/**
 * Network / server-side failures (offline, DNS, 429, 5xx) are transient: retry them. Any other
 * auth error (wrong password, revoked token) needs the user.
 */
function isTransient(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const { name, status } = e as { name?: unknown; status?: unknown }
  if (name === 'AuthRetryableFetchError') return true
  return typeof status === 'number' && (status === 0 || status === 429 || status >= 500)
}

type AuthOutcome = { ok: true } | { ok: false; transient: boolean; error?: string }
const DENIED: AuthOutcome = { ok: false, transient: false }

function failure(e: unknown): AuthOutcome {
  return { ok: false, transient: isTransient(e), error: errMessage(e) }
}

/** Sign in with the safeStorage-encrypted password; the SIGNED_IN listener persists the tokens. */
async function signInWithStoredPassword(c: SupabaseClient, config: SyncConfig): Promise<AuthOutcome> {
  const pw = config.encryptedPassword ? decryptSecret(config.encryptedPassword) : null
  if (!pw) return DENIED
  const { data, error } = await c.auth.signInWithPassword({ email: config.email, password: pw })
  if (error) return failure(error)
  if (!data.session) return DENIED
  await saveSessionTokens({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token
  })
  return { ok: true }
}

/** Resume the saved session if it still works, else sign in with the stored password. */
async function authenticate(c: SupabaseClient, config: SyncConfig, useSession: boolean): Promise<AuthOutcome> {
  if (useSession && config.session) {
    const { error: setError } = await c.auth.setSession({
      access_token: config.session.accessToken,
      refresh_token: config.session.refreshToken
    })
    if (setError && isTransient(setError)) return failure(setError)
    if (!setError) {
      const { error } = await c.auth.getUser()
      if (!error) return { ok: true }
      if (isTransient(error)) return failure(error)
    }
  }
  return signInWithStoredPassword(c, config)
}

let started = false
let connecting: { c: SupabaseClient; done: Promise<void> } | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectBackoffMs = MIN_BACKOFF_MS

/**
 * Sign in, subscribe, pull and flush. A transient failure (no network after sleep / boot) keeps
 * retrying with backoff instead of giving up, so the connection comes back by itself.
 */
function connect(c: SupabaseClient, useSession: boolean): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (connecting?.c === c) return connecting.done
  const done = (async () => {
    try {
      const config = await loadSyncConfig()
      if (!config || client !== c) return
      setStatus({ state: 'connecting' })
      const outcome = await authenticate(c, config, useSession)
      syncLog('connect', { useSession, ...outcome })
      if (client !== c) return
      if (!outcome.ok) {
        if (outcome.transient) {
          setStatus({ state: 'offline', error: outcome.error })
          const delay = reconnectBackoffMs
          reconnectBackoffMs = Math.min(reconnectBackoffMs * 2, MAX_BACKOFF_MS)
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            if (client === c) void connect(c, useSession)
          }, delay)
        } else {
          setStatus({ state: 'error', error: 'Sign-in required' })
        }
        return
      }
      reconnectBackoffMs = MIN_BACKOFF_MS
      started = true
      if (!channel) subscribeRealtime(config)
      try {
        await pull(config)
        setStatus({ state: 'online', lastSyncAt: Date.now(), error: undefined })
      } catch (err) {
        setStatus({ state: 'error', error: errMessage(err) })
      }
      setStatus({ pendingOps: (await loadOutbox()).ops.length })
      scheduleFlush(0)
    } finally {
      if (connecting?.c === c) connecting = null
    }
  })()
  connecting = { c, done }
  return done
}

/** Append-only auth diagnostics in userData/sync-debug.log. Never logs tokens or passwords. */
function syncLog(event: string, data: Record<string, unknown> = {}): void {
  try {
    appendFileSync(
      join(app.getPath('userData'), 'sync-debug.log'),
      `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`
    )
  } catch {
    // diagnostics must never break sync
  }
}

export function stopSync(): void {
  if (client) {
    // The Node auto-refresh ticker outlives the client reference; stop it so an old client
    // never refreshes (and so revokes) the session the next client uses.
    void client.auth.stopAutoRefresh()
    void client.removeAllChannels()
  }
  if (channel) {
    void channel.unsubscribe()
    channel = null
  }
  if (authSub) {
    authSub.unsubscribe()
    authSub = null
  }
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  client = null
  started = false
  backoffMs = MIN_BACKOFF_MS
  reconnectBackoffMs = MIN_BACKOFF_MS
  setStatus({ state: 'disabled', pendingOps: 0, error: undefined })
}

export async function configure(
  input: SyncConfigureInput,
  getWindow: () => BrowserWindow | null
): Promise<SyncStatus> {
  const existing = await loadSyncConfig()
  // An empty field means "use the saved password" (the form shows it as "•••••• (saved)").
  const password =
    input.password ||
    (existing?.encryptedPassword && existing.email === input.email
      ? decryptSecret(existing.encryptedPassword)
      : null)
  if (!password) throw new Error('Enter your password')
  const authClient = createClient(input.url, input.anonKey, SIGN_IN_ONLY_OPTS)
  const { data, error } = await authClient.auth.signInWithPassword({
    email: input.email,
    password
  })
  if (error || !data.session) {
    throw new Error(error?.message ?? 'Sign-in failed')
  }
  const config: SyncConfig = {
    url: input.url,
    anonKey: input.anonKey,
    email: input.email,
    deviceId: existing?.deviceId ?? randomUUID(),
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token
    },
    encryptedPassword: encryptSecret(password) ?? undefined
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

export async function getConfigView(): Promise<SyncConfigView | null> {
  const config = await loadSyncConfig()
  if (!config) return null
  return {
    url: config.url,
    anonKey: config.anonKey,
    email: config.email,
    hasPassword: !!config.encryptedPassword
  }
}

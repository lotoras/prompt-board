import { app, type BrowserWindow } from 'electron'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import os from 'os'
import { basename, join } from 'path'
import { pathToFileURL } from 'url'
import { DEFAULT_TOGGLES } from '../../shared/chat'
import {
  IPC_CHANNELS,
  type ChatCreateInput,
  type ChatCreateResult,
  type ChatItem,
  type ChatItemsEvent,
  type ChatMeta,
  type ChatMode,
  type ChatPatch,
  type ChatSendInput,
  type PersistedChat,
  type PersistedChatsState,
  type PlanDecision,
  type SessionInfo,
  type SessionsSnapshot
} from '../../shared/types'
import { getBoards, mutateKanban } from '../kanban/store'
import { gitInfo, prepareWorkspace } from '../git/git'
import { listProjects } from '../projects/store'
import { killPty, spawnPty } from '../pty/manager'
import type { StatusOverlayEntry } from '../sessions/merge'
import { locateTranscript } from '../sessions/transcript'
import {
  buildCurrentSnapshot,
  onSnapshot,
  refreshSnapshotNow,
  setStatusOverlayProvider
} from '../sessions/watcher'
import { readImage } from './attachments'
import { loadClaudeDefaults } from './defaults'
import { createChatRunner, type ChatRunner } from './runner'
import { loadChatsState, saveChatsState } from './store'
import {
  createParserState,
  getItems,
  getMeta,
  parseLines,
  type ParserState
} from './transcriptParser'

const SDK_MODULE = '@anthropic-ai/claude-agent-sdk'
const BROADCAST_MS = 50
const TITLE_MAX = 60
const PLACEHOLDER_TITLES = new Set(['New chat', 'Chat'])

interface Live {
  mode: ChatMode
  ptyId?: string
  contextTokens?: number
  contextWindow?: number
}

interface Tail {
  path: string
  offset: number
  busy: boolean
}

interface Ctx {
  getWindow: () => BrowserWindow | null
  state: PersistedChatsState
  runner: ChatRunner
  overlay: Map<string, StatusOverlayEntry>
  live: Map<string, Live>
  parsers: Map<string, ParserState>
  tails: Map<string, Tail>
  histories: Map<string, Promise<void>>
  firstSends: Set<string>
  snapshot: SessionsSnapshot | null
  unsubscribe: () => void
  broadcastTimer: ReturnType<typeof setTimeout> | null
  saveChain: Promise<void>
  ready: Promise<void>
}

let ctx: Ctx | null = null

function need(): Ctx {
  if (!ctx) throw new Error('Chat service is not initialised')
  return ctx
}

// ---------------------------------------------------------------------------
// Default runner dependencies
// ---------------------------------------------------------------------------

let cachedClaudePath: string | undefined

function claudePath(): string {
  if (cachedClaudePath) return cachedClaudePath
  const fallback = join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    cachedClaudePath =
      (process.platform === 'win32' ? lines.find((l) => /\.exe$/i.test(l)) : undefined) ??
      lines[0] ??
      fallback
  } catch {
    cachedClaudePath = fallback
  }
  return cachedClaudePath
}

/** The SDK module is loaded untyped (ESM-only, real dynamic import); the runner narrows its use. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkModule = any

async function loadSdk(): Promise<SdkModule> {
  // The SDK is ESM-only; a plain import() would be rewritten to require() in the CJS main bundle.
  const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<SdkModule>
  try {
    return await dynamicImport(SDK_MODULE)
  } catch (err) {
    const entry = join(app.getAppPath(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs')
    try {
      return await dynamicImport(pathToFileURL(entry).href)
    } catch {
      throw err
    }
  }
}

// ---------------------------------------------------------------------------
// Meta assembly
// ---------------------------------------------------------------------------

function parserFor(chatId: string): ParserState {
  const c = need()
  let p = c.parsers.get(chatId)
  if (!p) {
    const cwd = c.state.chats.find((x) => x.chatId === chatId)?.cwd
    p = createParserState(cwd)
    c.parsers.set(chatId, p)
  }
  return p
}

function sessionIndex(): Map<string, { session: SessionInfo; projectKey: string }> {
  const index = new Map<string, { session: SessionInfo; projectKey: string }>()
  for (const project of need().snapshot?.projects ?? []) {
    for (const session of project.sessions) {
      index.set(session.sessionId, { session, projectKey: project.projectKey })
    }
  }
  return index
}

function ownMeta(
  chat: PersistedChat,
  index: Map<string, { session: SessionInfo; projectKey: string }>
): ChatMeta {
  const c = need()
  const live = c.live.get(chat.chatId)
  const session = index.get(chat.sessionId)?.session
  const o = c.overlay.get(chat.sessionId)
  const parserMeta = c.parsers.has(chat.chatId) ? getMeta(parserFor(chat.chatId)) : undefined

  let status: ChatMeta['status'] = 'idle'
  let waitingFor: string | undefined
  let statusUpdatedAt: number | undefined
  let acknowledged: boolean | undefined = true
  if (o) {
    status = o.status
    waitingFor = o.waitingFor
    statusUpdatedAt = o.statusUpdatedAt
    acknowledged = session?.statusUpdatedAt === o.statusUpdatedAt ? session.acknowledged : false
  } else if (session) {
    status = session.status
    waitingFor = session.waitingFor
    statusUpdatedAt = session.statusUpdatedAt
    acknowledged = session.acknowledged
  }

  const title =
    PLACEHOLDER_TITLES.has(chat.title) && (session?.aiTitle ?? parserMeta?.aiTitle)
      ? ((session?.aiTitle ?? parserMeta?.aiTitle) as string)
      : chat.title

  return {
    ...chat,
    title,
    status,
    ...(waitingFor !== undefined ? { waitingFor } : {}),
    ...(acknowledged !== undefined ? { acknowledged } : {}),
    ...(statusUpdatedAt !== undefined ? { statusUpdatedAt } : {}),
    mode: live?.mode ?? 'sdk',
    contextTokens: live?.contextTokens ?? parserMeta?.contextTokens,
    contextWindow: live?.contextWindow,
    totalTokens: session?.totalTokens ?? parserMeta?.totalTokens
  }
}

function externalMeta(session: SessionInfo, projectKey: string): ChatMeta {
  const chatId = 'ext:' + session.sessionId
  const parserMeta = need().parsers.has(chatId) ? getMeta(parserFor(chatId)) : undefined
  return {
    chatId,
    projectKey,
    sessionId: session.sessionId,
    title: session.name || session.aiTitle || basename(session.cwd) || 'Session',
    cwd: session.cwd,
    ...(parserMeta?.gitBranch ? { branch: parserMeta.gitBranch } : {}),
    model: session.model ?? parserMeta?.model ?? '',
    effort: parserMeta?.effort ?? 'high',
    toggles: DEFAULT_TOGGLES,
    contextTokens: parserMeta?.contextTokens,
    totalTokens: session.totalTokens ?? parserMeta?.totalTokens,
    status: session.status,
    ...(session.waitingFor !== undefined ? { waitingFor: session.waitingFor } : {}),
    ...(session.acknowledged !== undefined ? { acknowledged: session.acknowledged } : {}),
    statusUpdatedAt: session.statusUpdatedAt,
    mode: 'external',
    started: true,
    createdAt: session.startedAt,
    updatedAt: session.updatedAt
  }
}

function buildMetas(): ChatMeta[] {
  const c = need()
  const index = sessionIndex()
  const own = c.state.chats.map((chat) => ownMeta(chat, index))
  const ownSessions = new Set(c.state.chats.map((chat) => chat.sessionId))
  const externals: ChatMeta[] = []
  for (const { session, projectKey } of index.values()) {
    if (!ownSessions.has(session.sessionId)) externals.push(externalMeta(session, projectKey))
  }
  return [...own, ...externals]
}

function findOwn(chatId: string): PersistedChat | undefined {
  return need().state.chats.find((chat) => chat.chatId === chatId)
}

function metaFor(chatId: string): ChatMeta | undefined {
  return buildMetas().find((m) => m.chatId === chatId)
}

// ---------------------------------------------------------------------------
// Broadcast + persistence
// ---------------------------------------------------------------------------

function scheduleBroadcast(): void {
  const c = need()
  if (c.broadcastTimer) return
  c.broadcastTimer = setTimeout(() => {
    c.broadcastTimer = null
    const win = c.getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC_CHANNELS.chat.changed, buildMetas())
  }, BROADCAST_MS)
}

function sendItems(event: ChatItemsEvent): void {
  const win = need().getWindow()
  if (win && !win.isDestroyed()) win.webContents.send(IPC_CHANNELS.chat.items, event)
}

function persist(): Promise<void> {
  const c = need()
  const snapshot: PersistedChatsState = {
    chats: c.state.chats.map((chat) => ({ ...chat })),
    activeByProject: { ...c.state.activeByProject }
  }
  c.saveChain = c.saveChain
    .catch(() => {})
    .then(() => saveChatsState(snapshot))
    .catch((err) => console.error('saveChatsState failed', err))
  return c.saveChain
}

function changed(): void {
  void persist()
  scheduleBroadcast()
}

// ---------------------------------------------------------------------------
// Transcript history + live tail
// ---------------------------------------------------------------------------

async function readNewLines(tail: Tail): Promise<string[]> {
  let size: number
  try {
    size = (await fs.stat(tail.path)).size
  } catch {
    return []
  }
  if (size < tail.offset) tail.offset = 0
  if (size === tail.offset) return []
  const handle = await fs.open(tail.path, 'r')
  try {
    const buffer = Buffer.alloc(size - tail.offset)
    await handle.read(buffer, 0, buffer.length, tail.offset)
    const end = buffer.lastIndexOf(0x0a)
    if (end < 0) return []
    tail.offset += end + 1
    return buffer.subarray(0, end + 1).toString('utf-8').split('\n')
  } finally {
    await handle.close()
  }
}

function chatIdentity(chatId: string): { sessionId: string; cwd?: string } | undefined {
  const own = findOwn(chatId)
  if (own) return { sessionId: own.sessionId, cwd: own.cwd }
  if (chatId.startsWith('ext:')) {
    const sessionId = chatId.slice(4)
    return { sessionId, cwd: sessionIndex().get(sessionId)?.session.cwd }
  }
  return undefined
}

function ensureHistory(chatId: string): Promise<void> {
  const c = need()
  let pending = c.histories.get(chatId)
  if (!pending) {
    pending = (async () => {
      const identity = chatIdentity(chatId)
      if (!identity) return
      const path = await locateTranscript(identity.sessionId)
      if (!path) return
      const tail: Tail = { path, offset: 0, busy: false }
      c.tails.set(chatId, tail)
      const state = c.parsers.get(chatId) ?? createParserState(identity.cwd)
      c.parsers.set(chatId, state)
      if (state.items.size > 0) {
        tail.offset = (await fs.stat(path)).size
        return
      }
      parseLines(state, await readNewLines(tail))
    })().catch((err) => {
      c.histories.delete(chatId)
      console.error('chat history failed', err)
    })
    c.histories.set(chatId, pending)
  }
  return pending
}

async function tailChat(chatId: string): Promise<void> {
  const c = need()
  const tail = c.tails.get(chatId)
  if (!tail || tail.busy) return
  tail.busy = true
  try {
    const items = parseLines(parserFor(chatId), await readNewLines(tail))
    if (items.length) sendItems({ chatId, upsert: items })
  } catch (err) {
    console.error('chat tail failed', err)
  } finally {
    tail.busy = false
  }
}

function onNewSnapshot(snapshot: SessionsSnapshot): void {
  const c = need()
  c.snapshot = snapshot
  scheduleBroadcast()
  for (const chatId of c.tails.keys()) {
    const isExternal = chatId.startsWith('ext:')
    if (isExternal || c.live.get(chatId)?.mode === 'tui') void tailChat(chatId)
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function initChatService(getWindow: () => BrowserWindow | null): void {
  if (ctx) return
  const overlay = new Map<string, StatusOverlayEntry>()
  const c: Ctx = {
    getWindow,
    state: { chats: [], activeByProject: {} },
    runner: undefined as unknown as ChatRunner,
    overlay,
    live: new Map(),
    parsers: new Map(),
    tails: new Map(),
    histories: new Map(),
    firstSends: new Set(),
    snapshot: null,
    unsubscribe: () => {},
    broadcastTimer: null,
    saveChain: Promise.resolve(),
    ready: Promise.resolve()
  }
  ctx = c

  c.runner = createChatRunner({
    loadSdk,
    claudePath,
    readImage,
    parserFor,
    emitItems: sendItems,
    emitStatus(chatId, status, waitingFor) {
      const chat = findOwn(chatId)
      if (!chat) return
      if (status === 'idle') {
        overlay.delete(chat.sessionId)
        chat.updatedAt = Date.now()
        void persist()
      } else {
        const prev = overlay.get(chat.sessionId)
        if (!prev || prev.status !== status || prev.waitingFor !== waitingFor) {
          overlay.set(chat.sessionId, {
            status,
            ...(waitingFor !== undefined ? { waitingFor } : {}),
            statusUpdatedAt: Date.now()
          })
        }
      }
      void refreshSnapshotNow(getWindow)
      scheduleBroadcast()
    },
    emitMeta(chatId, patch) {
      const live = c.live.get(chatId) ?? { mode: 'sdk' as ChatMode }
      if (patch.contextTokens !== undefined) live.contextTokens = patch.contextTokens
      if (patch.contextWindow !== undefined) live.contextWindow = patch.contextWindow
      c.live.set(chatId, live)
      scheduleBroadcast()
    }
  })

  setStatusOverlayProvider(() => overlay)
  c.unsubscribe = onSnapshot(onNewSnapshot)

  c.ready = (async () => {
    c.state = await loadChatsState()
    c.snapshot = (await buildCurrentSnapshot().catch(() => null)) ?? c.snapshot
    scheduleBroadcast()
  })().catch((err) => console.error('chat service init failed', err))
}

async function ready(): Promise<Ctx> {
  const c = need()
  await c.ready
  return c
}

async function list(): Promise<{ chats: ChatMeta[]; activeByProject: Record<string, string> }> {
  const c = await ready()
  return { chats: buildMetas(), activeByProject: { ...c.state.activeByProject } }
}

async function create(input: ChatCreateInput): Promise<ChatCreateResult> {
  const c = await ready()
  if (input.resumeSessionId) {
    const existing = c.state.chats.find((chat) => chat.sessionId === input.resumeSessionId)
    if (existing) {
      c.state.activeByProject[existing.projectKey] = existing.chatId
      changed()
      return { chat: metaFor(existing.chatId) as ChatMeta, draftText: input.draftText }
    }
  }

  const project = (await listProjects()).find((p) => p.projectKey === input.projectKey)
  if (!project?.basePath) throw new Error(`Unknown project: ${input.projectKey}`)

  let cwd = project.basePath
  if (input.resumeSessionId) {
    const live = sessionIndex().get(input.resumeSessionId)?.session.cwd
    const linked = (await getBoards()).cards.find(
      (card) => card.link?.sessionId === input.resumeSessionId
    )?.link?.cwd
    cwd = live ?? linked ?? cwd
  }

  const defaults = await loadClaudeDefaults()
  const now = Date.now()
  const chat: PersistedChat = {
    chatId: randomUUID(),
    projectKey: input.projectKey,
    sessionId: input.resumeSessionId ?? randomUUID(),
    title: input.title ?? 'New chat',
    cwd,
    model: defaults.model,
    effort: defaults.effort,
    toggles: DEFAULT_TOGGLES,
    started: Boolean(input.resumeSessionId),
    ...(input.cardId ? { cardId: input.cardId } : {}),
    createdAt: now,
    updatedAt: now
  }

  let at = -1
  c.state.chats.forEach((other, i) => {
    if (other.projectKey === input.projectKey) at = i
  })
  if (at < 0) c.state.chats.push(chat)
  else c.state.chats.splice(at + 1, 0, chat)
  c.state.activeByProject[input.projectKey] = chat.chatId
  changed()
  return { chat: metaFor(chat.chatId) as ChatMeta, draftText: input.draftText }
}

async function update(chatId: string, patch: ChatPatch): Promise<ChatMeta> {
  const c = await ready()
  const chat = findOwn(chatId)
  if (!chat) throw new Error(`Unknown chat: ${chatId}`)
  const before = { model: chat.model, effort: chat.effort, ultra: chat.toggles.ultra }
  if (patch.model !== undefined) chat.model = patch.model
  if (patch.effort !== undefined) chat.effort = patch.effort
  if (patch.toggles !== undefined) chat.toggles = patch.toggles
  if (patch.title !== undefined) chat.title = patch.title
  chat.updatedAt = Date.now()

  if (c.runner.isRunning(chatId)) {
    if (chat.model !== before.model) await c.runner.setModel(chatId, chat.model)
    if (chat.effort !== before.effort || chat.toggles.ultra !== before.ultra) {
      await c.runner.setEffort(chatId, chat.effort, chat.toggles.ultra)
    }
  }
  changed()
  return metaFor(chatId) as ChatMeta
}

async function send(input: ChatSendInput): Promise<void> {
  const c = await ready()
  const chat = findOwn(input.chatId)
  if (!chat) throw new Error('This session is read-only here')
  if (c.live.get(chat.chatId)?.mode === 'tui') throw new Error('This chat is open in the terminal')

  const wasStarted = chat.started
  if (!wasStarted) {
    if (c.firstSends.has(chat.chatId)) return
    c.firstSends.add(chat.chatId)
  }
  try {
    if (!wasStarted) {
      const project = (await listProjects()).find((p) => p.projectKey === chat.projectKey)
      const base = project?.basePath ?? chat.cwd
      const plan = input.workspace
      if (plan && (plan.newWorktree || plan.newBranch)) {
        const ws = await prepareWorkspace(base, plan)
        chat.cwd = ws.cwd
        chat.branch = ws.branch
        if (ws.worktreePath) chat.worktreePath = ws.worktreePath
      } else {
        chat.branch = (await gitInfo(chat.cwd)).branch
      }
      if (PLACEHOLDER_TITLES.has(chat.title) && !chat.cardId) {
        const first = input.text.split(/\r?\n/).find((l) => l.trim())?.trim()
        if (first) chat.title = first.slice(0, TITLE_MAX)
      }
      c.parsers.delete(chat.chatId)
    }
    chat.toggles = input.toggles
    chat.updatedAt = Date.now()

    await c.runner.send(
      { ...(metaFor(chat.chatId) as ChatMeta), started: wasStarted },
      { text: input.text, attachments: input.attachments, toggles: input.toggles }
    )
    chat.started = true
    changed()

    if (!wasStarted && chat.cardId) {
      try {
        await mutateKanban({
          type: 'updateCard',
          id: chat.cardId,
          patch: { link: { sessionId: chat.sessionId, cwd: chat.cwd } }
        })
      } catch (err) {
        console.error('linking card failed', err)
      }
    }
  } finally {
    c.firstSends.delete(chat.chatId)
  }
}

async function interrupt(chatId: string): Promise<void> {
  await need().runner.interrupt(chatId)
}

async function answer(
  chatId: string,
  toolUseId: string,
  answers: Record<string, string> | null
): Promise<void> {
  need().runner.answerQuestion(chatId, toolUseId, answers)
}

async function decidePlan(chatId: string, toolUseId: string, decision: PlanDecision): Promise<void> {
  need().runner.decidePlan(chatId, toolUseId, decision)
}

async function close(chatId: string): Promise<void> {
  const c = await ready()
  const chat = findOwn(chatId)
  if (!chat) return
  c.runner.close(chatId)
  const ptyId = c.live.get(chatId)?.ptyId
  if (ptyId) killPty(ptyId)
  c.overlay.delete(chat.sessionId)
  c.state.chats = c.state.chats.filter((x) => x.chatId !== chatId)
  for (const [projectKey, tab] of Object.entries(c.state.activeByProject)) {
    if (tab === chatId) c.state.activeByProject[projectKey] = 'board'
  }
  c.live.delete(chatId)
  c.parsers.delete(chatId)
  c.tails.delete(chatId)
  c.histories.delete(chatId)
  changed()
  void refreshSnapshotNow(c.getWindow)
}

async function history(chatId: string): Promise<ChatItem[]> {
  const c = await ready()
  await ensureHistory(chatId)
  return getItems(c.parsers.get(chatId) ?? createParserState())
}

async function setActive(projectKey: string, tab: string): Promise<void> {
  const c = await ready()
  c.state.activeByProject[projectKey] = tab
  void persist()
}

async function openInTui(chatId: string): Promise<{ ptyId: string }> {
  const c = await ready()
  const chat = findOwn(chatId)
  if (!chat) throw new Error('Only chats started here can be opened in the terminal')
  await ensureHistory(chatId)
  c.runner.close(chatId)
  c.overlay.delete(chat.sessionId)
  const { ptyId } = await spawnPty(
    c.getWindow,
    {
      projectKey: chat.projectKey,
      cwd: chat.cwd,
      ...(chat.started ? { resumeSessionId: chat.sessionId } : {})
    },
    () => {
      const live = c.live.get(chatId)
      if (live) {
        live.mode = 'sdk'
        live.ptyId = undefined
      }
      void tailChat(chatId).then(scheduleBroadcast)
    }
  )
  c.live.set(chatId, { ...(c.live.get(chatId) ?? {}), mode: 'tui', ptyId })
  scheduleBroadcast()
  return { ptyId }
}

async function shutdown(): Promise<void> {
  const c = ctx
  if (!c) return
  c.runner.closeAll()
  c.unsubscribe()
  setStatusOverlayProvider(null)
  if (c.broadcastTimer) clearTimeout(c.broadcastTimer)
  c.broadcastTimer = null
  await c.saveChain.catch(() => {})
  ctx = null
}

export const chatService = {
  list,
  create,
  update,
  send,
  interrupt,
  answer,
  decidePlan,
  close,
  history,
  setActive,
  openInTui,
  shutdown
}

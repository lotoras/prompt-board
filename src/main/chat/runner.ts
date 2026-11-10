import { randomUUID } from 'crypto'
import { PERMISSION_MODES, composePrompt } from '../../shared/chat'
import type {
  ChatAttachment,
  ChatItem,
  ClaudeAccountId,
  ChatItemsEvent,
  ChatMeta,
  ChatToggles,
  EffortLevel,
  PermissionDecision,
  PermissionModeId,
  PlanDecision,
  QueuedMessage,
  SessionStatus,
  SlashCommandInfo
} from '../../shared/types'
import { withAccountEnv } from '../accounts'
import { applyRecord, chainTip, toolSummary, type ParserState } from './transcriptParser'

/** SDK stream messages are loosely typed at this boundary; each handler narrows what it reads. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkMessage = any

/** SDK system events the transcript parser turns into chat items. */
const PARSED_SYSTEM_EVENTS = new Set([
  'compact_boundary',
  'informational',
  'task_notification',
  'model_refusal_fallback',
  'model_refusal_no_fallback'
])

export interface SdkQuery extends AsyncIterable<SdkMessage> {
  interrupt(): Promise<void>
  setModel(m?: string): Promise<void>
  applyFlagSettings(s: Record<string, unknown>): Promise<void>
  getContextUsage(o?: unknown): Promise<{ totalTokens: number; maxTokens: number }>
  setPermissionMode(m: string): Promise<void>
  rewindFiles(
    userMessageId: string,
    o?: { dryRun?: boolean }
  ): Promise<{ canRewind: boolean; error?: string; filesChanged?: string[] }>
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(o?: { skipBehaviors?: boolean }): Promise<unknown>
  supportedCommands(): Promise<SlashCommandInfo[]>
  close(): void
}

export interface RunnerDeps {
  loadSdk(): Promise<{
    query(params: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }): SdkQuery
  }>
  claudePath(): string
  readImage(path: string): Promise<{ mediaType: string; base64: string }>
  parserFor(chatId: string): ParserState
  emitItems(e: ChatItemsEvent): void
  emitStatus(chatId: string, status: SessionStatus, waitingFor?: string): void
  emitMeta(chatId: string, patch: Partial<ChatMeta>): void
  onRateLimit?(info: unknown, account: ClaudeAccountId): void
  /** `/clear` ended the conversation; the CLI continues under a new session id. */
  onConversationCleared?(chatId: string): void
  idleCloseMs?: number
}

export interface ChatRunner {
  send(
    chat: ChatMeta,
    input: { text: string; attachments: ChatAttachment[]; toggles: ChatToggles },
    opts?: { interrupt?: boolean }
  ): Promise<void>
  interrupt(chatId: string): Promise<void>
  answerQuestion(chatId: string, toolUseId: string, answers: Record<string, string> | null): boolean
  decidePlan(chatId: string, toolUseId: string, decision: PlanDecision): boolean
  decidePermission(chatId: string, toolUseId: string, decision: PermissionDecision): boolean
  setPermissionMode(chatId: string, mode: PermissionModeId): Promise<void>
  rewind(
    chat: ChatMeta,
    input: { forkFrom: string; userUuid: string; revertFiles: boolean }
  ): Promise<{ filesChanged?: number; error?: string }>
  usage(chatId?: string): Promise<unknown | null>
  commands(chatId: string): Promise<SlashCommandInfo[] | null>
  probeUsage(cwd: string, account?: ClaudeAccountId): Promise<unknown | null>
  probeCommands(cwd: string, account?: ClaudeAccountId): Promise<SlashCommandInfo[]>
  setModel(chatId: string, model: string): Promise<void>
  /** Every effort change resends the Fan-out (`ultracode`) flag; an effort change alone turns it off. */
  setEffort(chatId: string, effort: EffortLevel, fanOut: boolean): Promise<void>
  isRunning(chatId: string): boolean
  close(chatId: string): void
  closeAll(): void
}

type PermissionResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean }

interface Pending {
  kind: 'question' | 'plan' | 'permission'
  input: Record<string, unknown>
  item?: Extract<ChatItem, { kind: 'permission' }>
  suggestions?: unknown[]
  resolve(result: PermissionResult): void
}

interface Slot {
  chatId: string
  account: ClaudeAccountId
  query: SdkQuery
  queue: Queue<unknown>
  lastFanOut: boolean
  pending: Map<string, Pending>
  liveText: string
  liveActive: boolean
  /** A progress note (compacting, API retry) is on screen. */
  noteActive: boolean
  idleTimer: ReturnType<typeof setTimeout> | null
  closed: boolean
  cwd: string
  mode: PermissionModeId
  /** Claude is working, or a queued message will start more work. */
  working: boolean
  /** Sent while Claude worked, not yet received by Claude. */
  queued: QueuedEntry[]
  resultWaiters: (() => void)[]
  /** The user asked to stop the running turn; its interrupted result is not an error. */
  stopRequested: boolean
}

interface QueuedEntry {
  /** The content the chat shows once Claude has the message. */
  shown: unknown
  view: QueuedMessage
}

interface Queue<T> {
  push(value: T): void
  end(): void
  iterable: AsyncIterable<T>
}

const DEFAULT_IDLE_CLOSE_MS = 30 * 60 * 1000
const INTERRUPT_WAIT_MS = 5000

function createQueue<T>(): Queue<T> {
  const buffer: T[] = []
  let waiter: ((r: IteratorResult<T>) => void) | null = null
  let done = false
  return {
    push(value) {
      if (done) return
      if (waiter) {
        const w = waiter
        waiter = null
        w({ value, done: false })
      } else buffer.push(value)
    },
    end() {
      done = true
      if (waiter) {
        const w = waiter
        waiter = null
        w({ value: undefined, done: true })
      }
    },
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next: () => {
            if (buffer.length) return Promise.resolve({ value: buffer.shift() as T, done: false })
            if (done) return Promise.resolve({ value: undefined, done: true })
            return new Promise((resolve) => {
              waiter = resolve
            })
          },
          return: async () => {
            done = true
            return { value: undefined, done: true }
          }
        }
      }
    }
  }
}

export function createChatRunner(deps: RunnerDeps): ChatRunner {
  const idleCloseMs = deps.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS
  const slots = new Map<string, Slot>()
  const opening = new Map<string, Promise<Slot>>()
  const startedSessions = new Set<string>()
  const forkAt = new Map<string, string>()

  function denyPending(slot: Slot, result: PermissionResult): void {
    const all = [...slot.pending.values()]
    slot.pending.clear()
    for (const p of all) p.resolve(result)
  }

  function flushWaiters(slot: Slot): void {
    const waiters = slot.resultWaiters.splice(0)
    for (const w of waiters) w()
  }

  function publishQueue(slot: Slot): void {
    deps.emitMeta(slot.chatId, { queued: slot.queued.map((e) => e.view) })
  }

  /** Adds the user's message to the chat. One uuid for the item and the SDK message, so the
   * transcript record matches and an edit can fork at its parent (the chain tip at this moment). */
  function showUser(chatId: string, uuid: string, shown: unknown): void {
    const parser = deps.parserFor(chatId)
    emit(
      chatId,
      applyRecord(parser, {
        type: 'user',
        uuid,
        parentUuid: chainTip(parser),
        message: { role: 'user', content: shown }
      })
    )
  }

  function deliverQueued(slot: Slot, uuid: unknown): void {
    const at = slot.queued.findIndex((e) => e.view.id === uuid)
    if (at < 0) return
    const [entry] = slot.queued.splice(at, 1)
    showUser(slot.chatId, entry.view.id, entry.shown)
    publishQueue(slot)
  }

  /** The session ended before Claude got these messages. Keep their text visible. */
  function failQueued(slot: Slot): void {
    if (slot.queued.length === 0) return
    const entries = slot.queued.splice(0)
    emit(
      slot.chatId,
      entries.map((e) => ({
        kind: 'system' as const,
        id: `err-${randomUUID()}`,
        tone: 'error' as const,
        text: `Not delivered: ${e.view.text || e.view.attachments.map((a) => a.name).join(', ')}`
      }))
    )
    publishQueue(slot)
  }

  function forget(slot: Slot): void {
    slot.closed = true
    flushWaiters(slot)
    if (slot.idleTimer) clearTimeout(slot.idleTimer)
    slot.idleTimer = null
    slot.queue.end()
    failQueued(slot)
    if (slots.get(slot.chatId) === slot) slots.delete(slot.chatId)
  }

  function markIdle(slot: Slot): void {
    deps.emitStatus(slot.chatId, 'idle')
    if (!slot.closed) {
      if (slot.idleTimer) clearTimeout(slot.idleTimer)
      slot.idleTimer = setTimeout(() => closeSlot(slot), idleCloseMs)
      slot.idleTimer.unref?.()
    }
  }

  function closeSlot(slot: Slot): void {
    if (slot.closed) return
    denyPending(slot, { behavior: 'deny', message: 'Closed' })
    forget(slot)
    try {
      slot.query.close()
    } catch (err) {
      console.error('chat query close failed', err)
    }
  }

  // chatId -> tool_use id -> the permission answer, stamped onto later updates of that tool.
  const approvals = new Map<string, Map<string, 'allowed' | 'always' | 'denied'>>()

  function emit(chatId: string, upsert: ChatItem[], remove?: string[]): void {
    if (upsert.length === 0 && !remove?.length) return
    const decided = approvals.get(chatId)
    if (decided?.size) {
      upsert = upsert.map((i) =>
        i.kind === 'tool' && decided.has(i.id) ? { ...i, approval: decided.get(i.id) } : i
      )
    }
    deps.emitItems({
      chatId,
      ...(upsert.length ? { upsert } : {}),
      ...(remove?.length ? { remove } : {})
    })
  }

  function liveId(chatId: string): string {
    return 'live:' + chatId
  }

  function noteId(chatId: string): string {
    return 'note:' + chatId
  }

  function showNote(slot: Slot, text: string): void {
    slot.noteActive = true
    emit(slot.chatId, [{ kind: 'system', id: noteId(slot.chatId), tone: 'info', text }])
  }

  function clearNote(slot: Slot): string[] {
    if (!slot.noteActive) return []
    slot.noteActive = false
    return [noteId(slot.chatId)]
  }

  function clearLive(slot: Slot): string[] {
    const remove = clearNote(slot)
    if (!slot.liveActive) return remove
    slot.liveActive = false
    slot.liveText = ''
    remove.push(liveId(slot.chatId))
    return remove
  }

  function handleStatus(slot: Slot, msg: SdkMessage): void {
    if (msg.status === 'compacting') {
      showNote(slot, 'Compacting context…')
      return
    }
    if (msg.status !== null) return
    const upsert: ChatItem[] = []
    if (msg.compact_result === 'failed') {
      upsert.push({
        kind: 'system',
        id: `err-${randomUUID()}`,
        tone: 'error',
        text: msg.compact_error ? `Compacting failed: ${msg.compact_error}` : 'Compacting failed'
      })
    }
    emit(slot.chatId, upsert, clearNote(slot))
  }

  function handleSessionState(slot: Slot, state: unknown): void {
    if (state === 'running' && !slot.working) {
      // A turn the CLI started itself, or a message that arrived just after the last turn ended.
      slot.working = true
      if (slot.idleTimer) clearTimeout(slot.idleTimer)
      slot.idleTimer = null
      deps.emitStatus(slot.chatId, 'busy')
    } else if (state === 'idle' && slot.queued.length > 0) {
      // The delivery echo was lost. A message must not stay gray forever.
      while (slot.queued.length > 0) deliverQueued(slot, slot.queued[0].view.id)
      slot.working = false
      markIdle(slot)
    }
  }

  async function handleResult(slot: Slot, msg: SdkMessage): Promise<void> {
    // A queued message that Claude has not received yet starts another turn after this one.
    slot.working = slot.queued.length > 0
    flushWaiters(slot)
    const upsert: ChatItem[] = []
    const failed =
      msg.is_error === true || (typeof msg.subtype === 'string' && msg.subtype.startsWith('error'))
    if (failed && slot.stopRequested) {
      upsert.push({ kind: 'system', id: `stop-${randomUUID()}`, tone: 'info', text: 'Stopped' })
    } else if (failed) {
      const detail = typeof msg.result === 'string' && msg.result ? msg.result : msg.subtype
      upsert.push({
        kind: 'system',
        id: `err-${randomUUID()}`,
        tone: 'error',
        text: String(detail ?? 'Error')
      })
    }
    slot.stopRequested = false
    upsert.push(
      ...applyRecord(deps.parserFor(slot.chatId), {
        type: 'system',
        subtype: 'turn_duration',
        uuid: `turn-${randomUUID()}`,
        durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : 0
      })
    )
    emit(slot.chatId, upsert, clearLive(slot))
    if (!slot.working) markIdle(slot)
    try {
      const usage = await slot.query.getContextUsage({ detail: 'summary' })
      if (!slot.closed) {
        deps.emitMeta(slot.chatId, { contextTokens: usage.totalTokens, contextWindow: usage.maxTokens })
      }
    } catch {
      // context usage is best-effort
    }
  }

  function handleMessage(slot: Slot, msg: SdkMessage): Promise<void> | void {
    const chatId = slot.chatId
    switch (msg?.type) {
      case 'stream_event': {
        if (msg.parent_tool_use_id) return
        const ev = msg.event
        if (ev?.type === 'message_start') {
          const remove = clearLive(slot)
          if (remove.length) emit(chatId, [], remove)
        } else if (
          ev?.type === 'content_block_delta' &&
          ev.delta?.type === 'text_delta' &&
          typeof ev.delta.text === 'string'
        ) {
          slot.liveText += ev.delta.text
          slot.liveActive = true
          emit(chatId, [
            { kind: 'assistant', id: liveId(chatId), markdown: slot.liveText, streaming: true }
          ])
        }
        return
      }
      case 'assistant':
      case 'user': {
        if (msg.isReplay) {
          deliverQueued(slot, msg.uuid)
          return
        }
        const content = msg.message?.content
        if (
          msg.type === 'user' &&
          !(Array.isArray(content) && content.some((b: SdkMessage) => b?.type === 'tool_result'))
        ) {
          return
        }
        const upsert = applyRecord(deps.parserFor(chatId), {
          type: msg.type,
          uuid: msg.uuid,
          message: msg.message,
          isSidechain: msg.parent_tool_use_id != null,
          toolUseResult: msg.tool_use_result
        })
        const remove = msg.type === 'assistant' && msg.parent_tool_use_id == null ? clearLive(slot) : []
        emit(chatId, upsert, remove)
        return
      }
      case 'result':
        return handleResult(slot, msg)
      case 'system': {
        const mode = msg.permissionMode
        if (typeof mode === 'string' && PERMISSION_MODES.some((m) => m.id === mode)) {
          if (mode !== slot.mode) {
            slot.mode = mode as PermissionModeId
            deps.emitMeta(chatId, { permissionMode: slot.mode })
          }
        }
        if (msg.subtype === 'status') {
          handleStatus(slot, msg)
        } else if (msg.subtype === 'session_state_changed') {
          handleSessionState(slot, msg.state)
        } else if (msg.subtype === 'api_retry') {
          showNote(slot, `API error. Retrying (attempt ${msg.attempt} of ${msg.max_retries})`)
        } else if (
          PARSED_SYSTEM_EVENTS.has(msg.subtype) &&
          // A foreground command also ends with this event, but only background work has an output file.
          (msg.subtype !== 'task_notification' || msg.output_file)
        ) {
          const { subtype, uuid, content, level, status, summary } = msg
          emit(
            chatId,
            applyRecord(deps.parserFor(chatId), { type: 'system', subtype, uuid, content, level, status, summary })
          )
        }
        return
      }
      case 'conversation_reset':
        if (msg.trigger === 'clear') deps.onConversationCleared?.(chatId)
        return
      case 'rate_limit_event':
        deps.onRateLimit?.(msg.rate_limit_info, slot.account)
        return
    }
  }

  async function consume(slot: Slot): Promise<void> {
    let failure: unknown = null
    try {
      for await (const msg of slot.query) {
        if (slot.closed) break
        await handleMessage(slot, msg)
      }
    } catch (err) {
      failure = err
    }
    if (slot.closed) return
    denyPending(slot, { behavior: 'deny', message: 'Session ended' })
    forget(slot)
    const remove = clearLive(slot)
    if (failure) {
      const text = failure instanceof Error ? failure.message : String(failure)
      emit(
        slot.chatId,
        [{ kind: 'system', id: `err-${randomUUID()}`, tone: 'error', text }],
        remove
      )
    } else {
      emit(slot.chatId, [], remove)
    }
    deps.emitStatus(slot.chatId, 'idle')
  }

  function makeCanUseTool(slot: Slot) {
    return (
      name: string,
      input: Record<string, unknown>,
      opts?: {
        toolUseID?: string
        signal?: AbortSignal
        title?: string
        description?: string
        suggestions?: unknown[]
        suppressAlwaysAllowRule?: boolean
      }
    ): Promise<PermissionResult> => {
      const interactive = name === 'AskUserQuestion' || name === 'ExitPlanMode'
      if (!interactive && (slot.mode === 'bypassPermissions' || slot.mode === 'plan')) {
        return Promise.resolve({ behavior: 'allow', updatedInput: input })
      }
      const id = opts?.toolUseID ?? randomUUID()
      const kind = name === 'AskUserQuestion' ? 'question' : name === 'ExitPlanMode' ? 'plan' : 'permission'
      return new Promise<PermissionResult>((resolve) => {
        const entry: Pending = { kind, input, resolve }
        if (kind === 'permission') {
          entry.suggestions = opts?.suggestions
          entry.item = {
            kind: 'permission',
            id,
            toolName: name,
            title: opts?.title ?? `Claude wants to use ${name}`,
            ...(opts?.description ? { description: opts.description } : {}),
            summary: toolSummary(name, input, slot.cwd),
            canAlwaysAllow: Boolean(opts?.suggestions?.length) && !opts?.suppressAlwaysAllowRule,
            state: 'pending'
          }
          emit(slot.chatId, [entry.item])
        }
        slot.pending.set(id, entry)
        opts?.signal?.addEventListener('abort', () => {
          if (slot.pending.delete(id)) {
            resolve({ behavior: 'deny', message: 'Aborted', interrupt: true })
            if (entry.item) emit(slot.chatId, [{ ...entry.item, state: 'denied' }])
          }
        })
        deps.emitStatus(slot.chatId, 'waiting', kind)
      })
    }
  }

  async function withProbe<T>(
    cwd: string,
    fn: (q: SdkQuery) => Promise<T>,
    extra: Record<string, unknown> = {},
    account: ClaudeAccountId = 1
  ): Promise<T> {
    const sdk = await deps.loadSdk()
    const queue = createQueue<unknown>()
    const env = withAccountEnv(process.env, account)
    delete env.ANTHROPIC_API_KEY
    const query = sdk.query({
      prompt: queue.iterable,
      options: { cwd, pathToClaudeCodeExecutable: deps.claudePath(), env, ...extra }
    })
    try {
      return await fn(query)
    } finally {
      queue.end()
      try {
        query.close()
      } catch (err) {
        console.error('probe query close failed', err)
      }
    }
  }

  async function open(chat: ChatMeta): Promise<Slot> {
    const sdk = await deps.loadSdk()
    const queue = createQueue<unknown>()
    const account = chat.account ?? 1
    const env = withAccountEnv(process.env, account)
    delete env.ANTHROPIC_API_KEY
    // The authoritative end-of-work signal; it clears queued messages whose echo was lost.
    env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1'
    const fork = forkAt.get(chat.chatId)
    forkAt.delete(chat.chatId)
    const resume = chat.started || startedSessions.has(chat.sessionId) || fork !== undefined
    const slotRef: { current?: Slot } = {}
    const options: Record<string, unknown> = {
      cwd: chat.cwd,
      model: chat.model,
      effort: chat.effort,
      pathToClaudeCodeExecutable: deps.claudePath(),
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      permissionMode: chat.permissionMode,
      allowDangerouslySkipPermissions: true,
      enableFileCheckpointing: true,
      includePartialMessages: true,
      // Always start with the Claude in Chrome connection (same as `claude --chrome`).
      // The replay flag echoes each message when Claude receives it, which ends its queued state.
      extraArgs: { chrome: null, 'replay-user-messages': null },
      env,
      canUseTool: (name: string, input: Record<string, unknown>, opts: SdkMessage) =>
        makeCanUseTool(slotRef.current as Slot)(name, input, opts),
      ...(resume ? { resume: chat.sessionId } : { sessionId: chat.sessionId }),
      ...(fork !== undefined ? { resumeSessionAt: fork } : {})
    }
    const query = sdk.query({ prompt: queue.iterable, options })
    startedSessions.add(chat.sessionId)
    const slot: Slot = {
      chatId: chat.chatId,
      account,
      query,
      queue,
      lastFanOut: false,
      pending: new Map(),
      liveText: '',
      liveActive: false,
      noteActive: false,
      idleTimer: null,
      closed: false,
      cwd: chat.cwd,
      mode: chat.permissionMode,
      working: false,
      queued: [],
      resultWaiters: [],
      stopRequested: false
    }
    slotRef.current = slot
    slots.set(chat.chatId, slot)
    void consume(slot)
    return slot
  }

  async function slotFor(chat: ChatMeta): Promise<Slot> {
    const existing = slots.get(chat.chatId)
    if (existing) return existing
    let pending = opening.get(chat.chatId)
    if (!pending) {
      pending = open(chat).finally(() => opening.delete(chat.chatId))
      opening.set(chat.chatId, pending)
    }
    return pending
  }

  return {
    async send(chat, input, opts) {
      const slot = await slotFor(chat)
      if (slot.idleTimer) clearTimeout(slot.idleTimer)
      slot.idleTimer = null

      if (opts?.interrupt && slot.working) {
        const settled = new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, INTERRUPT_WAIT_MS)
          slot.resultWaiters.push(() => {
            clearTimeout(timer)
            resolve()
          })
        })
        slot.stopRequested = true
        denyPending(slot, { behavior: 'deny', message: 'Interrupted', interrupt: true })
        await slot.query.interrupt()
        await settled
      }

      if (input.toggles.fanOut !== slot.lastFanOut) {
        await slot.query.applyFlagSettings({
          ultracode: input.toggles.fanOut,
          effortLevel: chat.effort
        })
        slot.lastFanOut = input.toggles.fanOut
      }

      const text = composePrompt(input.text, input.toggles, input.attachments)
      const images = input.attachments.filter((a) => a.kind === 'image')
      let content: unknown = text
      let shown: unknown = text
      if (images.length) {
        const blocks = await Promise.all(
          images.map(async (a) => {
            const img = await deps.readImage(a.path)
            return {
              type: 'image',
              source: { type: 'base64', media_type: img.mediaType, data: img.base64 }
            }
          })
        )
        content = [...blocks, { type: 'text', text }]
        shown = [...images.map(() => ({ type: 'image' })), { type: 'text', text }]
      }

      const uuid = randomUUID()
      // Stop and send with messages already waiting: the CLI runs those first, so this one waits too.
      if (slot.working && !(opts?.interrupt && slot.queued.length === 0)) {
        slot.queued.push({
          shown,
          view: {
            id: uuid,
            text: input.text,
            attachments: input.attachments.map((a) => ({ name: a.name, kind: a.kind }))
          }
        })
        publishQueue(slot)
      } else {
        showUser(chat.chatId, uuid, shown)
        deps.emitStatus(chat.chatId, 'busy')
        slot.working = true
      }
      slot.queue.push({
        type: 'user',
        uuid,
        message: { role: 'user', content },
        parent_tool_use_id: null
      })
    },

    async interrupt(chatId) {
      const slot = slots.get(chatId)
      if (!slot) return
      if (slot.working) slot.stopRequested = true
      denyPending(slot, { behavior: 'deny', message: 'Interrupted', interrupt: true })
      await slot.query.interrupt()
    },

    answerQuestion(chatId, toolUseId, answers) {
      const slot = slots.get(chatId)
      const p = slot?.pending.get(toolUseId)
      if (!slot || !p || p.kind !== 'question') return false
      slot.pending.delete(toolUseId)
      p.resolve(
        answers
          ? { behavior: 'allow', updatedInput: { ...p.input, answers } }
          : { behavior: 'deny', message: 'The user skipped the question.' }
      )
      deps.emitStatus(chatId, 'busy')
      return true
    },

    decidePlan(chatId, toolUseId, decision) {
      const slot = slots.get(chatId)
      const p = slot?.pending.get(toolUseId)
      if (!slot || !p || p.kind !== 'plan') return false
      slot.pending.delete(toolUseId)
      p.resolve(
        decision.approve
          ? { behavior: 'allow', updatedInput: p.input }
          : { behavior: 'deny', message: decision.feedback }
      )
      deps.emitStatus(chatId, 'busy')
      return true
    },

    decidePermission(chatId, toolUseId, d) {
      const slot = slots.get(chatId)
      const p = slot?.pending.get(toolUseId)
      if (!slot || !p || p.kind !== 'permission' || !p.item) return false
      slot.pending.delete(toolUseId)
      if (d.allow) {
        p.resolve({
          behavior: 'allow',
          updatedInput: p.input,
          ...(d.always && p.suggestions ? { updatedPermissions: p.suggestions } : {})
        })
      } else {
        p.resolve({ behavior: 'deny', message: d.message ?? 'The user denied this action.' })
      }
      let decided = approvals.get(chatId)
      if (!decided) approvals.set(chatId, (decided = new Map()))
      decided.set(toolUseId, d.allow ? (d.always ? 'always' : 'allowed') : 'denied')
      emit(chatId, [{ ...p.item, state: d.allow ? 'allowed' : 'denied' }])
      deps.emitStatus(chatId, 'busy')
      return true
    },

    async setPermissionMode(chatId, mode) {
      const slot = slots.get(chatId)
      if (!slot) return
      slot.mode = mode
      await slot.query.setPermissionMode(mode)
    },

    async rewind(chat, input) {
      const existing = slots.get(chat.chatId)
      if (existing) closeSlot(existing)
      forkAt.set(chat.chatId, input.forkFrom)
      if (!input.revertFiles) return {}
      try {
        return await withProbe(
          chat.cwd,
          async (q) => {
            const res = await q.rewindFiles(input.userUuid, { dryRun: false })
            if (!res.canRewind) return { error: res.error ?? 'Files cannot be restored' }
            return { filesChanged: res.filesChanged?.length ?? 0 }
          },
          { resume: chat.sessionId, enableFileCheckpointing: true },
          chat.account ?? 1
        )
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },

    async usage(chatId) {
      const slot = (chatId ? slots.get(chatId) : undefined) ?? [...slots.values()][0]
      if (!slot) return null
      try {
        return await slot.query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
          skipBehaviors: true
        })
      } catch {
        return null
      }
    },

    async commands(chatId) {
      const slot = slots.get(chatId)
      if (!slot) return null
      try {
        return await slot.query.supportedCommands()
      } catch {
        return null
      }
    },

    async probeUsage(cwd, account = 1) {
      try {
        return await withProbe(
          cwd,
          (q) => q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
          {},
          account
        )
      } catch {
        return null
      }
    },

    async probeCommands(cwd, account = 1) {
      try {
        return await withProbe(cwd, (q) => q.supportedCommands(), {}, account)
      } catch {
        return []
      }
    },

    async setModel(chatId, model) {
      await slots.get(chatId)?.query.setModel(model)
    },

    async setEffort(chatId, effort, fanOut) {
      const slot = slots.get(chatId)
      if (!slot) return
      await slot.query.applyFlagSettings({ effortLevel: effort, ultracode: fanOut })
      slot.lastFanOut = fanOut
    },

    isRunning(chatId) {
      return slots.has(chatId)
    },

    close(chatId) {
      const slot = slots.get(chatId)
      if (slot) closeSlot(slot)
    },

    closeAll() {
      for (const slot of [...slots.values()]) closeSlot(slot)
    }
  }
}

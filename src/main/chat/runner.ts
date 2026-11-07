import { randomUUID } from 'crypto'
import { PERMISSION_MODES, composePrompt } from '../../shared/chat'
import type {
  ChatAttachment,
  ChatItem,
  ChatItemsEvent,
  ChatMeta,
  ChatToggles,
  EffortLevel,
  PermissionDecision,
  PermissionModeId,
  PlanDecision,
  SessionStatus,
  SlashCommandInfo
} from '../../shared/types'
import { applyRecord, toolSummary, type ParserState } from './transcriptParser'

/** SDK stream messages are loosely typed at this boundary; each handler narrows what it reads. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkMessage = any

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
  onRateLimit?(info: unknown): void
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
  probeUsage(cwd: string): Promise<unknown | null>
  probeCommands(cwd: string): Promise<SlashCommandInfo[]>
  setModel(chatId: string, model: string): Promise<void>
  setEffort(chatId: string, effort: EffortLevel, ultra: boolean): Promise<void>
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
  query: SdkQuery
  queue: Queue<unknown>
  lastUltra: boolean
  pending: Map<string, Pending>
  liveText: string
  liveActive: boolean
  idleTimer: ReturnType<typeof setTimeout> | null
  closed: boolean
  cwd: string
  mode: PermissionModeId
  turns: number
  resultWaiters: (() => void)[]
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

  function forget(slot: Slot): void {
    slot.closed = true
    flushWaiters(slot)
    if (slot.idleTimer) clearTimeout(slot.idleTimer)
    slot.idleTimer = null
    slot.queue.end()
    if (slots.get(slot.chatId) === slot) slots.delete(slot.chatId)
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

  function emit(chatId: string, upsert: ChatItem[], remove?: string[]): void {
    if (upsert.length === 0 && !remove?.length) return
    deps.emitItems({
      chatId,
      ...(upsert.length ? { upsert } : {}),
      ...(remove?.length ? { remove } : {})
    })
  }

  function liveId(chatId: string): string {
    return 'live:' + chatId
  }

  function clearLive(slot: Slot): string[] {
    if (!slot.liveActive) return []
    slot.liveActive = false
    slot.liveText = ''
    return [liveId(slot.chatId)]
  }

  async function handleResult(slot: Slot, msg: SdkMessage): Promise<void> {
    slot.turns = Math.max(0, slot.turns - 1)
    flushWaiters(slot)
    const upsert: ChatItem[] = []
    if (msg.is_error === true || (typeof msg.subtype === 'string' && msg.subtype.startsWith('error'))) {
      const detail = typeof msg.result === 'string' && msg.result ? msg.result : msg.subtype
      upsert.push({
        kind: 'system',
        id: `err-${randomUUID()}`,
        tone: 'error',
        text: String(detail ?? 'Error')
      })
    }
    upsert.push(
      ...applyRecord(deps.parserFor(slot.chatId), {
        type: 'system',
        subtype: 'turn_duration',
        uuid: `turn-${randomUUID()}`,
        durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : 0
      })
    )
    emit(slot.chatId, upsert, clearLive(slot))
    deps.emitStatus(slot.chatId, 'idle')
    if (!slot.closed) {
      if (slot.idleTimer) clearTimeout(slot.idleTimer)
      slot.idleTimer = setTimeout(() => closeSlot(slot), idleCloseMs)
      slot.idleTimer.unref?.()
    }
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
        return
      }
      case 'rate_limit_event':
        deps.onRateLimit?.(msg.rate_limit_info)
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
      if (!interactive && slot.mode === 'bypassPermissions') {
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
    extra: Record<string, unknown> = {}
  ): Promise<T> {
    const sdk = await deps.loadSdk()
    const queue = createQueue<unknown>()
    const env: Record<string, string | undefined> = { ...process.env }
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
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.ANTHROPIC_API_KEY
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
      query,
      queue,
      lastUltra: false,
      pending: new Map(),
      liveText: '',
      liveActive: false,
      idleTimer: null,
      closed: false,
      cwd: chat.cwd,
      mode: chat.permissionMode,
      turns: 0,
      resultWaiters: []
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

      if (opts?.interrupt && slot.turns > 0) {
        const settled = new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, INTERRUPT_WAIT_MS)
          slot.resultWaiters.push(() => {
            clearTimeout(timer)
            resolve()
          })
        })
        denyPending(slot, { behavior: 'deny', message: 'Interrupted', interrupt: true })
        await slot.query.interrupt()
        await settled
      }

      if (input.toggles.ultra !== slot.lastUltra) {
        await slot.query.applyFlagSettings({
          ultracode: input.toggles.ultra,
          effortLevel: chat.effort
        })
        slot.lastUltra = input.toggles.ultra
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

      emit(
        chat.chatId,
        applyRecord(deps.parserFor(chat.chatId), {
          type: 'user',
          uuid: `local-${randomUUID()}`,
          message: { role: 'user', content: shown }
        })
      )
      deps.emitStatus(chat.chatId, 'busy')
      slot.turns++
      slot.queue.push({
        type: 'user',
        message: { role: 'user', content },
        parent_tool_use_id: null
      })
    },

    async interrupt(chatId) {
      const slot = slots.get(chatId)
      if (!slot) return
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
          { resume: chat.sessionId, enableFileCheckpointing: true }
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

    async probeUsage(cwd) {
      try {
        return await withProbe(cwd, (q) =>
          q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
        )
      } catch {
        return null
      }
    },

    async probeCommands(cwd) {
      try {
        return await withProbe(cwd, (q) => q.supportedCommands())
      } catch {
        return []
      }
    },

    async setModel(chatId, model) {
      await slots.get(chatId)?.query.setModel(model)
    },

    async setEffort(chatId, effort, ultra) {
      const slot = slots.get(chatId)
      if (!slot) return
      await slot.query.applyFlagSettings({ effortLevel: effort, ultracode: ultra })
      slot.lastUltra = ultra
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

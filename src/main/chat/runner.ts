import { randomUUID } from 'crypto'
import { composePrompt } from '../../shared/chat'
import type {
  ChatAttachment,
  ChatItem,
  ChatItemsEvent,
  ChatMeta,
  ChatToggles,
  EffortLevel,
  PlanDecision,
  SessionStatus
} from '../../shared/types'
import { applyRecord, type ParserState } from './transcriptParser'

/** SDK stream messages are loosely typed at this boundary; each handler narrows what it reads. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkMessage = any

export interface SdkQuery extends AsyncIterable<SdkMessage> {
  interrupt(): Promise<void>
  setModel(m?: string): Promise<void>
  applyFlagSettings(s: Record<string, unknown>): Promise<void>
  getContextUsage(o?: unknown): Promise<{ totalTokens: number; maxTokens: number }>
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
  idleCloseMs?: number
}

export interface ChatRunner {
  send(
    chat: ChatMeta,
    input: { text: string; attachments: ChatAttachment[]; toggles: ChatToggles }
  ): Promise<void>
  interrupt(chatId: string): Promise<void>
  answerQuestion(chatId: string, toolUseId: string, answers: Record<string, string> | null): boolean
  decidePlan(chatId: string, toolUseId: string, decision: PlanDecision): boolean
  setModel(chatId: string, model: string): Promise<void>
  setEffort(chatId: string, effort: EffortLevel, ultra: boolean): Promise<void>
  isRunning(chatId: string): boolean
  close(chatId: string): void
  closeAll(): void
}

type PermissionResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean }

interface Pending {
  kind: 'question' | 'plan'
  input: Record<string, unknown>
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
}

interface Queue<T> {
  push(value: T): void
  end(): void
  iterable: AsyncIterable<T>
}

const DEFAULT_IDLE_CLOSE_MS = 30 * 60 * 1000

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

  function denyPending(slot: Slot, result: PermissionResult): void {
    const all = [...slot.pending.values()]
    slot.pending.clear()
    for (const p of all) p.resolve(result)
  }

  function forget(slot: Slot): void {
    slot.closed = true
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
      opts?: { toolUseID?: string; signal?: AbortSignal }
    ): Promise<PermissionResult> => {
      if (name !== 'AskUserQuestion' && name !== 'ExitPlanMode') {
        return Promise.resolve({ behavior: 'allow', updatedInput: input })
      }
      const id = opts?.toolUseID ?? randomUUID()
      const kind = name === 'AskUserQuestion' ? 'question' : 'plan'
      return new Promise<PermissionResult>((resolve) => {
        slot.pending.set(id, { kind, input, resolve })
        opts?.signal?.addEventListener('abort', () => {
          if (slot.pending.delete(id)) resolve({ behavior: 'deny', message: 'Aborted', interrupt: true })
        })
        deps.emitStatus(slot.chatId, 'waiting', kind)
      })
    }
  }

  async function open(chat: ChatMeta): Promise<Slot> {
    const sdk = await deps.loadSdk()
    const queue = createQueue<unknown>()
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    const resume = chat.started || startedSessions.has(chat.sessionId)
    const slotRef: { current?: Slot } = {}
    const options: Record<string, unknown> = {
      cwd: chat.cwd,
      model: chat.model,
      effort: chat.effort,
      pathToClaudeCodeExecutable: deps.claudePath(),
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      env,
      canUseTool: (name: string, input: Record<string, unknown>, opts: SdkMessage) =>
        makeCanUseTool(slotRef.current as Slot)(name, input, opts),
      ...(resume ? { resume: chat.sessionId } : { sessionId: chat.sessionId })
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
      closed: false
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
    async send(chat, input) {
      const slot = await slotFor(chat)
      if (slot.idleTimer) clearTimeout(slot.idleTimer)
      slot.idleTimer = null

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

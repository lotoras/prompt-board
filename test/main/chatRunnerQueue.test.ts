import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatRunner, type ChatRunner, type RunnerDeps } from '../../src/main/chat/runner'
import { createParserState, type ParserState } from '../../src/main/chat/transcriptParser'
import { DEFAULT_TOGGLES } from '../../src/shared/chat'
import type { ChatItem, ChatItemsEvent, ChatMeta, ChatToggles } from '../../src/shared/types'

// Minimal fake Agent SDK query (same shape as chatRunnerModes.test.ts).
class FakeQuery {
  readonly pushed: any[] = []
  private buffer: any[] = []
  private waiting: { resolve: (r: IteratorResult<any>) => void } | null = null
  private finished = false

  interrupt = vi.fn(async () => {})
  setModel = vi.fn(async () => {})
  setPermissionMode = vi.fn(async () => {})
  applyFlagSettings = vi.fn(async () => {})
  close = vi.fn(() => this.end())

  constructor(readonly params: { prompt: AsyncIterable<unknown>; options: Record<string, any> }) {
    void (async () => {
      for await (const m of params.prompt) this.pushed.push(m)
    })().catch(() => {})
  }

  get options(): Record<string, any> {
    return this.params.options
  }

  emit(msg: any): void {
    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w.resolve({ value: msg, done: false })
    } else {
      this.buffer.push(msg)
    }
  }

  end(): void {
    this.finished = true
    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w.resolve({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<any> {
    return {
      next: () => {
        if (this.buffer.length) return Promise.resolve({ value: this.buffer.shift(), done: false })
        if (this.finished) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => {
          this.waiting = { resolve }
        })
      },
      return: async () => ({ value: undefined, done: true })
    }
  }
}

function makeChat(overrides: Partial<ChatMeta> = {}): ChatMeta {
  return {
    chatId: 'chat1',
    projectKey: 'p1',
    sessionId: 'sess-1',
    title: 'T',
    cwd: 'C:\\work\\p1',
    model: 'opus',
    effort: 'high',
    toggles: DEFAULT_TOGGLES,
    permissionMode: 'bypassPermissions',
    status: 'idle',
    mode: 'sdk',
    started: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

const OFF: ChatToggles = { codex: 'off', ultra: false }
const input = (text: string) => ({ text, attachments: [], toggles: OFF })
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

describe('chat/runner message queue', () => {
  let queries: FakeQuery[]
  let emitItems: ReturnType<typeof vi.fn>
  let emitStatus: ReturnType<typeof vi.fn>
  let emitMeta: ReturnType<typeof vi.fn>
  let runner: ChatRunner
  const chat = makeChat()

  beforeEach(() => {
    queries = []
    const parsers = new Map<string, ParserState>()
    emitItems = vi.fn()
    emitStatus = vi.fn()
    emitMeta = vi.fn()
    const deps = {
      loadSdk: vi.fn(async () => ({
        query: (params: any) => {
          const q = new FakeQuery(params)
          queries.push(q)
          return q
        }
      })),
      claudePath: () => 'C:\\bin\\claude.exe',
      readImage: vi.fn(async () => ({ mediaType: 'image/png', base64: 'QUJD' })),
      parserFor: (chatId: string) => {
        let p = parsers.get(chatId)
        if (!p) {
          p = createParserState()
          parsers.set(chatId, p)
        }
        return p
      },
      emitItems,
      emitStatus,
      emitMeta,
      onRateLimit: vi.fn(),
      onConversationCleared: vi.fn()
    }
    runner = createChatRunner(deps as unknown as RunnerDeps)
  })

  afterEach(() => {
    runner.closeAll()
  })

  const upserts = (): ChatItem[] =>
    (emitItems.mock.calls as [ChatItemsEvent][]).flatMap(([e]) => e.upsert ?? [])
  const userTexts = (): string[] =>
    upserts().flatMap((i) => (i.kind === 'user' ? [i.text] : []))
  const queuedCalls = (): unknown[] =>
    emitMeta.mock.calls.filter(([, patch]) => patch && 'queued' in patch).map(([, patch]) => patch.queued)

  /** Opens the chat with a first message (work running, no result yet). */
  async function working(): Promise<FakeQuery> {
    await runner.send(chat, input('first'))
    const q = queries[0]
    await vi.waitFor(() => expect(q.pushed).toHaveLength(1))
    return q
  }

  async function queueSecond(q: FakeQuery, text = 'second'): Promise<string> {
    await runner.send(chat, input(text))
    await vi.waitFor(() => expect(q.pushed.length).toBeGreaterThanOrEqual(2))
    return q.pushed[q.pushed.length - 1].uuid as string
  }

  const echo = (q: FakeQuery, uuid: string, text: string): void =>
    q.emit({
      type: 'user',
      isReplay: true,
      uuid,
      parent_tool_use_id: null,
      message: { role: 'user', content: text }
    })

  it('opens with replay-user-messages, chrome and session state events', async () => {
    const q = await working()
    expect(q.options.extraArgs).toMatchObject({ chrome: null, 'replay-user-messages': null })
    expect(q.options.env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS).toBe('1')
  })

  it('shows the first message on an idle chat at once', async () => {
    await working()
    expect(userTexts()).toEqual(['first'])
    expect(queuedCalls()).toEqual([])
  })

  it('queues a message sent while work runs: pushed, no item, queued meta', async () => {
    const q = await working()
    const id = await queueSecond(q)
    expect(id).toBeTruthy()
    expect(userTexts()).toEqual(['first'])
    expect(emitMeta).toHaveBeenCalledWith('chat1', { queued: [{ id, text: 'second', attachments: [] }] })
  })

  it('the echo removes the entry and emits a user item with the uuid as id', async () => {
    const q = await working()
    const id = await queueSecond(q)
    echo(q, id, 'second')
    await vi.waitFor(() => expect(emitMeta).toHaveBeenCalledWith('chat1', { queued: [] }))
    await vi.waitFor(() => expect(userTexts()).toContain('second'))
    expect(upserts()).toContainEqual(expect.objectContaining({ kind: 'user', id, text: 'second' }))
  })

  it('an echo for an unknown uuid does nothing', async () => {
    const q = await working()
    echo(q, 'nope', 'ghost')
    await flush()
    expect(userTexts()).toEqual(['first'])
    expect(queuedCalls()).toEqual([])
  })

  it('keeps the chat busy: no idle after a result while an entry is queued', async () => {
    const q = await working()
    await queueSecond(q)
    q.emit({ type: 'result', subtype: 'success', is_error: false })
    await flush()
    expect(emitStatus).not.toHaveBeenCalledWith('chat1', 'idle')
  })

  it('emits idle after a result with an empty queue', async () => {
    const q = await working()
    q.emit({ type: 'result', subtype: 'success', is_error: false })
    await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'idle'))
  })

  it('session_state_changed idle delivers leftover entries and goes idle', async () => {
    const q = await working()
    await queueSecond(q, 'second')
    await queueSecond(q, 'third')
    q.emit({ type: 'system', subtype: 'session_state_changed', state: 'idle' })
    await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'idle'))
    expect(userTexts()).toEqual(['first', 'second', 'third'])
    expect(emitMeta).toHaveBeenLastCalledWith('chat1', { queued: [] })
  })

  it('session end with entries left emits a Not delivered error per entry', async () => {
    const q = await working()
    await queueSecond(q, 'second')
    await queueSecond(q, 'third')
    q.end()
    await vi.waitFor(() =>
      expect(
        upserts().filter((i) => i.kind === 'system' && i.tone === 'error' && i.text.startsWith('Not delivered: '))
      ).toHaveLength(2)
    )
    const texts = upserts().flatMap((i) => (i.kind === 'system' ? [i.text] : []))
    expect(texts).toEqual(expect.arrayContaining(['Not delivered: second', 'Not delivered: third']))
    expect(emitMeta).toHaveBeenLastCalledWith('chat1', { queued: [] })
  })

  it('close with an entry left emits a Not delivered error and empties the queue', async () => {
    const q = await working()
    await queueSecond(q, 'second')
    runner.close('chat1')
    await vi.waitFor(() =>
      expect(upserts()).toContainEqual(
        expect.objectContaining({ kind: 'system', tone: 'error', text: 'Not delivered: second' })
      )
    )
    expect(emitMeta).toHaveBeenLastCalledWith('chat1', { queued: [] })
  })

  it('interrupt keeps the entry; Stopped appears after the failed result and the echo delivers', async () => {
    const q = await working()
    const id = await queueSecond(q)
    await runner.interrupt('chat1')
    expect(q.interrupt).toHaveBeenCalledTimes(1)
    expect(emitMeta).not.toHaveBeenCalledWith('chat1', { queued: [] })

    q.emit({ type: 'result', subtype: 'error_during_execution', is_error: true })
    await vi.waitFor(() =>
      expect(upserts()).toContainEqual(expect.objectContaining({ kind: 'system', text: 'Stopped' }))
    )
    expect(emitStatus).not.toHaveBeenCalledWith('chat1', 'idle')

    echo(q, id, 'second')
    await vi.waitFor(() => expect(userTexts()).toContain('second'))
    expect(emitMeta).toHaveBeenCalledWith('chat1', { queued: [] })
  })

  it('send with interrupt joins the queue when an entry is already queued', async () => {
    const q = await working()
    await queueSecond(q, 'second')
    const before = userTexts().length
    const sending = runner.send(chat, input('third'), { interrupt: true })
    q.emit({ type: 'result', subtype: 'error_during_execution', is_error: true })
    await sending
    await flush()
    expect(userTexts()).toHaveLength(before)
    const last = queuedCalls().pop() as { text: string }[]
    expect(last.map((e) => e.text)).toEqual(['second', 'third'])
  })
})

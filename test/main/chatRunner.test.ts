import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatRunner, type ChatRunner, type RunnerDeps } from '../../src/main/chat/runner'
import { createParserState, type ParserState } from '../../src/main/chat/transcriptParser'
import { DEFAULT_TOGGLES } from '../../src/shared/chat'
import type { ChatItem, ChatItemsEvent, ChatMeta, ChatToggles } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Fake Agent SDK
// ---------------------------------------------------------------------------

interface QueryParams {
  prompt: AsyncIterable<unknown>
  options: Record<string, any>
}

class FakeQuery {
  readonly pushed: any[] = []
  private buffer: any[] = []
  private waiting: {
    resolve: (r: IteratorResult<any>) => void
    reject: (e: unknown) => void
  } | null = null
  private finished = false
  private error: unknown = null

  interrupt = vi.fn(async () => {})
  setModel = vi.fn(async (_m?: string) => {})
  applyFlagSettings = vi.fn(async (_s: Record<string, unknown>) => {})
  getContextUsage = vi.fn(async (_o?: unknown) => ({ totalTokens: 1234, maxTokens: 200000 }))
  close = vi.fn(() => this.end())

  constructor(readonly params: QueryParams) {
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

  fail(err: unknown): void {
    this.error = err
    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w.reject(err)
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<any> {
    return {
      next: () => {
        if (this.buffer.length) return Promise.resolve({ value: this.buffer.shift(), done: false })
        if (this.error) return Promise.reject(this.error)
        if (this.finished) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve, reject) => {
          this.waiting = { resolve, reject }
        })
      },
      return: async () => ({ value: undefined, done: true })
    }
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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

const OFF: ChatToggles = { codex: 'off', fanOut: false, think: false }

function input(text: string, toggles: ChatToggles = OFF, attachments: any[] = []) {
  return { text, attachments, toggles }
}

describe('chat/runner', () => {
  let queries: FakeQuery[]
  let loadSdk: ReturnType<typeof vi.fn>
  let emitItems: ReturnType<typeof vi.fn>
  let emitStatus: ReturnType<typeof vi.fn>
  let emitMeta: ReturnType<typeof vi.fn>
  let readImage: ReturnType<typeof vi.fn>
  let parsers: Map<string, ParserState>
  let runner: ChatRunner
  let savedKey: string | undefined

  beforeEach(() => {
    savedKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-test-should-not-leak'
    queries = []
    parsers = new Map()
    emitItems = vi.fn()
    emitStatus = vi.fn()
    emitMeta = vi.fn()
    readImage = vi.fn(async (_p: string) => ({ mediaType: 'image/png', base64: 'QUJDREVG' }))
    loadSdk = vi.fn(async () => ({
      query: (params: QueryParams) => {
        const q = new FakeQuery(params)
        queries.push(q)
        return q
      }
    }))
    const deps: RunnerDeps = {
      loadSdk: loadSdk as unknown as RunnerDeps['loadSdk'],
      claudePath: () => 'C:\\bin\\claude.exe',
      readImage: readImage as unknown as RunnerDeps['readImage'],
      parserFor: (chatId) => {
        let p = parsers.get(chatId)
        if (!p) {
          p = createParserState()
          parsers.set(chatId, p)
        }
        return p
      },
      emitItems: emitItems as unknown as RunnerDeps['emitItems'],
      emitStatus: emitStatus as unknown as RunnerDeps['emitStatus'],
      emitMeta: emitMeta as unknown as RunnerDeps['emitMeta']
    }
    runner = createChatRunner(deps)
  })

  afterEach(() => {
    runner.closeAll()
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = savedKey
  })

  function upserts(): ChatItem[] {
    return (emitItems.mock.calls as [ChatItemsEvent][]).flatMap(([e]) => e.upsert ?? [])
  }
  function removals(): string[] {
    return (emitItems.mock.calls as [ChatItemsEvent][]).flatMap(([e]) => e.remove ?? [])
  }
  function deltaMsg(text: string) {
    return {
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
    }
  }

  async function openChat(chat = makeChat()): Promise<FakeQuery> {
    await runner.send(chat, input('hello'))
    return queries[0]
  }

  // -------------------------------------------------------------------------
  describe('first send', () => {
    it('opens one query with the documented options for a draft chat', async () => {
      await runner.send(makeChat(), input('hello'))
      expect(loadSdk).toHaveBeenCalledTimes(1)
      expect(queries).toHaveLength(1)
      const o = queries[0].options
      expect(o).toMatchObject({
        cwd: 'C:\\work\\p1',
        model: 'opus',
        effort: 'high',
        pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        sessionId: 'sess-1'
      })
      expect(o.resume).toBeUndefined()
      expect(typeof o.canUseTool).toBe('function')
    })

    it('does not pass ANTHROPIC_API_KEY in env', async () => {
      await runner.send(makeChat(), input('hello'))
      const env = queries[0].options.env
      expect(env).toBeDefined()
      expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
    })

    it('uses resume instead of sessionId for a started chat', async () => {
      await runner.send(makeChat({ started: true }), input('hello'))
      const o = queries[0].options
      expect(o.resume).toBe('sess-1')
      expect(o.sessionId).toBeUndefined()
    })

    it('emits busy and reports the chat as running', async () => {
      await runner.send(makeChat(), input('hello'))
      expect(emitStatus).toHaveBeenCalledWith('chat1', 'busy')
      expect(runner.isRunning('chat1')).toBe(true)
      expect(runner.isRunning('other')).toBe(false)
    })

    it('reuses the same query for a second send', async () => {
      const chat = makeChat()
      await runner.send(chat, input('one'))
      await runner.send(chat, input('two'))
      expect(loadSdk).toHaveBeenCalledTimes(1)
      expect(queries).toHaveLength(1)
      await vi.waitFor(() => expect(queries[0].pushed).toHaveLength(2))
    })
  })

  // -------------------------------------------------------------------------
  describe('pushed user messages', () => {
    it('pushes a string user message with the composed prompt', async () => {
      await runner.send(
        makeChat(),
        input('  fix it  ', { codex: 'tests', fanOut: true, think: true })
      )
      await vi.waitFor(() => expect(queries[0].pushed).toHaveLength(1))
      expect(queries[0].pushed[0]).toEqual({
        type: 'user',
        uuid: expect.any(String),
        message: { role: 'user', content: 'fix it\n\nultrathink\nuse codex' },
        parent_tool_use_id: null
      })
    })

    it('uses one uuid for the local user item and the SDK message, parented to the chain tip', async () => {
      const parser = createParserState()
      parsers.set('chat1', parser)
      // An earlier turn already in the chain: its last record is the tip.
      const { applyRecord } = await import('../../src/main/chat/transcriptParser')
      applyRecord(parser, { type: 'user', uuid: 'u-0', parentUuid: null, message: { role: 'user', content: 'hi' } })
      applyRecord(parser, {
        type: 'assistant',
        uuid: 'a-0',
        parentUuid: 'u-0',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
      })
      await runner.send(makeChat(), input('next', OFF))
      await vi.waitFor(() => expect(queries[0].pushed).toHaveLength(1))
      const pushed = queries[0].pushed[0] as { uuid: string }
      const item = upserts().find((i) => i.kind === 'user' && i.text === 'next')
      expect(item?.id).toBe(pushed.uuid)
      expect(item && item.kind === 'user' ? item.parentUuid : undefined).toBe('a-0')
    })

    it('lists non-image files in the composed text', async () => {
      await runner.send(
        makeChat(),
        input('look', OFF, [
          { path: 'C:\\a\\b.ts', name: 'b.ts', kind: 'file', size: 1 }
        ])
      )
      await vi.waitFor(() => expect(queries[0].pushed).toHaveLength(1))
      expect(queries[0].pushed[0].message.content).toBe('look\n\nAttached files:\n- C:\\a\\b.ts')
    })

    it('pushes image blocks followed by a text block for image attachments', async () => {
      await runner.send(
        makeChat(),
        input('look', OFF, [{ path: 'C:\\a\\shot.png', name: 'shot.png', kind: 'image', size: 3 }])
      )
      await vi.waitFor(() => expect(queries[0].pushed).toHaveLength(1))
      expect(readImage).toHaveBeenCalledWith('C:\\a\\shot.png')
      const content = queries[0].pushed[0].message.content
      expect(Array.isArray(content)).toBe(true)
      expect(content).toHaveLength(2)
      expect(content[0].type).toBe('image')
      expect(JSON.stringify(content[0])).toContain('QUJDREVG')
      expect(content[1]).toEqual({ type: 'text', text: 'look' })
    })
  })

  // -------------------------------------------------------------------------
  describe('fan-out', () => {
    it('applies flag settings only when the Fan-out toggle changes', async () => {
      const chat = makeChat()
      await runner.send(chat, input('a', OFF))
      const q = queries[0]
      expect(q.applyFlagSettings).not.toHaveBeenCalled()

      await runner.send(chat, input('b', { codex: 'off', fanOut: true, think: false }))
      expect(q.applyFlagSettings).toHaveBeenCalledTimes(1)
      expect(q.applyFlagSettings).toHaveBeenLastCalledWith({ ultracode: true, effortLevel: 'high' })

      await runner.send(chat, input('c', { codex: 'off', fanOut: true, think: false }))
      expect(q.applyFlagSettings).toHaveBeenCalledTimes(1)

      await runner.send(chat, input('d', OFF))
      expect(q.applyFlagSettings).toHaveBeenCalledTimes(2)
      expect(q.applyFlagSettings).toHaveBeenLastCalledWith({ ultracode: false, effortLevel: 'high' })
    })

    it('applies Fan-out on the very first send when it starts enabled', async () => {
      await runner.send(makeChat(), input('a', { codex: 'off', fanOut: true, think: false }))
      expect(queries[0].applyFlagSettings).toHaveBeenCalledWith({
        ultracode: true,
        effortLevel: 'high'
      })
    })

    it('Fan-out adds no text to the prompt', async () => {
      await runner.send(makeChat(), input('fix it', { codex: 'off', fanOut: true, think: false }))
      await vi.waitFor(() => expect(queries[0].pushed).toHaveLength(1))
      expect(queries[0].pushed[0].message).toEqual({ role: 'user', content: 'fix it' })
    })

    it('Think harder appends ultrathink and sets no flag', async () => {
      await runner.send(makeChat(), input('fix it', { codex: 'off', fanOut: false, think: true }))
      await vi.waitFor(() => expect(queries[0].pushed).toHaveLength(1))
      expect(queries[0].pushed[0].message).toEqual({
        role: 'user',
        content: 'fix it\n\nultrathink'
      })
      expect(queries[0].applyFlagSettings).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('result handling', () => {
    it('emits idle and then context meta on a result message', async () => {
      const q = await openChat()
      emitStatus.mockClear()
      q.emit({ type: 'result', subtype: 'success', is_error: false })
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'idle'))
      await vi.waitFor(() =>
        expect(emitMeta).toHaveBeenCalledWith('chat1', {
          contextTokens: 1234,
          contextWindow: 200000
        })
      )
      expect(q.getContextUsage).toHaveBeenCalledWith({ detail: 'summary' })
    })

    it('still goes idle when getContextUsage fails', async () => {
      const q = await openChat()
      q.getContextUsage.mockRejectedValueOnce(new Error('nope'))
      emitStatus.mockClear()
      q.emit({ type: 'result', subtype: 'success' })
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'idle'))
      await new Promise((r) => setTimeout(r, 20))
      expect(emitMeta).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('streaming and messages', () => {
    it('upserts a live streaming item with accumulated text', async () => {
      const q = await openChat()
      q.emit(deltaMsg('Hel'))
      await vi.waitFor(() =>
        expect(upserts()).toContainEqual({
          kind: 'assistant',
          id: 'live:chat1',
          markdown: 'Hel',
          streaming: true
        })
      )
      q.emit(deltaMsg('lo'))
      await vi.waitFor(() =>
        expect(upserts()).toContainEqual({
          kind: 'assistant',
          id: 'live:chat1',
          markdown: 'Hello',
          streaming: true
        })
      )
    })

    it('removes the live item when the final assistant message arrives and upserts it', async () => {
      const q = await openChat()
      q.emit(deltaMsg('Hello'))
      await vi.waitFor(() => expect(upserts().some((i) => i.id === 'live:chat1')).toBe(true))
      q.emit({
        type: 'assistant',
        uuid: 'a1',
        parent_tool_use_id: null,
        message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }
      })
      await vi.waitFor(() => expect(removals()).toContain('live:chat1'))
      expect(upserts()).toContainEqual(
        expect.objectContaining({ kind: 'assistant', id: 'a1:0', markdown: 'Hello' })
      )
    })

    it('feeds assistant tool_use and user tool_result messages through the parser', async () => {
      const q = await openChat()
      q.emit({
        type: 'assistant',
        uuid: 'a2',
        parent_tool_use_id: null,
        message: {
          id: 'msg_2',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool1', name: 'Bash', input: { command: 'ls' } }]
        }
      })
      await vi.waitFor(() =>
        expect(upserts()).toContainEqual(
          expect.objectContaining({ kind: 'tool', id: 'tool1', status: 'running', summary: 'ls' })
        )
      )
      q.emit({
        type: 'user',
        uuid: 'u2',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool1', content: 'file.txt' }]
        }
      })
      await vi.waitFor(() =>
        expect(upserts()).toContainEqual(
          expect.objectContaining({ kind: 'tool', id: 'tool1', status: 'ok', result: 'file.txt' })
        )
      )
    })

    it('does not emit items for messages that produce none (sidechain)', async () => {
      const q = await openChat()
      emitItems.mockClear()
      q.emit({
        type: 'assistant',
        uuid: 's1',
        parent_tool_use_id: 'agent-1',
        message: {
          id: 'msg_s',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'side', name: 'Read', input: { file_path: 'x' } }]
        }
      })
      await new Promise((r) => setTimeout(r, 30))
      expect(emitItems).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('canUseTool', () => {
    const questionInput = {
      questions: [
        {
          question: 'Which db?',
          header: 'DB',
          multiSelect: false,
          options: [{ label: 'Postgres', description: 'pg' }]
        }
      ]
    }

    it('allows ordinary tools immediately with their input', async () => {
      const q = await openChat()
      const res = await q.options.canUseTool('Bash', { command: 'ls' }, { toolUseID: 't1' })
      expect(res).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
    })

    it('holds AskUserQuestion pending, reports waiting, and resolves with answers', async () => {
      const q = await openChat()
      const pending = q.options.canUseTool('AskUserQuestion', questionInput, { toolUseID: 'tq' })
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'question'))
      emitStatus.mockClear()

      const answers = { 'Which db?': 'Postgres' }
      expect(runner.answerQuestion('chat1', 'tq', answers)).toBe(true)
      expect(await pending).toEqual({
        behavior: 'allow',
        updatedInput: { ...questionInput, answers }
      })
      expect(emitStatus).toHaveBeenCalledWith('chat1', 'busy')
    })

    it('denies a skipped question', async () => {
      const q = await openChat()
      const pending = q.options.canUseTool('AskUserQuestion', questionInput, { toolUseID: 'tq' })
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'question'))
      expect(runner.answerQuestion('chat1', 'tq', null)).toBe(true)
      expect(await pending).toEqual({
        behavior: 'deny',
        message: 'The user skipped the question.'
      })
    })

    it('returns false for an unknown question id', async () => {
      await openChat()
      expect(runner.answerQuestion('chat1', 'missing', { a: 'b' })).toBe(false)
      expect(runner.answerQuestion('unknown-chat', 'missing', null)).toBe(false)
    })

    it('holds ExitPlanMode pending and allows on approve', async () => {
      const q = await openChat()
      const planInput = { plan: '1. do it' }
      const pending = q.options.canUseTool('ExitPlanMode', planInput, { toolUseID: 'tp' })
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'plan'))
      emitStatus.mockClear()
      expect(runner.decidePlan('chat1', 'tp', { approve: true })).toBe(true)
      expect(await pending).toEqual({ behavior: 'allow', updatedInput: planInput })
      expect(emitStatus).toHaveBeenCalledWith('chat1', 'busy')
    })

    it('denies ExitPlanMode with the feedback on reject', async () => {
      const q = await openChat()
      const pending = q.options.canUseTool('ExitPlanMode', { plan: 'x' }, { toolUseID: 'tp' })
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'plan'))
      expect(runner.decidePlan('chat1', 'tp', { approve: false, feedback: 'smaller steps' })).toBe(true)
      expect(await pending).toEqual({ behavior: 'deny', message: 'smaller steps' })
    })

    it('returns false for an unknown plan id', async () => {
      await openChat()
      expect(runner.decidePlan('chat1', 'missing', { approve: true })).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  describe('control', () => {
    it('interrupt calls the query and denies pending prompts', async () => {
      const q = await openChat()
      const pending = q.options.canUseTool(
        'AskUserQuestion',
        { questions: [] },
        { toolUseID: 'tq' }
      )
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'question'))
      await runner.interrupt('chat1')
      expect(q.interrupt).toHaveBeenCalledTimes(1)
      expect(await pending).toEqual({ behavior: 'deny', message: 'Interrupted', interrupt: true })
    })

    it('setModel forwards to the query', async () => {
      const q = await openChat()
      await runner.setModel('chat1', 'sonnet')
      expect(q.setModel).toHaveBeenCalledWith('sonnet')
    })

    it('setEffort applies effortLevel and ultracode flags', async () => {
      const q = await openChat()
      await runner.setEffort('chat1', 'max', true)
      expect(q.applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'max', ultracode: true })
    })

    it('setModel and setEffort are no-ops without a query', async () => {
      await expect(runner.setModel('nobody', 'sonnet')).resolves.toBeUndefined()
      await expect(runner.setEffort('nobody', 'low', false)).resolves.toBeUndefined()
      expect(loadSdk).not.toHaveBeenCalled()
    })

    it('close closes the query, denies pending prompts and forgets it', async () => {
      const q = await openChat()
      const pending = q.options.canUseTool('ExitPlanMode', { plan: 'x' }, { toolUseID: 'tp' })
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'plan'))
      runner.close('chat1')
      expect(q.close).toHaveBeenCalled()
      expect((await pending).behavior).toBe('deny')
      expect(runner.isRunning('chat1')).toBe(false)
    })

    it('closeAll closes every open query', async () => {
      await runner.send(makeChat({ chatId: 'c1', sessionId: 's1' }), input('a'))
      await runner.send(makeChat({ chatId: 'c2', sessionId: 's2' }), input('b'))
      runner.closeAll()
      expect(queries).toHaveLength(2)
      for (const q of queries) expect(q.close).toHaveBeenCalled()
      expect(runner.isRunning('c1')).toBe(false)
      expect(runner.isRunning('c2')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  describe('failure', () => {
    it('reports a system error item, goes idle, and reopens with resume on the next send', async () => {
      const chat = makeChat()
      const q = await openChat(chat)
      emitStatus.mockClear()
      q.fail(new Error('boom: network down'))

      await vi.waitFor(() =>
        expect(upserts()).toContainEqual(
          expect.objectContaining({
            kind: 'system',
            tone: 'error',
            text: expect.stringContaining('boom: network down')
          })
        )
      )
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'idle'))
      await vi.waitFor(() => expect(runner.isRunning('chat1')).toBe(false))

      await runner.send(chat, input('again'))
      expect(queries).toHaveLength(2)
      expect(queries[1].options.resume).toBe('sess-1')
      expect(queries[1].options.sessionId).toBeUndefined()
    })

    it('goes idle and forgets the query when the stream ends normally', async () => {
      const q = await openChat()
      emitStatus.mockClear()
      q.end()
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'idle'))
      await vi.waitFor(() => expect(runner.isRunning('chat1')).toBe(false))
      expect(upserts().some((i) => i.kind === 'system' && i.tone === 'error')).toBe(false)
    })
  })
})

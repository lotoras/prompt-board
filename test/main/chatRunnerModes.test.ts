import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatRunner, type ChatRunner, type RunnerDeps } from '../../src/main/chat/runner'
import { createParserState, type ParserState } from '../../src/main/chat/transcriptParser'
import { DEFAULT_TOGGLES } from '../../src/shared/chat'
import type { ChatItem, ChatItemsEvent, ChatMeta, ChatToggles } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Fake Agent SDK (same shape as chatRunner.test.ts, plus the T3 follow-up methods)
// ---------------------------------------------------------------------------

interface QueryParams {
  prompt: AsyncIterable<unknown>
  options: Record<string, any>
}

const USAGE_RESP = {
  rate_limits_available: true,
  rate_limits: { five_hour: { utilization: 40, resets_at: '2026-11-07T15:00:00.000Z' } }
}
const COMMANDS = [
  { name: 'ai-brain:cc-enhance', description: 'Enhance a prompt', argumentHint: '<prompt>' },
  { name: 'compact', description: 'Compact the context', argumentHint: '' }
]

const hooks: { rewindError?: Error; usageError?: Error; commandsError?: Error } = {}

class FakeQuery {
  readonly pushed: any[] = []
  private buffer: any[] = []
  private waiting: {
    resolve: (r: IteratorResult<any>) => void
    reject: (e: unknown) => void
  } | null = null
  private finished = false

  interrupt = vi.fn(async () => {})
  setModel = vi.fn(async (_m?: string) => {})
  setPermissionMode = vi.fn(async (_m: string) => {})
  applyFlagSettings = vi.fn(async (_s: Record<string, unknown>) => {})
  getContextUsage = vi.fn(async (_o?: unknown) => ({ totalTokens: 1234, maxTokens: 200000 }))
  rewindFiles = vi.fn(async (_uuid: string, _o?: unknown) => {
    if (hooks.rewindError) throw hooks.rewindError
    return {
    canRewind: true,
    filesChanged: ['a.ts', 'b.ts'],
    insertions: 3,
    deletions: 1
    }
  })
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = vi.fn(async (_o?: unknown) => {
    if (hooks.usageError) throw hooks.usageError
    return USAGE_RESP
  })
  supportedCommands = vi.fn(async () => {
    if (hooks.commandsError) throw hooks.commandsError
    return COMMANDS
  })
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

  [Symbol.asyncIterator](): AsyncIterator<any> {
    return {
      next: () => {
        if (this.buffer.length) return Promise.resolve({ value: this.buffer.shift(), done: false })
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

const OFF: ChatToggles = { codex: 'off', ultra: false }

function input(text: string) {
  return { text, attachments: [], toggles: OFF }
}

describe('chat/runner modes, permissions, rewind, probes', () => {
  let queries: FakeQuery[]
  let emitItems: ReturnType<typeof vi.fn>
  let emitStatus: ReturnType<typeof vi.fn>
  let emitMeta: ReturnType<typeof vi.fn>
  let onRateLimit: ReturnType<typeof vi.fn>
  let onConversationCleared: ReturnType<typeof vi.fn>
  let runner: ChatRunner
  let savedKey: string | undefined

  beforeEach(() => {
    savedKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-test-should-not-leak'
    queries = []
    delete hooks.rewindError
    delete hooks.usageError
    delete hooks.commandsError
    const parsers = new Map<string, ParserState>()
    emitItems = vi.fn()
    emitStatus = vi.fn()
    emitMeta = vi.fn()
    onRateLimit = vi.fn()
    onConversationCleared = vi.fn()
    const deps = {
      loadSdk: vi.fn(async () => ({
        query: (params: QueryParams) => {
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
      onRateLimit,
      onConversationCleared
    }
    runner = createChatRunner(deps as unknown as RunnerDeps)
  })

  afterEach(() => {
    vi.useRealTimers()
    runner.closeAll()
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = savedKey
  })

  function upserts(): ChatItem[] {
    return (emitItems.mock.calls as [ChatItemsEvent][]).flatMap(([e]) => e.upsert ?? [])
  }

  async function openChat(chat = makeChat()): Promise<FakeQuery> {
    await runner.send(chat, input('hello'))
    return queries[0]
  }

  // -------------------------------------------------------------------------
  describe('options and mode', () => {
    it('runs a Claude 2 chat with that account config dir', async () => {
      const q = await openChat(makeChat({ account: 2 }))
      expect((q.options.env as Record<string, string>).CLAUDE_CONFIG_DIR).toMatch(/\.claude-2$/)
    })

    it('never lets a Claude 1 chat inherit a config dir', async () => {
      process.env.CLAUDE_CONFIG_DIR = 'C:\\elsewhere'
      try {
        const q = await openChat(makeChat({ account: 1 }))
        expect(q.options.env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
      } finally {
        delete process.env.CLAUDE_CONFIG_DIR
      }
    })

    it('opens the query with file checkpointing and the chat permission mode', async () => {
      const q = await openChat(makeChat({ permissionMode: 'plan' }))
      expect(q.options.enableFileCheckpointing).toBe(true)
      expect(q.options.permissionMode).toBe('plan')
      expect(q.options.allowDangerouslySkipPermissions).toBe(true)
    })

    it('starts every chat with the Claude in Chrome connection (--chrome)', async () => {
      const q = await openChat(makeChat())
      expect(q.options.extraArgs).toMatchObject({ chrome: null })
    })

    it('setPermissionMode forwards to the query', async () => {
      const q = await openChat()
      await runner.setPermissionMode('chat1', 'acceptEdits')
      expect(q.setPermissionMode).toHaveBeenCalledWith('acceptEdits')
    })

    it('setPermissionMode is a no-op without a query', async () => {
      await expect(runner.setPermissionMode('nobody', 'plan')).resolves.toBeUndefined()
      expect(queries).toHaveLength(0)
    })

    it('emits meta when a system message carries a permissionMode', async () => {
      const q = await openChat()
      q.emit({ type: 'system', subtype: 'status', status: null, permissionMode: 'plan' })
      await vi.waitFor(() => expect(emitMeta).toHaveBeenCalledWith('chat1', { permissionMode: 'plan' }))
    })

    it('ignores a system permissionMode the composer does not offer', async () => {
      const q = await openChat()
      q.emit({ type: 'system', subtype: 'status', permissionMode: 'dontAsk' })
      await new Promise((r) => setTimeout(r, 30))
      expect(emitMeta).not.toHaveBeenCalledWith('chat1', { permissionMode: 'dontAsk' })
    })

    it('forwards rate_limit_event info to deps.onRateLimit', async () => {
      const q = await openChat()
      const info = { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.4 }
      q.emit({ type: 'rate_limit_event', rate_limit_info: info })
      await vi.waitFor(() => expect(onRateLimit).toHaveBeenCalledWith(info, 1))
    })
  })

  // -------------------------------------------------------------------------
  describe('permission cards', () => {
    const suggestions = [{ type: 'addRules', behavior: 'allow', destination: 'session', rules: [] }]
    const bashInput = { command: 'npm test' }

    async function askCard(opts: Record<string, unknown> = {}, mode: ChatMeta['permissionMode'] = 'default') {
      const q = await openChat(makeChat({ permissionMode: mode }))
      const pending = q.options.canUseTool('Bash', bashInput, {
        toolUseID: 't1',
        title: 'Claude wants to run npm test',
        description: 'Runs the test suite',
        suggestions,
        ...opts
      })
      return { q, pending }
    }

    it('shows a pending permission item and reports waiting in default mode', async () => {
      await askCard()
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'permission'))
      expect(upserts()).toContainEqual({
        kind: 'permission',
        id: 't1',
        toolName: 'Bash',
        title: 'Claude wants to run npm test',
        description: 'Runs the test suite',
        summary: 'npm test',
        canAlwaysAllow: true,
        state: 'pending'
      })
    })

    it('uses a default title and no always-allow without suggestions', async () => {
      await askCard({ title: undefined, description: undefined, suggestions: undefined })
      await vi.waitFor(() =>
        expect(upserts()).toContainEqual(
          expect.objectContaining({
            kind: 'permission',
            id: 't1',
            title: 'Claude wants to use Bash',
            canAlwaysAllow: false
          })
        )
      )
    })

    it('does not offer always-allow when the SDK suppresses the rule', async () => {
      await askCard({ suppressAlwaysAllowRule: true })
      await vi.waitFor(() =>
        expect(upserts()).toContainEqual(
          expect.objectContaining({ kind: 'permission', id: 't1', canAlwaysAllow: false })
        )
      )
    })

    it('also asks in acceptEdits mode', async () => {
      await askCard({}, 'acceptEdits')
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'permission'))
    })

    it('allow resolves with the input, upserts state allowed and goes busy', async () => {
      const { pending } = await askCard()
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'permission'))
      emitStatus.mockClear()
      expect(runner.decidePermission('chat1', 't1', { allow: true })).toBe(true)
      expect(await pending).toEqual({ behavior: 'allow', updatedInput: bashInput })
      expect(upserts()).toContainEqual(
        expect.objectContaining({ kind: 'permission', id: 't1', state: 'allowed' })
      )
      expect(emitStatus).toHaveBeenCalledWith('chat1', 'busy')
    })

    it('keeps the decision on the tool step after the tool runs (approval)', async () => {
      const { q } = await askCard()
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'permission'))
      q.emit({
        type: 'assistant',
        uuid: 'a-1',
        parent_tool_use_id: null,
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: bashInput }] }
      })
      runner.decidePermission('chat1', 't1', { allow: true, always: true })
      q.emit({
        type: 'user',
        uuid: 'u-1',
        parent_tool_use_id: null,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '3 passed' }] }
      })
      await vi.waitFor(() =>
        expect(upserts()).toContainEqual(
          expect.objectContaining({ kind: 'tool', id: 't1', status: 'ok', approval: 'always' })
        )
      )
    })

    it('allow always passes the suggestions as updatedPermissions', async () => {
      const { pending } = await askCard()
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'permission'))
      expect(runner.decidePermission('chat1', 't1', { allow: true, always: true })).toBe(true)
      expect(await pending).toEqual({
        behavior: 'allow',
        updatedInput: bashInput,
        updatedPermissions: suggestions
      })
    })

    it('deny resolves with the message and upserts state denied', async () => {
      const { pending } = await askCard()
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'permission'))
      emitStatus.mockClear()
      expect(runner.decidePermission('chat1', 't1', { allow: false, message: 'not now' })).toBe(true)
      expect(await pending).toEqual({ behavior: 'deny', message: 'not now' })
      expect(upserts()).toContainEqual(
        expect.objectContaining({ kind: 'permission', id: 't1', state: 'denied' })
      )
      expect(emitStatus).toHaveBeenCalledWith('chat1', 'busy')
    })

    it('deny without a message uses the default message', async () => {
      const { pending } = await askCard()
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'permission'))
      runner.decidePermission('chat1', 't1', { allow: false })
      expect(await pending).toEqual({ behavior: 'deny', message: 'The user denied this action.' })
    })

    it('returns false for an unknown id or chat', async () => {
      await openChat()
      expect(runner.decidePermission('chat1', 'missing', { allow: true })).toBe(false)
      expect(runner.decidePermission('unknown-chat', 'missing', { allow: false })).toBe(false)
    })

    it('allows other tools immediately in bypassPermissions mode', async () => {
      const q = await openChat(makeChat({ permissionMode: 'bypassPermissions' }))
      const res = await q.options.canUseTool('Bash', bashInput, { toolUseID: 't1', suggestions })
      expect(res).toEqual({ behavior: 'allow', updatedInput: bashInput })
      expect(upserts().some((i) => i.kind === 'permission')).toBe(false)
      expect(emitStatus).not.toHaveBeenCalledWith('chat1', 'waiting', 'permission')
    })

    it('still routes AskUserQuestion to the question flow in default mode', async () => {
      const q = await openChat(makeChat({ permissionMode: 'default' }))
      void q.options.canUseTool('AskUserQuestion', { questions: [] }, { toolUseID: 'tq' })
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'question'))
      expect(upserts().some((i) => i.kind === 'permission')).toBe(false)
    })

    it('follows setPermissionMode for later tool calls', async () => {
      const q = await openChat(makeChat({ permissionMode: 'bypassPermissions' }))
      await runner.setPermissionMode('chat1', 'default')
      void q.options.canUseTool('Bash', bashInput, { toolUseID: 't2' })
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'permission'))

      await runner.setPermissionMode('chat1', 'bypassPermissions')
      const res = await q.options.canUseTool('Bash', bashInput, { toolUseID: 't3' })
      expect(res).toEqual({ behavior: 'allow', updatedInput: bashInput })
    })

    it('allows tools in plan mode with no permission card', async () => {
      const q = await openChat(makeChat({ permissionMode: 'plan' }))
      const res = await q.options.canUseTool('Bash', bashInput, { toolUseID: 'tp', suggestions })
      expect(res).toEqual({ behavior: 'allow', updatedInput: bashInput })
      expect(upserts().some((i) => i.kind === 'permission')).toBe(false)
      expect(emitStatus).not.toHaveBeenCalledWith('chat1', 'waiting', 'permission')
    })

    it('allows tools after switching to plan mode with setPermissionMode', async () => {
      const q = await openChat(makeChat({ permissionMode: 'default' }))
      await runner.setPermissionMode('chat1', 'plan')
      const res = await q.options.canUseTool('Bash', bashInput, { toolUseID: 'tp2' })
      expect(res).toEqual({ behavior: 'allow', updatedInput: bashInput })
      expect(upserts().some((i) => i.kind === 'permission')).toBe(false)
    })

    it('still asks AskUserQuestion and ExitPlanMode in plan mode', async () => {
      const q = await openChat(makeChat({ permissionMode: 'plan' }))
      void q.options.canUseTool('AskUserQuestion', { questions: [] }, { toolUseID: 'tq' })
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'question'))
      void q.options.canUseTool('ExitPlanMode', { plan: 'do it' }, { toolUseID: 'te' })
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'waiting', 'plan'))
    })

    it('follows a mode change reported by the CLI', async () => {
      const q = await openChat(makeChat({ permissionMode: 'plan' }))
      q.emit({ type: 'system', subtype: 'status', permissionMode: 'bypassPermissions' })
      await vi.waitFor(() =>
        expect(emitMeta).toHaveBeenCalledWith('chat1', { permissionMode: 'bypassPermissions' })
      )
      const res = await q.options.canUseTool('Bash', bashInput, { toolUseID: 't4' })
      expect(res).toEqual({ behavior: 'allow', updatedInput: bashInput })
    })
  })

  // -------------------------------------------------------------------------
  describe('send with interrupt (stop and send)', () => {
    it('interrupts the running turn and pushes the message only after its result', async () => {
      const chat = makeChat()
      const q = await openChat(chat)
      await vi.waitFor(() => expect(q.pushed).toHaveLength(1))

      const sending = runner.send(chat, input('second'), { interrupt: true })
      await vi.waitFor(() => expect(q.interrupt).toHaveBeenCalledTimes(1))
      await new Promise((r) => setTimeout(r, 40))
      expect(q.pushed).toHaveLength(1)

      q.emit({ type: 'result', subtype: 'error_during_execution', is_error: true })
      await sending
      await vi.waitFor(() => expect(q.pushed).toHaveLength(2))
      expect(q.pushed[1].message.content).toBe('second')
    })

    it('pushes after at most 5 s even when no result arrives', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const chat = makeChat()
      const q = await openChat(chat)
      await vi.waitFor(() => expect(q.pushed).toHaveLength(1))

      const sending = runner.send(chat, input('second'), { interrupt: true })
      await vi.advanceTimersByTimeAsync(4000)
      expect(q.pushed).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1500)
      await sending
      await vi.waitFor(() => expect(q.pushed).toHaveLength(2))
    })

    it('does not interrupt when no turn is running', async () => {
      const chat = makeChat()
      const q = await openChat(chat)
      q.emit({ type: 'result', subtype: 'success', is_error: false })
      await vi.waitFor(() => expect(emitStatus).toHaveBeenCalledWith('chat1', 'idle'))

      await runner.send(chat, input('next'), { interrupt: true })
      expect(q.interrupt).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(q.pushed).toHaveLength(2))
    })

    it('a plain send while a turn runs queues without interrupting', async () => {
      const chat = makeChat()
      const q = await openChat(chat)
      await runner.send(chat, input('queued'))
      expect(q.interrupt).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(q.pushed).toHaveLength(2))
    })
  })

  // -------------------------------------------------------------------------
  describe('rewind', () => {
    const fork = { forkFrom: 'a1', userUuid: 'u2' }

    it('closes the chat query and makes the next open resume at forkFrom, once', async () => {
      const chat = makeChat({ started: true })
      const q0 = await openChat(chat)

      const res = await runner.rewind(chat, { ...fork, revertFiles: false })
      expect(res.error).toBeUndefined()
      expect(q0.close).toHaveBeenCalled()
      expect(runner.isRunning('chat1')).toBe(false)
      expect(q0.rewindFiles).not.toHaveBeenCalled()

      await runner.send(chat, input('edited'))
      const q1 = queries[queries.length - 1]
      expect(q1).not.toBe(q0)
      expect(q1.options.resume).toBe('sess-1')
      expect(q1.options.resumeSessionAt).toBe('a1')

      runner.close('chat1')
      await runner.send(chat, input('later'))
      const q2 = queries[queries.length - 1]
      expect(q2).not.toBe(q1)
      expect(q2.options.resumeSessionAt).toBeUndefined()
    })

    it('works without an open query', async () => {
      const chat = makeChat({ started: true })
      const res = await runner.rewind(chat, { ...fork, revertFiles: false })
      expect(res.error).toBeUndefined()
      expect(queries).toHaveLength(0)
      await runner.send(chat, input('edited'))
      expect(queries[0].options.resumeSessionAt).toBe('a1')
    })

    it('with revertFiles opens a resume query, rewinds to the user message and closes it', async () => {
      const chat = makeChat({ started: true })
      const q0 = await openChat(chat)

      const res = await runner.rewind(chat, { ...fork, revertFiles: true })
      expect(q0.close).toHaveBeenCalled()
      expect(queries).toHaveLength(2)
      const rq = queries[1]
      expect(rq.options.resume).toBe('sess-1')
      expect(rq.options.enableFileCheckpointing).toBe(true)
      expect(rq.rewindFiles).toHaveBeenCalledWith('u2', expect.anything())
      expect(rq.close).toHaveBeenCalled()
      expect(res).toEqual({ filesChanged: 2 })
      expect(runner.isRunning('chat1')).toBe(false)

      await runner.send(chat, input('edited'))
      expect(queries[2].options.resumeSessionAt).toBe('a1')
    })

    it('returns the error instead of throwing when rewindFiles fails', async () => {
      const chat = makeChat({ started: true })
      await openChat(chat)
      hooks.rewindError = new Error('boom: no checkpoint')
      const res = await runner.rewind(chat, { ...fork, revertFiles: true })
      expect(res.error).toContain('boom: no checkpoint')
      expect(queries[1].close).toHaveBeenCalled()
      // The fork point is still applied to the next open.
      hooks.rewindError = undefined
      await runner.send(chat, input('edited'))
      expect(queries[queries.length - 1].options.resumeSessionAt).toBe('a1')
    })
  })

  // -------------------------------------------------------------------------
  describe('usage and commands', () => {
    it('usage() queries the chat query with skipBehaviors', async () => {
      const q = await openChat()
      expect(await runner.usage('chat1')).toEqual(USAGE_RESP)
      expect(q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET).toHaveBeenCalledWith({
        skipBehaviors: true
      })
    })

    it('usage() falls back to any open query', async () => {
      const q = await openChat()
      expect(await runner.usage('other-chat')).toEqual(USAGE_RESP)
      expect(await runner.usage()).toEqual(USAGE_RESP)
      expect(q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET).toHaveBeenCalled()
    })

    it('usage() is null without an open query', async () => {
      expect(await runner.usage('chat1')).toBeNull()
      expect(await runner.usage()).toBeNull()
    })

    it('usage() is null when the SDK call fails', async () => {
      const q = await openChat()
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET.mockRejectedValueOnce(new Error('x'))
      expect(await runner.usage('chat1')).toBeNull()
    })

    it('commands() returns supportedCommands of the open query', async () => {
      const q = await openChat()
      const out = await runner.commands('chat1')
      expect(q.supportedCommands).toHaveBeenCalled()
      expect(out).toMatchObject(COMMANDS)
    })

    it('commands() is null without a query or on error', async () => {
      expect(await runner.commands('chat1')).toBeNull()
      const q = await openChat()
      q.supportedCommands.mockRejectedValueOnce(new Error('x'))
      expect(await runner.commands('chat1')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  describe('probes', () => {
    it('probeUsage opens an idle query in cwd, reads usage and closes it', async () => {
      const resp = await runner.probeUsage('C:\\work\\p1')
      expect(resp).toEqual(USAGE_RESP)
      expect(queries).toHaveLength(1)
      const q = queries[0]
      expect(q.options.cwd).toBe('C:\\work\\p1')
      expect(q.options.pathToClaudeCodeExecutable).toBe('C:\\bin\\claude.exe')
      expect(q.options.env).not.toHaveProperty('ANTHROPIC_API_KEY')
      expect(q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET).toHaveBeenCalledWith({
        skipBehaviors: true
      })
      expect(q.pushed).toHaveLength(0)
      expect(q.close).toHaveBeenCalled()
      expect(runner.isRunning('chat1')).toBe(false)
    })

    it('probeUsage is null when the probe fails', async () => {
      hooks.usageError = new Error('nope')
      expect(await runner.probeUsage('C:\\work\\p1')).toBeNull()
      expect(queries[0].close).toHaveBeenCalled()
    })

    it('probeCommands opens an idle query in cwd, reads the commands and closes it', async () => {
      const out = await runner.probeCommands('C:\\work\\p1')
      expect(out).toMatchObject(COMMANDS)
      expect(queries).toHaveLength(1)
      const q = queries[0]
      expect(q.options.cwd).toBe('C:\\work\\p1')
      expect(q.options.env).not.toHaveProperty('ANTHROPIC_API_KEY')
      expect(q.pushed).toHaveLength(0)
      expect(q.close).toHaveBeenCalled()
    })

    it('probeCommands is [] when the probe fails', async () => {
      hooks.commandsError = new Error('nope')
      expect(await runner.probeCommands('C:\\work\\p1')).toEqual([])
    })
  })
  // -------------------------------------------------------------------------
  describe('events shown while the chat is open', () => {
    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
    const NOTE = 'Compacting context…'

    function removed(): string[] {
      return (emitItems.mock.calls as [ChatItemsEvent][]).flatMap(([e]) => e.remove ?? [])
    }

    function noteId(text: string): string {
      const item = upserts().find((i) => i.kind === 'system' && i.text === text)
      if (!item) throw new Error('no note: ' + text)
      return item.id
    }

    it('shows the compaction note', async () => {
      const q = await openChat()
      q.emit({ type: 'system', subtype: 'compact_boundary', uuid: 'b1', session_id: 's' })
      await flush()
      expect(upserts()).toContainEqual({ kind: 'system', id: 'b1', text: 'Context compacted' })
    })

    it('shows progress while compacting and removes it at the end', async () => {
      const q = await openChat()
      q.emit({ type: 'system', subtype: 'status', status: 'compacting', uuid: 'x', session_id: 's' })
      await flush()
      const id = noteId(NOTE)
      expect(removed()).not.toContain(id)
      q.emit({ type: 'system', subtype: 'status', status: null, compact_result: 'success', uuid: 'y', session_id: 's' })
      await flush()
      expect(removed()).toContain(id)
    })

    it('keeps the progress note during a requesting status', async () => {
      const q = await openChat()
      q.emit({ type: 'system', subtype: 'status', status: 'compacting', uuid: 'x', session_id: 's' })
      await flush()
      const id = noteId(NOTE)
      q.emit({ type: 'system', subtype: 'status', status: 'requesting', uuid: 'y', session_id: 's' })
      await flush()
      expect(removed()).not.toContain(id)
    })

    it('shows an error when compacting fails', async () => {
      const q = await openChat()
      q.emit({ type: 'system', subtype: 'status', status: 'compacting', uuid: 'x', session_id: 's' })
      q.emit({
        type: 'system',
        subtype: 'status',
        status: null,
        compact_result: 'failed',
        compact_error: 'too small',
        uuid: 'y',
        session_id: 's'
      })
      await flush()
      expect(upserts()).toContainEqual(
        expect.objectContaining({ kind: 'system', tone: 'error', text: 'Compacting failed: too small' })
      )
    })

    it('shows a retry note until the next message arrives', async () => {
      const q = await openChat()
      q.emit({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 1000, uuid: 'x', session_id: 's' })
      await flush()
      const id = noteId('API error. Retrying (attempt 2 of 10)')
      q.emit({ type: 'stream_event', event: { type: 'message_start' }, parent_tool_use_id: null })
      await flush()
      expect(removed()).toContain(id)
    })

    it('shows task notifications, notices and refusals', async () => {
      const q = await openChat()
      q.emit({ type: 'system', subtype: 'task_notification', status: 'completed', summary: 'Task done', output_file: 'C:\\t\\a.output', uuid: 't1', session_id: 's' })
      q.emit({ type: 'system', subtype: 'informational', level: 'warning', content: 'Careful', uuid: 'i1', session_id: 's' })
      q.emit({ type: 'system', subtype: 'model_refusal_fallback', content: 'Retried on Sonnet', uuid: 'm1', session_id: 's' })
      await flush()
      expect(upserts()).toEqual(
        expect.arrayContaining([
          { kind: 'system', id: 't1', tone: 'info', text: 'Task done' },
          { kind: 'system', id: 'i1', tone: 'info', text: 'Careful' },
          { kind: 'system', id: 'm1', tone: 'info', text: 'Retried on Sonnet' }
        ])
      )
    })

    it('hides the task event of a foreground command', async () => {
      const q = await openChat()
      q.emit({ type: 'system', subtype: 'task_notification', status: 'completed', summary: 'Ping', output_file: '', uuid: 't1', session_id: 's' })
      await flush()
      expect(upserts().some((i) => i.kind === 'system' && i.text === 'Ping')).toBe(false)
    })

    it('tells the service when /clear resets the conversation', async () => {
      const q = await openChat()
      q.emit({ type: 'conversation_reset', trigger: 'clear', new_conversation_id: 'n', uuid: 'r', session_id: 's' })
      await flush()
      expect(onConversationCleared).toHaveBeenCalledWith('chat1')
    })

    it('ignores a reset that is not from /clear', async () => {
      const q = await openChat()
      q.emit({ type: 'conversation_reset', trigger: 'plan_mode_exit', new_conversation_id: 'n', uuid: 'r', session_id: 's' })
      await flush()
      expect(onConversationCleared).not.toHaveBeenCalled()
    })
  })
})

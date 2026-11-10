import { beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import {
  applyRecord,
  createParserState,
  getItems,
  getMeta,
  parseLines,
  toolSummary,
  type ParserState,
  type TranscriptRecord
} from '../../src/main/chat/transcriptParser'
import type { ChatItem } from '../../src/shared/types'

function byId<K extends ChatItem['kind']>(items: ChatItem[], id: string, kind?: K) {
  const found = items.find((i) => i.id === id)
  expect(found, `item ${id}`).toBeDefined()
  if (kind) expect(found!.kind).toBe(kind)
  return found as Extract<ChatItem, { kind: K }>
}

function assistantTool(
  uuid: string,
  block: Record<string, unknown>,
  extra: Partial<TranscriptRecord> = {}
): TranscriptRecord {
  return {
    type: 'assistant',
    uuid,
    message: { id: 'm-' + uuid, role: 'assistant', content: [block] },
    ...extra
  }
}

function toolResult(
  toolUseId: string,
  content: unknown,
  extra: Partial<TranscriptRecord> & { isError?: boolean } = {}
): TranscriptRecord {
  const { isError, ...rest } = extra
  return {
    type: 'user',
    uuid: 'res-' + toolUseId,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          ...(isError ? { is_error: true } : {})
        }
      ]
    },
    ...rest
  }
}

describe('fixture transcript-chat.jsonl', () => {
  let state: ParserState
  let items: ChatItem[]

  beforeAll(async () => {
    const raw = await fs.readFile(join(__dirname, '..', 'fixtures', 'transcript-chat.jsonl'), 'utf8')
    state = createParserState()
    parseLines(state, raw.split('\n'))
    items = getItems(state)
  })

  it('ignores meta, caveat, stdout and system-reminder user lines', () => {
    const ids = items.map((i) => i.id)
    for (const id of ['u-meta', 'u-caveat', 'u-stdout', 'u-reminder']) {
      expect(ids).not.toContain(id)
    }
  })

  it('turns a <command-name> line into a command item', () => {
    const cmd = items.find((i) => i.kind === 'command')
    expect(cmd).toMatchObject({ kind: 'command', name: '/cost', args: 'today' })
  })

  it('parses a typed user prompt into text, directives and file attachments', () => {
    const user = byId(items, 'u-1', 'user')
    expect(user.text).toBe('fix the bug')
    expect(user.directives).toEqual({ codex: 'tests', think: true })
    expect(user.attachments).toEqual([{ name: 'todo.md', kind: 'file' }])
  })

  it('creates a user item with an image attachment from array content', () => {
    const user = byId(items, 'u-2', 'user')
    expect(user.text).toBe('now look at this')
    expect(user.attachments).toEqual([{ name: 'image', kind: 'image' }])
  })

  it('creates one assistant item per text block with id uuid:index', () => {
    const a = byId(items, 'a-text:0', 'assistant')
    expect(a.markdown).toBe('I will start by reading the file.')
  })

  it('creates a thinking item', () => {
    const t = items.find((i) => i.kind === 'thinking')
    expect(t).toMatchObject({ kind: 'thinking', text: 'Let me look at the code' })
  })

  it('creates a tool item for Read and completes it from the tool_result', () => {
    const t = byId(items, 'toolu_read', 'tool')
    expect(t.name).toBe('Read')
    expect(t.summary).toBe('src/a.ts')
    expect(t.status).toBe('ok')
    expect(t.result).toBe('first real line')
  })

  it('replaces the Edit diff with the structuredPatch from the result', () => {
    const t = byId(items, 'toolu_edit', 'tool')
    expect(t.status).toBe('ok')
    expect(t.diff).toBeDefined()
    expect(t.diff!.added).toBe(1)
    expect(t.diff!.removed).toBe(1)
    expect(t.diff!.lines[0]).toMatchObject({ type: 'ctx', text: 'context line', oldNo: 10, newNo: 10 })
  })

  it('marks an is_error Bash result as error with its first line', () => {
    const t = byId(items, 'toolu_bash', 'tool')
    expect(t.summary).toBe('npm test')
    expect(t.status).toBe('error')
    expect(t.result).toBe('Exit code 1')
  })

  it('summarises Grep as "pattern" in path', () => {
    expect(byId(items, 'toolu_grep', 'tool').summary).toBe('"TODO" in src')
  })

  it('builds the agent item, counts sidechain tool calls and takes its result', () => {
    const a = byId(items, 'toolu_agent', 'agent')
    expect(a.agentType).toBe('Explore')
    expect(a.description).toBe('Find the parser')
    expect(a.toolCount).toBe(2)
    expect(a.status).toBe('ok')
    expect(a.result).toBe('Found it in parser.ts')
  })

  it('creates no items for sidechain records', () => {
    const ids = items.map((i) => i.id)
    expect(ids).not.toContain('toolu_side1')
    expect(ids).not.toContain('toolu_side2')
  })

  it('resolves an answered question with its answers map', () => {
    const q = byId(items, 'toolu_q1', 'question')
    expect(q.state).toBe('answered')
    expect(q.answers).toEqual({ 'Which db?': 'Postgres' })
    expect(q.questions[0].options.map((o) => o.label)).toEqual(['Postgres', 'SQLite'])
  })

  it('marks an is_error question result as skipped', () => {
    expect(byId(items, 'toolu_q2', 'question').state).toBe('skipped')
  })

  it('marks plans approved or rejected from the result text', () => {
    expect(byId(items, 'toolu_plan1', 'plan')).toMatchObject({ plan: '1. do it', state: 'approved' })
    expect(byId(items, 'toolu_plan2', 'plan').state).toBe('rejected')
  })

  it('attaches a write diff with every line added', () => {
    const t = byId(items, 'toolu_write', 'tool')
    expect(t.diff!.added).toBe(3)
    expect(t.diff!.removed).toBe(0)
  })

  it('maps turn_duration to turn-end and compact_boundary to a system item only', () => {
    const ends = items.filter((i) => i.kind === 'turn-end')
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ durationMs: 4200 })
    const sys = items.filter((i) => i.kind === 'system')
    expect(sys).toHaveLength(1)
    expect(sys[0]).toMatchObject({ text: 'Context compacted' })
  })

  it('collects meta from ai-title, assistant and record fields', () => {
    const meta = getMeta(state)
    expect(meta.aiTitle).toBe('Fix the bug')
    expect(meta.model).toBe('claude-opus-5-5')
    expect(meta.effort).toBe('xhigh')
    expect(meta.gitBranch).toBe('pb/fix')
    expect(meta.cwd).toBe('C:\\proj')
    expect(meta.contextTokens).toBe(8007)
    expect(meta.totalTokens).toBeGreaterThan(0)
  })

  it('keeps items in first-seen order', () => {
    const ids = items.map((i) => i.id)
    expect(ids.indexOf('u-1')).toBeLessThan(ids.indexOf('toolu_read'))
    expect(ids.indexOf('toolu_read')).toBeLessThan(ids.indexOf('toolu_write'))
    expect(ids.indexOf('toolu_write')).toBeLessThan(ids.indexOf('u-2'))
  })
})

describe('applyRecord (incremental upserts)', () => {
  it('returns the created tool item when a tool_use arrives', () => {
    const s = createParserState()
    const out = applyRecord(s, assistantTool('a1', { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'tool', id: 't1', name: 'Bash', summary: 'ls', status: 'running' })
  })

  it('returns the updated item when its tool_result arrives', () => {
    const s = createParserState()
    applyRecord(s, assistantTool('a1', { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }))
    const out = applyRecord(s, toolResult('t1', 'a\nb'))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 't1', status: 'ok', result: 'a' })
  })

  it('truncates the result line to 120 characters', () => {
    const s = createParserState()
    applyRecord(s, assistantTool('a1', { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }))
    applyRecord(s, toolResult('t1', 'x'.repeat(300)))
    const t = byId(getItems(s), 't1', 'tool')
    expect(t.result!.length).toBeLessThanOrEqual(120)
  })

  it('defaults a Task tool to the general-purpose agent type', () => {
    const s = createParserState()
    const out = applyRecord(s, assistantTool('a1', { type: 'tool_use', id: 'ag', name: 'Task', input: {} }))
    expect(out[0]).toMatchObject({ kind: 'agent', agentType: 'general-purpose', description: '', status: 'running' })
  })

  it('creates a pending question and a pending plan', () => {
    const s = createParserState()
    const q = applyRecord(
      s,
      assistantTool('a1', { type: 'tool_use', id: 'q', name: 'AskUserQuestion', input: { questions: [] } })
    )
    expect(q[0]).toMatchObject({ kind: 'question', id: 'q', state: 'pending' })
    const p = applyRecord(s, assistantTool('a2', { type: 'tool_use', id: 'p', name: 'ExitPlanMode', input: {} }))
    expect(p[0]).toMatchObject({ kind: 'plan', id: 'p', plan: '', state: 'pending' })
  })

  it('creates an Edit diff from old_string/new_string and a MultiEdit diff from edits', () => {
    const s = createParserState()
    const e = applyRecord(
      s,
      assistantTool('a1', {
        type: 'tool_use',
        id: 'e',
        name: 'Edit',
        input: { file_path: 'f.ts', old_string: 'a', new_string: 'b' }
      })
    )
    expect(e[0]).toMatchObject({ kind: 'tool', diff: { file: 'f.ts', added: 1, removed: 1 } })
    const m = applyRecord(
      s,
      assistantTool('a2', {
        type: 'tool_use',
        id: 'm',
        name: 'MultiEdit',
        input: {
          file_path: 'f.ts',
          edits: [
            { old_string: 'a', new_string: 'b' },
            { old_string: 'c', new_string: 'd' }
          ]
        }
      })
    )
    const mt = m[0] as Extract<ChatItem, { kind: 'tool' }>
    expect(mt.diff!.added).toBe(2)
    expect(mt.diff!.removed).toBe(2)
  })

  it('marks an unrecognised question answer text as skipped', () => {
    const s = createParserState()
    applyRecord(s, assistantTool('a1', { type: 'tool_use', id: 'q', name: 'AskUserQuestion', input: { questions: [] } }))
    applyRecord(s, toolResult('q', 'something without pairs'))
    expect(byId(getItems(s), 'q', 'question').state).toBe('skipped')
  })

  it('returns the running agent as an upsert when a sidechain tool_use arrives', () => {
    const s = createParserState()
    applyRecord(s, assistantTool('a1', { type: 'tool_use', id: 'ag', name: 'Agent', input: { subagent_type: 'Explore' } }))
    const out = applyRecord(
      s,
      assistantTool('s1', { type: 'tool_use', id: 'st', name: 'Read', input: { file_path: 'x' } }, { isSidechain: true })
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'agent', id: 'ag', toolCount: 1 })
  })

  it('accumulates totalTokens over all four usage fields and keeps the latest contextTokens', () => {
    const s = createParserState()
    const usage1 = { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 }
    const usage2 = { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 }
    applyRecord(s, { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'x' }], usage: usage1 } })
    applyRecord(s, { type: 'assistant', uuid: 'a2', message: { content: [{ type: 'text', text: 'y' }], usage: usage2 } })
    const meta = getMeta(s)
    expect(meta.totalTokens).toBe(110)
    expect(meta.contextTokens).toBe(80)
  })

  it('ignores an invalid effort value', () => {
    const s = createParserState()
    applyRecord(s, { type: 'assistant', uuid: 'a1', effort: 'bogus', message: { content: [{ type: 'text', text: 'x' }] } })
    expect(getMeta(s).effort).toBeUndefined()
  })

  it('records gitBranch and cwd from any record', () => {
    const s = createParserState()
    applyRecord(s, { type: 'progress', gitBranch: 'dev', cwd: 'C:\\x' })
    expect(getMeta(s)).toMatchObject({ gitBranch: 'dev', cwd: 'C:\\x' })
  })

  it('creates nothing for unknown record types', () => {
    const s = createParserState()
    expect(applyRecord(s, { type: 'file-history-snapshot' })).toEqual([])
    expect(applyRecord(s, { type: 'system', subtype: 'whatever' })).toEqual([])
    expect(getItems(s)).toEqual([])
  })
})

describe('parseLines', () => {
  it('skips empty lines and invalid JSON', () => {
    const s = createParserState()
    const out = parseLines(s, [
      '',
      '   ',
      '{not json',
      JSON.stringify({ type: 'user', uuid: 'u', message: { role: 'user', content: 'hello' } })
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'user', id: 'u', text: 'hello' })
  })
})

describe('toolSummary', () => {
  it('returns file paths relative to cwd with forward slashes', () => {
    for (const name of ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      expect(toolSummary(name, { file_path: 'C:\\proj\\src\\a.ts' }, 'C:\\proj')).toBe('src/a.ts')
    }
  })

  it('uses the first line of a Bash or PowerShell command, max 100', () => {
    expect(toolSummary('Bash', { command: 'npm test\nmore' })).toBe('npm test')
    expect(toolSummary('PowerShell', { command: 'Get-Date\nx' })).toBe('Get-Date')
    expect(toolSummary('Bash', { command: 'x'.repeat(300) }).length).toBeLessThanOrEqual(100)
  })

  it('formats Grep with the pattern and path, defaulting the path to "."', () => {
    expect(toolSummary('Grep', { pattern: 'foo', path: 'src' })).toBe('"foo" in src')
    expect(toolSummary('Grep', { pattern: 'foo' })).toBe('"foo" in .')
  })

  it('handles Glob, WebFetch, WebSearch, Skill and TodoWrite', () => {
    expect(toolSummary('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts')
    expect(toolSummary('WebFetch', { url: 'https://x.dev' })).toBe('https://x.dev')
    expect(toolSummary('WebSearch', { query: 'vitest' })).toBe('vitest')
    expect(toolSummary('Skill', { skill: 'commit' })).toBe('commit')
    expect(toolSummary('TodoWrite', { todos: [{}, {}, {}] })).toBe('3 todos')
  })

  it('falls back to the first string field or an empty string', () => {
    expect(toolSummary('Mystery', { n: 1, s: 'hello' })).toBe('hello')
    expect(toolSummary('Mystery', { n: 1 })).toBe('')
    expect(toolSummary('Mystery', null)).toBe('')
  })
})

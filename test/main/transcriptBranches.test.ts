import { describe, expect, it } from 'vitest'
import {
  applyRecord,
  createParserState,
  getItems,
  type ParserState,
  type TranscriptRecord
} from '../../src/main/chat/transcriptParser'

type Parent = string | null

describe('interrupt markers', () => {
  it('renders [Request interrupted by user] as a Stopped note, not a user message', () => {
    const s = createParserState()
    applyRecord(s, { type: 'user', uuid: 'u1', parentUuid: null, message: { role: 'user', content: 'hello' } })
    applyRecord(s, { type: 'user', uuid: 'u2', parentUuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } })
    const items = getItems(s)
    expect(items.filter((i) => i.kind === 'user')).toHaveLength(1)
    expect(items).toContainEqual(expect.objectContaining({ kind: 'system', tone: 'info', text: 'Stopped' }))
  })
})

const prompt = (uuid: string, parentUuid: Parent, text = uuid): TranscriptRecord => ({
  type: 'user',
  uuid,
  parentUuid,
  message: { role: 'user', content: text }
})

const promptBlocks = (uuid: string, parentUuid: Parent, text = uuid): TranscriptRecord => ({
  type: 'user',
  uuid,
  parentUuid,
  message: { role: 'user', content: [{ type: 'text', text }] }
})

const reply = (uuid: string, parentUuid: Parent, text = uuid): TranscriptRecord => ({
  type: 'assistant',
  uuid,
  parentUuid,
  message: { id: 'm-' + uuid, role: 'assistant', content: [{ type: 'text', text }] }
})

const toolUse = (uuid: string, parentUuid: Parent, toolId: string): TranscriptRecord => ({
  type: 'assistant',
  uuid,
  parentUuid,
  message: {
    id: 'm-' + uuid,
    role: 'assistant',
    content: [{ type: 'tool_use', id: toolId, name: 'Bash', input: { command: 'echo ' + toolId } }]
  }
})

const toolResult = (uuid: string, parentUuid: Parent, toolId: string): TranscriptRecord => ({
  type: 'user',
  uuid,
  parentUuid,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: 'out' }] }
})

function feed(state: ParserState, ...records: TranscriptRecord[]): void {
  for (const r of records) applyRecord(state, r)
}

const ids = (state: ParserState): string[] => getItems(state).map((i) => i.id)

describe('transcript parentUuid on user prompts', () => {
  it('is null for the first prompt and the previous chain uuid for later ones', () => {
    const s = createParserState()
    feed(s, prompt('u1', null), reply('a1', 'u1'), prompt('u2', 'a1'))
    const users = getItems(s).filter((i) => i.kind === 'user')
    expect(users.map((u) => [u.id, (u as { parentUuid?: string | null }).parentUuid])).toEqual([
      ['u1', null],
      ['u2', 'a1']
    ])
  })

  it('is also set for prompts given as text blocks', () => {
    const s = createParserState()
    feed(s, promptBlocks('u1', null))
    expect(getItems(s)[0]).toMatchObject({ kind: 'user', id: 'u1', parentUuid: null })
  })

  it('is null when the record has no parentUuid at all', () => {
    const s = createParserState()
    applyRecord(s, { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hi' } })
    expect(getItems(s)[0]).toMatchObject({ kind: 'user', id: 'u1', parentUuid: null })
  })
})

describe('transcript branch rule', () => {
  it('drops the abandoned branch when a later prompt forks at an earlier chain uuid', () => {
    const s = createParserState()
    feed(
      s,
      prompt('u1', null),
      reply('a1', 'u1'),
      prompt('u2', 'a1', 'old question'),
      reply('a2', 'u2'),
      toolUse('a3', 'a2', 'tool-old'),
      toolResult('r3', 'a3', 'tool-old')
    )
    expect(ids(s)).toEqual(['u1', 'a1:0', 'u2', 'a2:0', 'tool-old'])

    feed(s, prompt('u2b', 'a1', 'edited question'))
    expect(ids(s)).toEqual(['u1', 'a1:0', 'u2b'])
    expect(getItems(s).find((i) => i.id === 'u2b')).toMatchObject({
      kind: 'user',
      text: 'edited question',
      parentUuid: 'a1'
    })
  })

  it('continues the new branch normally afterwards', () => {
    const s = createParserState()
    feed(
      s,
      prompt('u1', null),
      reply('a1', 'u1'),
      prompt('u2', 'a1'),
      reply('a2', 'u2'),
      prompt('u2b', 'a1'),
      reply('a2b', 'u2b'),
      prompt('u3', 'a2b')
    )
    expect(ids(s)).toEqual(['u1', 'a1:0', 'u2b', 'a2b:0', 'u3'])
  })

  it('handles a fork at the first prompt of a chain (parent is a chain entry)', () => {
    const s = createParserState()
    feed(s, prompt('u1', null), reply('a1', 'u1'), prompt('u2', 'a1'), reply('a2', 'u2'))
    feed(s, prompt('u3', 'u1'))
    expect(ids(s)).toEqual(['u1', 'u3'])
  })

  it('supports a second fork over the already-forked branch', () => {
    const s = createParserState()
    feed(
      s,
      prompt('u1', null),
      reply('a1', 'u1'),
      prompt('u2', 'a1'),
      reply('a2', 'u2'),
      prompt('u2b', 'a1'),
      reply('a2b', 'u2b'),
      prompt('u2c', 'a1')
    )
    expect(ids(s)).toEqual(['u1', 'a1:0', 'u2c'])
  })

  it('also truncates for a fork prompt given as text blocks', () => {
    const s = createParserState()
    feed(s, prompt('u1', null), reply('a1', 'u1'), prompt('u2', 'a1'), reply('a2', 'u2'))
    feed(s, promptBlocks('u2b', 'a1'))
    expect(ids(s)).toEqual(['u1', 'a1:0', 'u2b'])
  })

  it('does not truncate on parallel tool calls (tool_result pointing at an earlier tool_use)', () => {
    const s = createParserState()
    feed(
      s,
      prompt('u1', null),
      toolUse('a1', 'u1', 'tool-a'),
      toolUse('a2', 'a1', 'tool-b'),
      toolResult('r1', 'a1', 'tool-a'),
      toolResult('r2', 'a2', 'tool-b'),
      reply('a3', 'r2', 'done')
    )
    expect(ids(s)).toEqual(['u1', 'tool-a', 'tool-b', 'a3:0'])
    const tools = getItems(s).filter((i) => i.kind === 'tool')
    expect(tools.map((t) => (t as { status: string }).status)).toEqual(['ok', 'ok'])
  })

  it('does not truncate when the prompt parent is an unknown uuid', () => {
    const s = createParserState()
    feed(s, prompt('u1', null), reply('a1', 'u1'), prompt('u2', 'never-seen'))
    expect(ids(s)).toEqual(['u1', 'a1:0', 'u2'])
  })

  it('does not truncate when a later prompt has a null parent', () => {
    const s = createParserState()
    feed(s, prompt('u1', null), reply('a1', 'u1'), prompt('u2', null))
    expect(ids(s)).toEqual(['u1', 'a1:0', 'u2'])
  })

  it('does not truncate when the prompt continues from the current tip', () => {
    const s = createParserState()
    feed(s, prompt('u1', null), reply('a1', 'u1'), prompt('u2', 'a1'), reply('a2', 'u2'))
    feed(s, prompt('u3', 'a2'))
    expect(ids(s)).toEqual(['u1', 'a1:0', 'u2', 'a2:0', 'u3'])
  })
})

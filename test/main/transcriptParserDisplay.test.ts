import { describe, expect, it } from 'vitest'
import {
  applyRecord,
  createParserState,
  getItems,
  getMeta,
  type TranscriptRecord
} from '../../src/main/chat/transcriptParser'
import type { ChatItem } from '../../src/shared/types'

const ESC = String.fromCharCode(27)

function parse(...records: TranscriptRecord[]): ChatItem[] {
  const s = createParserState()
  for (const r of records) applyRecord(s, r)
  return getItems(s)
}

const user = (uuid: string, content: unknown, extra: Partial<TranscriptRecord> = {}): TranscriptRecord => ({
  type: 'user',
  uuid,
  parentUuid: null,
  message: { role: 'user', content },
  ...extra
})

const taskXml = (status: string, summary: string): string =>
  `<task-notification>\n<task-id>abc</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>C:\\t\\abc.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`

describe('records that must not look like the user wrote them', () => {
  it('hides the compaction summary', () => {
    const items = parse(
      user('s1', 'This session is being continued from a previous conversation.', {
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true
      })
    )
    expect(items).toEqual([])
  })

  it('shows a background task notification as a quiet note', () => {
    const items = parse(user('t1', taskXml('completed', 'Background command "npm test" completed (exit code 0)')))
    expect(items).toEqual([
      {
        kind: 'system',
        id: 't1',
        tone: 'info',
        text: 'Background command "npm test" completed (exit code 0)'
      }
    ])
  })

  it('shows a failed background task as an error note', () => {
    const items = parse(user('t1', taskXml('failed', 'Agent "review" failed')))
    expect(items).toEqual([{ kind: 'system', id: 't1', tone: 'error', text: 'Agent "review" failed' }])
  })
})

describe('prompts sent while Claude was working', () => {
  const queued = (uuid: string, prompt: unknown): TranscriptRecord => ({
    type: 'attachment',
    uuid,
    parentUuid: 'p1',
    timestamp: '2026-11-07T10:37:50.456Z',
    attachment: { type: 'queued_command', prompt, commandMode: 'prompt', source_uuid: 'other' }
  })

  it('shows the queued prompt as a user message', () => {
    expect(parse(queued('q1', 'and fix those two things'))).toEqual([
      expect.objectContaining({ kind: 'user', id: 'q1', text: 'and fix those two things', parentUuid: 'p1' })
    ])
  })

  it('shows a queued task notification as a note', () => {
    expect(parse(queued('q1', taskXml('completed', 'Done')))).toEqual([
      { kind: 'system', id: 'q1', tone: 'info', text: 'Done' }
    ])
  })

  it('ignores other attachments', () => {
    const r: TranscriptRecord = { type: 'attachment', uuid: 'a1', attachment: { type: 'hook_success' } }
    expect(parse(r)).toEqual([])
  })

  it('ignores a prompt queued inside a subagent', () => {
    expect(parse({ ...queued('q1', 'inner'), isSidechain: true })).toEqual([])
  })
})

describe('local command output', () => {
  const local = (uuid: string, content: string): TranscriptRecord => ({
    type: 'system',
    subtype: 'local_command',
    uuid,
    content
  })

  it('shows a system output record with the id the live view uses', () => {
    expect(parse(local('c1', '<local-command-stdout>Not enough messages to compact.</local-command-stdout>'))).toEqual([
      { kind: 'assistant', id: 'c1:0', markdown: 'Not enough messages to compact.' }
    ])
  })

  it('shows a user output record', () => {
    expect(parse(user('c1', '<local-command-stdout>Set model to `Opus 5.5`</local-command-stdout>'))).toEqual([
      { kind: 'assistant', id: 'c1:0', markdown: 'Set model to `Opus 5.5`' }
    ])
  })

  it('shows stderr output', () => {
    expect(parse(user('c1', '<local-command-stderr>Failed</local-command-stderr>'))).toEqual([
      { kind: 'assistant', id: 'c1:0', markdown: 'Failed' }
    ])
  })

  it('removes terminal color codes', () => {
    const body = `${ESC}[1mContext${ESC}[22m usage`
    expect(parse(user('c1', `<local-command-stdout>${body}</local-command-stdout>`))).toEqual([
      { kind: 'assistant', id: 'c1:0', markdown: 'Context usage' }
    ])
  })

  it('hides empty output', () => {
    expect(parse(local('c1', '<local-command-stdout></local-command-stdout>'))).toEqual([])
  })

  it('hides "Compacted", because the compaction note says it', () => {
    expect(parse(user('c1', '<local-command-stdout>Compacted </local-command-stdout>'))).toEqual([])
  })

  it('strips the Ultra and Codex lines from the command chip', () => {
    const args = 'make it better\n\nultrathink'
    const items = parse(
      user('c1', `<command-message>x</command-message>\n<command-name>/x</command-name>\n<command-args>${args}</command-args>`)
    )
    expect(items).toEqual([{ kind: 'command', id: 'c1', name: '/x', args: 'make it better' }])
  })
})

describe('synthetic assistant records', () => {
  const synthetic = (uuid: string, text: string): TranscriptRecord => ({
    type: 'assistant',
    uuid,
    message: {
      role: 'assistant',
      model: '<synthetic>',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 0, output_tokens: 0 }
    }
  })
  const real: TranscriptRecord = {
    type: 'assistant',
    uuid: 'a1',
    message: {
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 100, output_tokens: 5 }
    }
  }

  it('hides "No response requested."', () => {
    expect(parse(synthetic('n1', 'No response requested.'))).toEqual([])
  })

  it('still shows other synthetic text', () => {
    expect(parse(synthetic('n1', '## Context Usage'))).toEqual([
      { kind: 'assistant', id: 'n1:0', markdown: '## Context Usage' }
    ])
  })

  it('does not take the model or the context size from a synthetic record', () => {
    const s = createParserState()
    applyRecord(s, real)
    const before = getMeta(s)
    applyRecord(s, synthetic('n1', 'You are currently using your subscription'))
    expect(getMeta(s).model).toBe('claude-opus-5-5')
    expect(getMeta(s).contextTokens).toBe(before.contextTokens)
  })
})

describe('system notices', () => {
  const info = (level: string, content = 'Compacted while idle'): TranscriptRecord => ({
    type: 'system',
    subtype: 'informational',
    uuid: 'i1',
    content,
    level
  })

  it('shows a notice', () => {
    expect(parse(info('notice'))).toEqual([{ kind: 'system', id: 'i1', tone: 'info', text: 'Compacted while idle' }])
  })

  it('hides level info, like the terminal does', () => {
    expect(parse(info('info'))).toEqual([])
  })

  it('shows a live task notification', () => {
    const r: TranscriptRecord = {
      type: 'system',
      subtype: 'task_notification',
      uuid: 't1',
      status: 'failed',
      summary: 'Agent failed'
    }
    expect(parse(r)).toEqual([{ kind: 'system', id: 't1', tone: 'error', text: 'Agent failed' }])
  })

  it('shows a model refusal', () => {
    const r: TranscriptRecord = {
      type: 'system',
      subtype: 'model_refusal_no_fallback',
      uuid: 'm1',
      content: 'Claude declined this request.'
    }
    expect(parse(r)).toEqual([{ kind: 'system', id: 'm1', tone: 'error', text: 'Claude declined this request.' }])
  })
})

describe('branches through attachments', () => {
  it('drops the old branch when an edit forks at an attachment', () => {
    const items = parse(
      user('u1', 'first'),
      { type: 'attachment', uuid: 'att', parentUuid: 'u1', attachment: { type: 'hook_success' } },
      user('u2', 'old second', { parentUuid: 'att' }),
      { type: 'assistant', uuid: 'a2', parentUuid: 'u2', message: { role: 'assistant', content: [{ type: 'text', text: 'old reply' }] } },
      user('u3', 'new second', { parentUuid: 'att' })
    )
    const texts = items.map((i) => (i.kind === 'user' ? i.text : i.kind === 'assistant' ? i.markdown : i.kind))
    expect(texts).toEqual(['first', 'new second'])
  })
})

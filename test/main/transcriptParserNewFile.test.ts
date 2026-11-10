import { describe, expect, it } from 'vitest'
import { diffForWrite } from '../../src/main/chat/diff'
import { createParserState, parseLines } from '../../src/main/chat/transcriptParser'

describe('transcript parser: a newly created file', () => {
  it('keeps the Write diff when the result has an empty patch', () => {
    const items = parseLines(createParserState('C:\\proj'), [
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'C:\\proj\\new.ts', content: 'one\ntwo' } }
          ]
        }
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        toolUseResult: { type: 'create', filePath: 'C:\\proj\\new.ts', structuredPatch: [], originalFile: null },
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'File created' }] }
      })
    ])
    const tool = items.find((i) => i.kind === 'tool')
    expect(tool?.kind === 'tool' && tool.status).toBe('ok')
    expect(tool?.kind === 'tool' && tool.diff?.added).toBe(2)
    expect(tool?.kind === 'tool' && tool.diff?.lines.map((l) => l.text)).toEqual(['one', 'two'])
  })

  it('does not count the final newline as a line', () => {
    expect(diffForWrite('a.txt', 'one\ntwo\n').added).toBe(2)
  })
})

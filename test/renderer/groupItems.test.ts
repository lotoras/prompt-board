import { describe, expect, it } from 'vitest'
import { groupItems } from '../../src/renderer/src/features/chat/groupItems'
import {
  agent,
  assistant,
  command,
  diff,
  plan,
  question,
  system,
  thinking,
  tool,
  turnEnd,
  user
} from './chatFixtures'

const types = (items: Parameters<typeof groupItems>[0]): string[] =>
  groupItems(items).map((b) => b.type)

describe('groupItems', () => {
  it('returns no blocks for an empty list', () => {
    expect(groupItems([])).toEqual([])
  })

  it('emits a user block for a user item', () => {
    const blocks = groupItems([user('u1')])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'user', item: { id: 'u1' } })
  })

  it('collects tool, agent and thinking steps of a turn into one worklog with id log:<first step id>', () => {
    const blocks = groupItems([
      user('u1'),
      thinking('t1'),
      tool('x1'),
      agent('a1', 'running'),
      tool('x2')
    ])
    const logs = blocks.filter((b) => b.type === 'worklog') as unknown as {
      id: string
      steps: { id: string }[]
    }[]
    expect(logs).toHaveLength(1)
    expect(logs[0].id).toBe('log:t1')
    expect(logs[0].steps.map((s) => s.id)).toEqual(['t1', 'x1', 'a1', 'x2'])
  })

  it('emits no worklog for a turn without steps', () => {
    expect(types([user('u1'), assistant('a')])).toEqual(['user', 'assistant'])
  })

  it('takes durationMs from the turn-end item and marks the turn not live', () => {
    const blocks = groupItems([user('u1'), tool('x1'), turnEnd('e1', 4200)])
    expect(blocks.find((b) => b.type === 'worklog')).toMatchObject({ durationMs: 4200, live: false })
  })

  it('marks only the last unfinished turn live', () => {
    const blocks = groupItems([
      user('u1'),
      tool('x1'),
      user('u2'),
      tool('x2'),
      turnEnd('e2'),
      user('u3'),
      tool('x3')
    ])
    const logs = blocks.filter((b) => b.type === 'worklog') as unknown as {
      id: string
      live: boolean
    }[]
    expect(logs.map((l) => [l.id, l.live])).toEqual([
      ['log:x1', false],
      ['log:x2', false],
      ['log:x3', true]
    ])
  })

  it('a last turn that has a turn-end is not live', () => {
    const blocks = groupItems([user('u1'), tool('x1'), turnEnd('e1')])
    expect(blocks.find((b) => b.type === 'worklog')).toMatchObject({ live: false })
  })

  it('orders assistant, system and command blocks by item order', () => {
    expect(types([user('u1'), system('s'), assistant('a'), command('c')])).toEqual([
      'user',
      'system',
      'assistant',
      'command'
    ])
  })

  it('emits a diff block for each tool step that has a diff, after assistant blocks', () => {
    const blocks = groupItems([
      user('u1'),
      tool('x1', { diff }),
      tool('x2'),
      assistant('a'),
      tool('x3', { diff })
    ])
    expect(blocks.map((b) => b.type)).toEqual(['user', 'worklog', 'assistant', 'diff', 'diff'])
    const diffs = blocks.filter((b) => b.type === 'diff') as unknown as { item: { id: string } }[]
    expect(diffs.map((d) => d.item.id)).toEqual(['x1', 'x3'])
  })

  it('emits agent blocks only for agents that are not running', () => {
    const blocks = groupItems([
      user('u1'),
      agent('a1', 'running'),
      agent('a2', 'ok'),
      agent('a3', 'error')
    ])
    const agents = blocks.filter((b) => b.type === 'agent') as unknown as { item: { id: string } }[]
    expect(agents.map((a) => a.item.id)).toEqual(['a2', 'a3'])
  })

  it('puts question and plan blocks last in item order', () => {
    expect(
      types([user('u1'), plan('p'), question('q'), assistant('a'), tool('x1', { diff }), agent('g')])
    ).toEqual(['user', 'worklog', 'assistant', 'diff', 'agent', 'plan', 'question'])
  })

  it('renders items before the first user item as a turn without a user block', () => {
    const blocks = groupItems([assistant('a0'), tool('x0'), user('u1'), assistant('a1')])
    expect(blocks.map((b) => b.type)).toEqual(['worklog', 'assistant', 'user', 'assistant'])
  })

  it('renders nothing for turn-end items', () => {
    expect(groupItems([turnEnd('e1')])).toEqual([])
    expect(types([user('u1'), turnEnd('e1')])).toEqual(['user'])
  })
})

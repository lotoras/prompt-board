import { describe, expect, it } from 'vitest'
import { groupItems } from '../../src/renderer/src/features/chat/groupItems'
import { assistant, permission, plan, question, tool, turnEnd, user } from './chatFixtures'

const types = (items: Parameters<typeof groupItems>[0]): string[] =>
  groupItems(items).map((b) => b.type)

describe('groupItems permission blocks', () => {
  it('emits a permission block carrying the item', () => {
    const blocks = groupItems([user('u1'), permission('p1')])
    expect(blocks.at(-1)).toMatchObject({ type: 'permission', item: { id: 'p1', kind: 'permission' } })
  })

  it('places permission after the work log and assistant text', () => {
    expect(types([user('u1'), tool('x1'), assistant('a'), turnEnd('e'), permission('p1')])).toEqual([
      'user',
      'worklog',
      'assistant',
      'permission'
    ])
  })

  it('keeps permission, question and plan together in item order', () => {
    expect(types([user('u1'), assistant('a'), question('q'), permission('p'), plan('pl')])).toEqual([
      'user',
      'assistant',
      'question',
      'permission',
      'plan'
    ])
  })

  it('keeps several permission blocks in item order', () => {
    const ids = groupItems([user('u1'), permission('p1'), permission('p2')])
      .filter((b) => b.type === 'permission')
      .map((b) => (b as unknown as { item: { id: string } }).item.id)
    expect(ids).toEqual(['p1', 'p2'])
  })
})

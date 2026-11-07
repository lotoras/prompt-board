import { describe, expect, it } from 'vitest'
import { applyItemsEvent } from '../../src/renderer/src/lib/chatItems'
import { assistant, user } from './chatFixtures'

describe('applyItemsEvent', () => {
  it('reset replaces the whole list', () => {
    const out = applyItemsEvent([user('a')], { chatId: 'c', reset: [assistant('x'), assistant('y')] })
    expect(out.map((i) => i.id)).toEqual(['x', 'y'])
  })

  it('upsert replaces an existing id in place', () => {
    const list = [user('a'), assistant('b'), assistant('c')]
    const out = applyItemsEvent(list, {
      chatId: 'c',
      upsert: [{ kind: 'assistant', id: 'b', markdown: 'new' }]
    })
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(out[1]).toEqual({ kind: 'assistant', id: 'b', markdown: 'new' })
  })

  it('upsert appends new ids in the given order', () => {
    const out = applyItemsEvent([user('a')], {
      chatId: 'c',
      upsert: [assistant('z'), assistant('y')]
    })
    expect(out.map((i) => i.id)).toEqual(['a', 'z', 'y'])
  })

  it('upsert mixes replace and append', () => {
    const out = applyItemsEvent([user('a'), assistant('b')], {
      chatId: 'c',
      upsert: [assistant('n'), { kind: 'assistant', id: 'a', markdown: 'r' }]
    })
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'n'])
    expect(out[0]).toMatchObject({ kind: 'assistant', markdown: 'r' })
  })

  it('remove filters out the listed ids', () => {
    const out = applyItemsEvent([user('a'), assistant('b'), assistant('c')], {
      chatId: 'c',
      remove: ['a', 'c', 'missing']
    })
    expect(out.map((i) => i.id)).toEqual(['b'])
  })

  it('returns a new array and does not mutate the input', () => {
    const list = [user('a'), assistant('b')]
    const snapshot = [...list]
    const out = applyItemsEvent(list, { chatId: 'c', upsert: [assistant('n')], remove: ['a'] })
    expect(out).not.toBe(list)
    expect(list).toEqual(snapshot)
    expect(applyItemsEvent(list, { chatId: 'c' })).not.toBe(list)
  })
})

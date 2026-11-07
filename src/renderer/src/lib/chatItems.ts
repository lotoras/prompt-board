import type { ChatItem, ChatItemsEvent } from '../../../shared/types'

export function applyItemsEvent(list: ChatItem[], e: ChatItemsEvent): ChatItem[] {
  let next = e.reset ? [...e.reset] : [...list]
  if (e.upsert?.length) {
    const index = new Map(next.map((item, i) => [item.id, i]))
    for (const item of e.upsert) {
      const at = index.get(item.id)
      if (at === undefined) {
        index.set(item.id, next.length)
        next.push(item)
      } else {
        next[at] = item
      }
    }
  }
  if (e.remove?.length) {
    const drop = new Set(e.remove)
    next = next.filter((item) => !drop.has(item.id))
  }
  return next
}

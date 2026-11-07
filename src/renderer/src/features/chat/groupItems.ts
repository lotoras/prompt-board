import type { ChatItem } from '../../../../shared/types'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>
export type StepItem = Of<'tool'> | Of<'agent'> | Of<'thinking'>

export type RenderBlock =
  | { type: 'user'; item: Of<'user'> }
  | { type: 'worklog'; id: string; steps: StepItem[]; durationMs?: number; live: boolean }
  | { type: 'assistant'; item: Of<'assistant'> }
  | { type: 'diff'; item: Of<'tool'> }
  | { type: 'agent'; item: Of<'agent'> }
  | { type: 'question'; item: Of<'question'> }
  | { type: 'plan'; item: Of<'plan'> }
  | { type: 'system'; item: Of<'system'> }
  | { type: 'command'; item: Of<'command'> }

export function groupItems(items: ChatItem[]): RenderBlock[] {
  const turns: ChatItem[][] = []
  for (const item of items) {
    if (item.kind === 'user' || turns.length === 0) turns.push([item])
    else turns[turns.length - 1].push(item)
  }

  const blocks: RenderBlock[] = []
  turns.forEach((turn, turnIndex) => {
    const steps: StepItem[] = []
    let turnEnd: Of<'turn-end'> | undefined
    for (const item of turn) {
      if (item.kind === 'tool' || item.kind === 'agent' || item.kind === 'thinking') steps.push(item)
      else if (item.kind === 'turn-end') turnEnd = item
    }

    const first = turn[0]
    if (first.kind === 'user') blocks.push({ type: 'user', item: first })
    if (steps.length > 0) {
      blocks.push({
        type: 'worklog',
        id: `log:${steps[0].id}`,
        steps,
        durationMs: turnEnd?.durationMs,
        live: !turnEnd && turnIndex === turns.length - 1
      })
    }
    for (const item of turn) {
      if (item.kind === 'assistant') blocks.push({ type: 'assistant', item })
      else if (item.kind === 'system') blocks.push({ type: 'system', item })
      else if (item.kind === 'command') blocks.push({ type: 'command', item })
    }
    for (const step of steps) if (step.kind === 'tool' && step.diff) blocks.push({ type: 'diff', item: step })
    for (const step of steps) {
      if (step.kind === 'agent' && step.status !== 'running') blocks.push({ type: 'agent', item: step })
    }
    for (const item of turn) {
      if (item.kind === 'question') blocks.push({ type: 'question', item })
      else if (item.kind === 'plan') blocks.push({ type: 'plan', item })
    }
  })
  return blocks
}

import type { EffortLevel } from '../../../../../shared/types'

/** Model dot colour, shared with the user's terminal statusline palette. */
export function modelColor(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('fable')) return 'var(--m-fable)'
  if (m.includes('sonnet')) return 'var(--m-sonnet)'
  if (m.includes('haiku')) return 'var(--m-haiku)'
  return 'var(--m-opus)'
}

export const EFFORT_DESCRIPTIONS: Record<EffortLevel, string> = {
  low: 'Fast answers, light reasoning',
  medium: 'Balanced',
  high: 'Thorough reasoning',
  xhigh: 'Extra thorough reasoning',
  max: 'Deepest; this session only'
}

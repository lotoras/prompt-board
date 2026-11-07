import { describe, expect, it } from 'vitest'
import { matchSlashCommands } from '../../src/renderer/src/features/chat/slashMatch'
import type { SlashCommandInfo } from '../../src/shared/types'

const cmd = (name: string, extra: Partial<SlashCommandInfo> = {}): SlashCommandInfo => ({
  name,
  description: '',
  argumentHint: '',
  ...extra
})
const names = (list: SlashCommandInfo[]): string[] => list.map((c) => c.name)

describe('matchSlashCommands', () => {
  it('empty query lists skills first, then builtins, each alphabetical', () => {
    const all = [
      cmd('compact', { builtin: true }),
      cmd('zeta'),
      cmd('clear', { builtin: true }),
      cmd('alpha')
    ]
    expect(names(matchSlashCommands('', all))).toEqual(['alpha', 'zeta', 'clear', 'compact'])
  })

  it('empty query respects the limit', () => {
    const all = Array.from({ length: 12 }, (_, i) => cmd(`s${String(i).padStart(2, '0')}`))
    expect(matchSlashCommands('', all)).toHaveLength(8)
    expect(matchSlashCommands('', all, 3)).toHaveLength(3)
  })

  it('returns [] when nothing matches', () => {
    expect(matchSlashCommands('zzz', [cmd('compact'), cmd('clear')])).toEqual([])
  })

  it('finds a namespaced skill by the part after the last colon', () => {
    const all = [cmd('compact', { builtin: true }), cmd('ai-brain:cc-enhance')]
    expect(names(matchSlashCommands('cc-enh', all))).toEqual(['ai-brain:cc-enhance'])
  })

  it('ranks name prefix > after-colon prefix > contains (name or description)', () => {
    const all = [
      cmd('xx-plan-yy'),
      cmd('ns:plan-it'),
      cmd('plan-first'),
      cmd('other', { description: 'make a PLAN' })
    ]
    const result = names(matchSlashCommands('plan', all))
    expect(result.slice(0, 2)).toEqual(['plan-first', 'ns:plan-it'])
    expect(result.slice(2).sort()).toEqual(['other', 'xx-plan-yy'])
  })

  it('an alias prefix counts as a name prefix', () => {
    const all = [cmd('contains-h'), cmd('help-me', { aliases: ['h'] })]
    expect(names(matchSlashCommands('h', all))[0]).toBe('help-me')
  })

  it('matches case-insensitively and breaks ties alphabetically', () => {
    const all = [cmd('review-b'), cmd('review-a')]
    expect(names(matchSlashCommands('REV', all))).toEqual(['review-a', 'review-b'])
  })

  it('matches the description by substring', () => {
    const all = [cmd('foo', { description: 'Summarise the session' })]
    expect(names(matchSlashCommands('summar', all))).toEqual(['foo'])
  })

  it('caps the matches at the limit', () => {
    const all = Array.from({ length: 20 }, (_, i) => cmd(`rev${i}`))
    expect(matchSlashCommands('rev', all)).toHaveLength(8)
    expect(matchSlashCommands('rev', all, 2)).toHaveLength(2)
  })
})

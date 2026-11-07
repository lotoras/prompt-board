import { describe, expect, it } from 'vitest'
import {
  DIRECTIVE_LINES,
  composePrompt,
  contextTokens,
  contextWindowFor,
  modelLabel,
  parseDirectives,
  suggestBranchName,
  worktreeSlug
} from '../../src/shared/chat'
import type { ChatToggles } from '../../src/shared/types'

const OFF: ChatToggles = { codex: 'off', ultra: false }

describe('composePrompt', () => {
  it('returns the trimmed text when there are no files and no directives', () => {
    expect(composePrompt('  fix it  \n', OFF, [])).toBe('fix it')
  })

  it('appends ultrathink then the codex tests line', () => {
    expect(composePrompt('fix it', { codex: 'tests', ultra: true }, [])).toBe(
      'fix it\n\nultrathink\nuse codex'
    )
  })

  it('uses the full codex directive line for codex full', () => {
    expect(composePrompt('fix it', { codex: 'full', ultra: false }, [])).toBe(
      `fix it\n\n${DIRECTIVE_LINES.codexFull}`
    )
  })

  it('lists non-image files before the directive block', () => {
    expect(composePrompt('fix it', OFF, [{ path: 'C:\\a\\b.ts', kind: 'file' }])).toBe(
      'fix it\n\nAttached files:\n- C:\\a\\b.ts'
    )
    expect(
      composePrompt('fix it', { codex: 'off', ultra: true }, [
        { path: 'C:\\a\\b.ts', kind: 'file' }
      ])
    ).toBe('fix it\n\nAttached files:\n- C:\\a\\b.ts\n\nultrathink')
  })

  it('never lists image attachments', () => {
    expect(composePrompt('look', OFF, [{ path: 'C:\\a\\shot.png', kind: 'image' }])).toBe('look')
  })
})

describe('parseDirectives', () => {
  it('returns plain text unchanged with default toggles and no files', () => {
    expect(parseDirectives('just a message')).toEqual({
      text: 'just a message',
      directives: { codex: 'off', ultra: false },
      files: []
    })
  })

  it('round-trips text, toggles and file paths', () => {
    const toggleSets: ChatToggles[] = [
      OFF,
      { codex: 'tests', ultra: true },
      { codex: 'full', ultra: false },
      { codex: 'full', ultra: true }
    ]
    const files = [
      { path: 'C:\\a\\b.ts', kind: 'file' as const },
      { path: 'C:\\c\\d e.md', kind: 'file' as const }
    ]
    for (const toggles of toggleSets) {
      for (const f of [[], files]) {
        const parsed = parseDirectives(composePrompt('please fix it', toggles, f))
        expect(parsed.text).toBe('please fix it')
        expect(parsed.directives).toEqual(toggles)
        expect(parsed.files).toEqual(f.map((x) => x.path))
      }
    }
  })

  it('keeps a literal "ultrathink" typed mid-text', () => {
    const parsed = parseDirectives('please ultrathink about this\nand then more')
    expect(parsed.text).toBe('please ultrathink about this\nand then more')
    expect(parsed.directives).toEqual({ codex: 'off', ultra: false })
  })
})

describe('contextTokens', () => {
  it('sums input, cache creation and cache read tokens', () => {
    expect(
      contextTokens({
        input_tokens: 2,
        cache_creation_input_tokens: 5302,
        cache_read_input_tokens: 100295,
        output_tokens: 9
      })
    ).toBe(105599)
  })

  it('returns 0 for non-objects', () => {
    expect(contextTokens(undefined)).toBe(0)
    expect(contextTokens(null)).toBe(0)
    expect(contextTokens('x')).toBe(0)
    expect(contextTokens(42)).toBe(0)
  })
})

describe('contextWindowFor', () => {
  it.each([
    'opus',
    'fable',
    'sonnet',
    'haiku',
    'default',
    'claude-opus-5-5',
    'claude-haiku-5-5',
    'claude-fable-5-1',
    'claude-sonnet-4-6[1m]'
  ])('gives 1,000,000 for %s', (model) => {
    expect(contextWindowFor(model)).toBe(1_000_000)
  })

  it.each(['claude-sonnet-4-6', 'claude-opus-4-8', undefined])('gives 200,000 for %s', (model) => {
    expect(contextWindowFor(model)).toBe(200_000)
  })
})

describe('modelLabel', () => {
  it('labels aliases and ids', () => {
    expect(modelLabel('opus')).toBe('Opus 5.5')
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  })

  it('returns unknown ids unchanged and empty string for undefined', () => {
    expect(modelLabel('mystery-model')).toBe('mystery-model')
    expect(modelLabel(undefined)).toBe('')
  })
})

describe('worktreeSlug', () => {
  it('slugs the part after the last slash', () => {
    expect(worktreeSlug('pb/Context Meter!')).toBe('context-meter')
  })

  it('caps the slug at 40 characters', () => {
    expect(worktreeSlug('a'.repeat(100)).length).toBeLessThanOrEqual(40)
  })
})

describe('suggestBranchName', () => {
  it('uses the first line of the text', () => {
    expect(suggestBranchName('Fix the chime\nmore')).toBe('pb/fix-the-chime')
  })

  it('falls back to pb/chat for empty text', () => {
    expect(suggestBranchName('')).toBe('pb/chat')
    expect(suggestBranchName('   ')).toBe('pb/chat')
  })
})

import { describe, expect, it } from 'vitest'
import { readClaudeDefaults } from '../../src/main/chat/defaults'

describe('readClaudeDefaults', () => {
  it('falls back to opus / high for empty or non-object settings', () => {
    expect(readClaudeDefaults({})).toEqual({ model: 'opus', effort: 'high', permissionMode: 'bypassPermissions' })
    expect(readClaudeDefaults(null)).toEqual({ model: 'opus', effort: 'high', permissionMode: 'bypassPermissions' })
    expect(readClaudeDefaults('nope')).toEqual({ model: 'opus', effort: 'high', permissionMode: 'bypassPermissions' })
  })

  it('uses settings.model and settings.effortLevel', () => {
    expect(readClaudeDefaults({ model: 'sonnet', effortLevel: 'low' })).toEqual({
      model: 'sonnet',
      effort: 'low',
      permissionMode: 'bypassPermissions'
    })
  })

  it('prefers a modelSettings effortLevel whose key contains the model alias', () => {
    const settings = {
      model: 'fable',
      effortLevel: 'low',
      modelSettings: {
        'claude-opus-5-5': { effortLevel: 'medium' },
        'claude-fable-5-1': { effortLevel: 'max' }
      }
    }
    expect(readClaudeDefaults(settings)).toEqual({
      model: 'fable',
      effort: 'max',
      permissionMode: 'bypassPermissions'
    })
  })

  it('falls back to settings.effortLevel when no modelSettings key matches', () => {
    const settings = {
      model: 'haiku',
      effortLevel: 'xhigh',
      modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } }
    }
    expect(readClaudeDefaults(settings).effort).toBe('xhigh')
  })

  it('ignores invalid values', () => {
    expect(readClaudeDefaults({ model: 42, effortLevel: 'extreme' })).toEqual({
      model: 'opus',
      effort: 'high',
      permissionMode: 'bypassPermissions'
    })
  })

  it('maps settings.permissions.defaultMode to permissionMode', () => {
    for (const mode of ['default', 'acceptEdits', 'plan', 'bypassPermissions']) {
      expect(readClaudeDefaults({ permissions: { defaultMode: mode } }).permissionMode).toBe(mode)
    }
  })

  it('falls back to bypassPermissions for an unknown or missing defaultMode', () => {
    expect(readClaudeDefaults({ permissions: { defaultMode: 'dontAsk' } }).permissionMode).toBe(
      'bypassPermissions'
    )
    expect(readClaudeDefaults({ permissions: {} }).permissionMode).toBe('bypassPermissions')
    expect(readClaudeDefaults({ permissions: 'x' }).permissionMode).toBe('bypassPermissions')
  })
})

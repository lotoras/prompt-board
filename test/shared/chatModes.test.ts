import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  formatResetIn,
  nextPermissionMode,
  permissionModeLabel,
  toPermissionMode
} from '../../src/shared/chat'

describe('PERMISSION_MODES', () => {
  it('lists the modes in Shift+Tab cycle order', () => {
    expect(PERMISSION_MODES.map((m) => m.id)).toEqual([
      'default',
      'acceptEdits',
      'plan',
      'bypassPermissions'
    ])
  })

  it('defaults to bypassPermissions', () => {
    expect(DEFAULT_PERMISSION_MODE).toBe('bypassPermissions')
  })
})

describe('nextPermissionMode', () => {
  it('cycles default -> acceptEdits -> plan -> bypassPermissions -> default', () => {
    expect(nextPermissionMode('default')).toBe('acceptEdits')
    expect(nextPermissionMode('acceptEdits')).toBe('plan')
    expect(nextPermissionMode('plan')).toBe('bypassPermissions')
    expect(nextPermissionMode('bypassPermissions')).toBe('default')
  })
})

describe('permissionModeLabel', () => {
  it('returns the short label of each mode', () => {
    expect(permissionModeLabel('default')).toBe('Ask')
    expect(permissionModeLabel('acceptEdits')).toBe('Accept edits')
    expect(permissionModeLabel('plan')).toBe('Plan')
    expect(permissionModeLabel('bypassPermissions')).toBe('Full access')
  })

  it('falls back to "Full access" for unknown or missing ids', () => {
    expect(permissionModeLabel('nonsense')).toBe('Full access')
    expect(permissionModeLabel(undefined)).toBe('Full access')
  })
})

describe('toPermissionMode', () => {
  it('passes valid ids through', () => {
    for (const m of PERMISSION_MODES) expect(toPermissionMode(m.id)).toBe(m.id)
  })

  it('maps anything else to bypassPermissions', () => {
    expect(toPermissionMode('dontAsk')).toBe('bypassPermissions')
    expect(toPermissionMode(undefined)).toBe('bypassPermissions')
    expect(toPermissionMode(3)).toBe('bypassPermissions')
    expect(toPermissionMode(null)).toBe('bypassPermissions')
  })
})

describe('formatResetIn', () => {
  const NOW = 1_700_000_000_000
  const MIN = 60_000

  it('formats minutes', () => {
    expect(formatResetIn(NOW + 12 * MIN, NOW)).toBe('Resets in 12m')
  })

  it('formats hours and minutes', () => {
    expect(formatResetIn(NOW + (2 * 60 + 14) * MIN, NOW)).toBe('Resets in 2h 14m')
  })

  it('formats days and hours', () => {
    expect(formatResetIn(NOW + (3 * 1440 + 4 * 60) * MIN, NOW)).toBe('Resets in 3d 4h')
  })

  it('returns "" for the past, now, or a missing time', () => {
    expect(formatResetIn(NOW - MIN, NOW)).toBe('')
    expect(formatResetIn(NOW, NOW)).toBe('')
    expect(formatResetIn(undefined, NOW)).toBe('')
  })
})

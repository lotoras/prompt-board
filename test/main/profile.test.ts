import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { profileUserDataPath } from '../../src/main/lib/profile'

describe('profileUserDataPath', () => {
  const appData = join('C:', 'Users', 'me', 'AppData', 'Roaming')

  it('returns null without a profile so the everyday app keeps its data dir', () => {
    expect(profileUserDataPath(appData, undefined)).toBeNull()
    expect(profileUserDataPath(appData, '')).toBeNull()
    expect(profileUserDataPath(appData, '   ')).toBeNull()
    expect(profileUserDataPath(appData, 'default')).toBeNull()
  })

  it('maps a profile to a sibling prompt-board-<profile> dir', () => {
    expect(profileUserDataPath(appData, 't3')).toBe(join(appData, 'prompt-board-t3'))
    expect(profileUserDataPath(appData, ' T3 ')).toBe(join(appData, 'prompt-board-t3'))
  })

  it('rejects names that could escape the appData dir', () => {
    expect(profileUserDataPath(appData, '../x')).toBeNull()
    expect(profileUserDataPath(appData, 'a/b')).toBeNull()
    expect(profileUserDataPath(appData, 'a b')).toBeNull()
  })
})

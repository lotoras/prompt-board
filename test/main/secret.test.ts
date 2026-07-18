import { beforeEach, describe, expect, it, vi } from 'vitest'

const { safeStorageState } = vi.hoisted(() => ({
  safeStorageState: {
    available: true,
    decryptShouldThrow: false
  }
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => safeStorageState.available,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => {
      if (safeStorageState.decryptShouldThrow) throw new Error('decrypt failed')
      return b.toString('utf8')
    }
  }
}))

describe('sync/secret', () => {
  beforeEach(() => {
    vi.resetModules()
    safeStorageState.available = true
    safeStorageState.decryptShouldThrow = false
  })

  it('round-trips a secret through encryptSecret/decryptSecret', async () => {
    const { encryptSecret, decryptSecret } = await import('../../src/main/sync/secret')
    const encrypted = encryptSecret('hunter2')
    expect(encrypted).toBeTruthy()
    expect(decryptSecret(encrypted!)).toBe('hunter2')
  })

  it('returns null from encryptSecret when encryption is unavailable', async () => {
    safeStorageState.available = false
    const { encryptSecret } = await import('../../src/main/sync/secret')
    expect(encryptSecret('hunter2')).toBeNull()
  })

  it('returns null from decryptSecret when encryption is unavailable', async () => {
    safeStorageState.available = false
    const { decryptSecret } = await import('../../src/main/sync/secret')
    expect(decryptSecret('anything')).toBeNull()
  })

  it('returns null from decryptSecret when decryptString throws', async () => {
    const { encryptSecret, decryptSecret } = await import('../../src/main/sync/secret')
    const encrypted = encryptSecret('hunter2')!
    safeStorageState.decryptShouldThrow = true
    expect(decryptSecret(encrypted)).toBeNull()
  })
})

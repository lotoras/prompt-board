import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import type { PersistedTerminalsState } from '../../src/shared/types'

const { userDataDir } = vi.hoisted(() => ({ userDataDir: { current: '' } }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir.current }
}))

describe('pty/persistence', () => {
  let tmpDir: string

  beforeEach(async () => {
    vi.resetModules()
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'terminals-persistence-'))
    userDataDir.current = tmpDir
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function loadPersistence() {
    return import('../../src/main/pty/persistence')
  }

  describe('happy path', () => {
    it('round-trips saved terminals through savePersisted and loadPersisted', async () => {
      const { savePersisted, loadPersisted } = await loadPersistence()
      const state: PersistedTerminalsState = {
        terminals: [{ projectKey: 'proj-1', sessionId: 'sid-1', title: 'Terminal 1' }],
        activeSessionByProject: { 'proj-1': 'sid-1' }
      }
      await savePersisted(state)

      expect(await loadPersisted()).toEqual(state)

      vi.resetModules()
      const fresh = await loadPersistence()
      expect(await fresh.loadPersisted()).toEqual(state)
    })
  })

  describe('edge cases / failure', () => {
    it('returns the empty default when no file exists yet', async () => {
      const { loadPersisted } = await loadPersistence()
      await expect(loadPersisted()).resolves.toEqual({
        terminals: [],
        activeSessionByProject: {}
      })
    })
  })
})

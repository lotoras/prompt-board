import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'

const { userDataDir } = vi.hoisted(() => ({ userDataDir: { current: '' } }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir.current }
}))

describe('sync/config', () => {
  let tmpDir: string

  beforeEach(async () => {
    vi.resetModules()
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'sync-config-'))
    userDataDir.current = tmpDir
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function loadConfig() {
    return import('../../src/main/sync/config')
  }

  describe('sync config persistence', () => {
    it('returns null when no config file exists', async () => {
      const { loadSyncConfig } = await loadConfig()
      expect(await loadSyncConfig()).toBeNull()
    })

    it('persists a saved config and reflects it via loadSyncConfig (cached)', async () => {
      const { loadSyncConfig, saveSyncConfig } = await loadConfig()
      await saveSyncConfig({
        url: 'https://x.supabase.co',
        anonKey: 'anon-key',
        email: 'a@b.com',
        deviceId: 'device-1',
        session: { accessToken: 'at', refreshToken: 'rt' }
      })
      expect(await loadSyncConfig()).toEqual({
        url: 'https://x.supabase.co',
        anonKey: 'anon-key',
        email: 'a@b.com',
        deviceId: 'device-1',
        session: { accessToken: 'at', refreshToken: 'rt' }
      })
    })

    it('survives a fresh module load (persisted to sync.json)', async () => {
      const { saveSyncConfig } = await loadConfig()
      await saveSyncConfig({
        url: 'https://x.supabase.co',
        anonKey: 'anon-key',
        email: 'a@b.com',
        deviceId: 'device-1',
        session: { accessToken: 'at', refreshToken: 'rt' }
      })

      vi.resetModules()
      const fresh = await loadConfig()
      const reloaded = await fresh.loadSyncConfig()
      expect(reloaded?.deviceId).toBe('device-1')

      const raw = await fs.readFile(join(tmpDir, 'sync.json'), 'utf-8')
      expect(JSON.parse(raw).deviceId).toBe('device-1')
    })

    it('never writes a password field to sync.json', async () => {
      const { saveSyncConfig } = await loadConfig()
      await saveSyncConfig({
        url: 'https://x.supabase.co',
        anonKey: 'anon-key',
        email: 'a@b.com',
        deviceId: 'device-1',
        session: { accessToken: 'at', refreshToken: 'rt' }
      })
      const raw = await fs.readFile(join(tmpDir, 'sync.json'), 'utf-8')
      expect(raw).not.toContain('password')
    })

    it('clears the config file when saved with null and does not throw if already absent', async () => {
      const { loadSyncConfig, saveSyncConfig } = await loadConfig()
      await saveSyncConfig({
        url: 'https://x.supabase.co',
        anonKey: 'anon-key',
        email: 'a@b.com',
        deviceId: 'device-1',
        session: { accessToken: 'at', refreshToken: 'rt' }
      })
      await saveSyncConfig(null)
      expect(await loadSyncConfig()).toBeNull()
      await expect(fs.access(join(tmpDir, 'sync.json'))).rejects.toThrow()

      // calling again with no file present must not throw
      await expect(saveSyncConfig(null)).resolves.toBeUndefined()
    })
  })

  describe('outbox persistence', () => {
    it('returns an empty outbox when no file exists', async () => {
      const { loadOutbox } = await loadConfig()
      expect(await loadOutbox()).toEqual({ ops: [] })
    })

    it('persists outbox ops to sync-outbox.json and survives a fresh module load', async () => {
      const { loadOutbox, saveOutbox } = await loadConfig()
      await saveOutbox({
        ops: [{ id: 'projects:key-1', table: 'projects', row: { project_key: 'key-1' } }]
      })

      vi.resetModules()
      const fresh = await loadConfig()
      const reloaded = await fresh.loadOutbox()
      expect(reloaded.ops).toHaveLength(1)
      expect(reloaded.ops[0].id).toBe('projects:key-1')

      const raw = await fs.readFile(join(tmpDir, 'sync-outbox.json'), 'utf-8')
      expect(JSON.parse(raw).ops).toHaveLength(1)
    })

    it('resetSyncCaches forces a re-read from disk within the same module instance', async () => {
      const { loadOutbox, saveOutbox, resetSyncCaches } = await loadConfig()
      await saveOutbox({ ops: [{ id: 'projects:key-1', table: 'projects', row: {} }] })

      // simulate an external write bypassing the cache
      await fs.writeFile(
        join(tmpDir, 'sync-outbox.json'),
        JSON.stringify({ ops: [] }),
        'utf-8'
      )
      // cache still holds the old value until reset
      expect((await loadOutbox()).ops).toHaveLength(1)

      resetSyncCaches()
      expect((await loadOutbox()).ops).toHaveLength(0)
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'

const { userDataDir } = vi.hoisted(() => ({ userDataDir: { current: '' } }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir.current }
}))

describe('sessions/acks', () => {
  let tmpDir: string

  beforeEach(async () => {
    vi.resetModules()
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'session-acks-'))
    userDataDir.current = tmpDir
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function loadAcks() {
    return import('../../src/main/sessions/acks')
  }

  describe('happy path', () => {
    it('round-trips an acknowledgement through getAcks and the persisted file', async () => {
      const { acknowledgeSession, getAcks } = await loadAcks()
      await acknowledgeSession('sid', 123)

      expect(await getAcks()).toEqual({ sid: 123 })

      const raw = await fs.readFile(join(tmpDir, 'sessionAcks.json'), 'utf-8')
      expect(JSON.parse(raw)).toEqual({ sid: 123 })
    })

    it('overwrites an existing acknowledgement with a newer statusUpdatedAt', async () => {
      const { acknowledgeSession, getAcks } = await loadAcks()
      await acknowledgeSession('sid', 123)
      await acknowledgeSession('sid', 456)

      expect(await getAcks()).toEqual({ sid: 456 })

      const raw = await fs.readFile(join(tmpDir, 'sessionAcks.json'), 'utf-8')
      expect(JSON.parse(raw)).toEqual({ sid: 456 })
    })
  })

  describe('edge cases / failure', () => {
    it('returns an empty object when no file exists yet', async () => {
      const { getAcks } = await loadAcks()
      await expect(getAcks()).resolves.toEqual({})
    })
  })
})

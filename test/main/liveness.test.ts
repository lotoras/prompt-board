import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionInfo, SessionStatus } from '../../src/shared/types'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))

vi.mock('child_process', () => {
  const { promisify } = require('util') as typeof import('util')
  const fn = ((...args: unknown[]) => execFileMock(...args)) as unknown as (
    ...args: unknown[]
  ) => unknown
  ;(fn as unknown as Record<PropertyKey, unknown>)[promisify.custom] = (...args: unknown[]) =>
    execFileMock(...args)
  return { execFile: fn }
})

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    pid: 1000,
    sessionId: 'session-1',
    cwd: 'C:\\a\\proj',
    status: 'idle' as SessionStatus,
    startedAt: 1,
    updatedAt: 1,
    statusUpdatedAt: 1,
    procStart: 1_700_000_000_000,
    ...overrides
  }
}

describe('filterAliveSessions', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetModules()
    execFileMock.mockReset()
    Object.defineProperty(process, 'platform', { value: 'win32' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  async function loadLiveness() {
    return import('../../src/main/sessions/liveness')
  }

  describe('happy path', () => {
    it('keeps a session whose pid is alive and start time matches within tolerance', async () => {
      vi.spyOn(process, 'kill').mockReturnValue(true)
      const session = makeSession({ pid: 1000, procStart: 1_700_000_000_000 })
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ Id: 1000, StartTime: '/Date(1700000000000)/' })
      })

      const { filterAliveSessions } = await loadLiveness()
      const result = await filterAliveSessions([session])
      expect(result).toEqual([session])
    })

    it('keeps all sessions when all are alive with matching start times', async () => {
      vi.spyOn(process, 'kill').mockReturnValue(true)
      const s1 = makeSession({ pid: 1000, procStart: 1_700_000_000_000 })
      const s2 = makeSession({ pid: 1001, procStart: 1_700_000_050_000 })
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify([
          { Id: 1000, StartTime: '/Date(1700000000000)/' },
          { Id: 1001, StartTime: '/Date(1700000050000)/' }
        ])
      })

      const { filterAliveSessions } = await loadLiveness()
      const result = await filterAliveSessions([s1, s2])
      expect(result).toEqual([s1, s2])
    })
  })

  describe('edge cases', () => {
    it('keeps a session exactly at the 2000ms tolerance boundary', async () => {
      vi.spyOn(process, 'kill').mockReturnValue(true)
      const session = makeSession({ pid: 1000, procStart: 1_700_000_000_000 })
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ Id: 1000, StartTime: '/Date(1700000002000)/' })
      })

      const { filterAliveSessions } = await loadLiveness()
      const result = await filterAliveSessions([session])
      expect(result).toEqual([session])
    })

    it('drops a session 2001ms past the tolerance boundary (pid reuse)', async () => {
      vi.spyOn(process, 'kill').mockReturnValue(true)
      const session = makeSession({ pid: 1000, procStart: 1_700_000_000_000 })
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ Id: 1000, StartTime: '/Date(1700000002001)/' })
      })

      const { filterAliveSessions } = await loadLiveness()
      const result = await filterAliveSessions([session])
      expect(result).toEqual([])
    })

    it('treats EPERM from process.kill as alive', async () => {
      vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('EPERM') as NodeJS.ErrnoException
        err.code = 'EPERM'
        throw err
      })
      const session = makeSession({ pid: 1000, procStart: 1_700_000_000_000 })
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ Id: 1000, StartTime: '/Date(1700000000000)/' })
      })

      const { filterAliveSessions } = await loadLiveness()
      const result = await filterAliveSessions([session])
      expect(result).toEqual([session])
    })

    it('falls back to kill(0) alone when OS start time is unavailable', async () => {
      vi.spyOn(process, 'kill').mockReturnValue(true)
      const session = makeSession({ pid: 1000 })
      execFileMock.mockResolvedValue({ stdout: '' })

      const { filterAliveSessions } = await loadLiveness()
      const result = await filterAliveSessions([session])
      expect(result).toEqual([session])
    })

    it('keeps a session without procStart when osStart is at or before startedAt', async () => {
      vi.spyOn(process, 'kill').mockReturnValue(true)
      const session = makeSession({ pid: 1000, startedAt: 1_700_000_000_000, procStart: undefined })
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ Id: 1000, StartTime: '/Date(1700000000000)/' })
      })

      const { filterAliveSessions } = await loadLiveness()
      const result = await filterAliveSessions([session])
      expect(result).toEqual([session])
    })

    it('drops a session without procStart when osStart is far after startedAt (pid reuse)', async () => {
      vi.spyOn(process, 'kill').mockReturnValue(true)
      const session = makeSession({ pid: 1000, startedAt: 1_700_000_000_000, procStart: undefined })
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ Id: 1000, StartTime: '/Date(1700000060000)/' })
      })

      const { filterAliveSessions } = await loadLiveness()
      const result = await filterAliveSessions([session])
      expect(result).toEqual([])
    })

    it('parses the legacy /Date(...)/ format correctly', async () => {
      vi.spyOn(process, 'kill').mockReturnValue(true)
      const session = makeSession({ pid: 1000, procStart: 1_700_000_000_000 })
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ Id: 1000, StartTime: '/Date(1700000000500)/' })
      })

      const { filterAliveSessions } = await loadLiveness()
      const result = await filterAliveSessions([session])
      expect(result).toEqual([session])
    })
  })

  describe('failure cases', () => {
    it('drops a session when process.kill throws a non-EPERM error', async () => {
      vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('ESRCH') as NodeJS.ErrnoException
        err.code = 'ESRCH'
        throw err
      })
      const session = makeSession({ pid: 1000 })

      const { filterAliveSessions } = await loadLiveness()
      const result = await filterAliveSessions([session])
      expect(result).toEqual([])
      expect(execFileMock).not.toHaveBeenCalled()
    })

    it('drops a session alive by kill(0) but with a start time off by more than tolerance', async () => {
      vi.spyOn(process, 'kill').mockReturnValue(true)
      const session = makeSession({ pid: 1000, procStart: 1_700_000_000_000 })
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ Id: 1000, StartTime: '/Date(1700000100000)/' })
      })

      const { filterAliveSessions } = await loadLiveness()
      const result = await filterAliveSessions([session])
      expect(result).toEqual([])
    })

    it('returns an empty array for empty input without calling execFile', async () => {
      const { filterAliveSessions } = await loadLiveness()
      const result = await filterAliveSessions([])
      expect(result).toEqual([])
      expect(execFileMock).not.toHaveBeenCalled()
    })
  })
})

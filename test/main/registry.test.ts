import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'

describe('readRegistry', () => {
  let tmpDir: string
  let homedirSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetModules()
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'registry-'))
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpDir)
  })

  afterEach(async () => {
    homedirSpy.mockRestore()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function writeSession(name: string, data: unknown): Promise<void> {
    const dir = join(tmpDir, '.claude', 'sessions')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, name), JSON.stringify(data), 'utf-8')
  }

  it('parses a registry file without procStart successfully', async () => {
    await writeSession('30016.json', {
      pid: 30016,
      sessionId: 'af29',
      cwd: 'C:\\Users\\lukar\\Downloads\\additional_learning',
      startedAt: 1783410349305,
      status: 'idle',
      updatedAt: 1783433183752,
      statusUpdatedAt: 1783433183752,
      name: 'additional-learning-5a'
    })

    const { readRegistry } = await import('../../src/main/sessions/registry')
    const result = await readRegistry()
    expect(result).toHaveLength(1)
    expect(result[0].procStart).toBeUndefined()
    expect(result[0].name).toBe('additional-learning-5a')
  })

  it('includes procStart when present as a number', async () => {
    await writeSession('30017.json', {
      pid: 30017,
      sessionId: 'af30',
      cwd: 'C:\\a\\proj',
      startedAt: 1,
      status: 'busy',
      updatedAt: 2,
      statusUpdatedAt: 2,
      procStart: 12345
    })

    const { readRegistry } = await import('../../src/main/sessions/registry')
    const result = await readRegistry()
    expect(result[0].procStart).toBe(12345)
  })

  it('parses a registry file when procStart is a Windows non-epoch string, dropping only procStart', async () => {
    await writeSession('30018.json', {
      pid: 30018,
      sessionId: 'af31',
      cwd: 'C:\\a\\proj',
      startedAt: 1,
      status: 'busy',
      updatedAt: 2,
      statusUpdatedAt: 2,
      procStart: '639192693629791370'
    })

    const { readRegistry } = await import('../../src/main/sessions/registry')
    const result = await readRegistry()
    expect(result).toHaveLength(1)
    expect(result[0].procStart).toBeUndefined()
    expect(result[0].pid).toBe(30018)
  })

  async function writeAccountSession(account: 1 | 2, name: string, data: unknown): Promise<void> {
    const dir = join(tmpDir, account === 1 ? '.claude' : '.claude-2', 'sessions')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, name), JSON.stringify(data), 'utf-8')
  }

  const baseSession = { cwd: 'C:\\a\\proj', startedAt: 1, status: 'idle', updatedAt: 2, statusUpdatedAt: 2 }

  it("reads both accounts' sessions dirs and tags each entry with its account", async () => {
    await writeAccountSession(1, '50001.json', { ...baseSession, pid: 50001, sessionId: 'acc1' })
    await writeAccountSession(2, '50002.json', { ...baseSession, pid: 50002, sessionId: 'acc2' })

    const { readRegistry } = await import('../../src/main/sessions/registry')
    const result = await readRegistry()
    expect(result).toHaveLength(2)
    expect(result.find((s) => s.sessionId === 'acc1')?.account).toBe(1)
    expect(result.find((s) => s.sessionId === 'acc2')?.account).toBe(2)
  })

  it('returns only account-1 entries and does not throw when ~/.claude-2 is missing', async () => {
    await writeAccountSession(1, '50003.json', { ...baseSession, pid: 50003, sessionId: 'only1' })

    const { readRegistry } = await import('../../src/main/sessions/registry')
    const result = await readRegistry()
    expect(result).toHaveLength(1)
    expect(result[0].account).toBe(1)
  })

  it('sessionsDir defaults to account 1 and maps account 2 to ~/.claude-2/sessions', async () => {
    const { sessionsDir } = await import('../../src/main/sessions/registry')
    expect(sessionsDir()).toBe(join(tmpDir, '.claude', 'sessions'))
    expect(sessionsDir(2)).toBe(join(tmpDir, '.claude-2', 'sessions'))
  })

  it('skips a file missing required fields', async () => {
    await writeSession('bad.json', { pid: 1 })

    const { readRegistry } = await import('../../src/main/sessions/registry')
    const result = await readRegistry()
    expect(result).toEqual([])
  })

  it('keeps returning the last-good session when its file later becomes unparsable', async () => {
    await writeSession('40001.json', {
      pid: 40001,
      sessionId: 'good-1',
      cwd: 'C:\\a\\proj',
      startedAt: 1,
      status: 'idle',
      updatedAt: 2,
      statusUpdatedAt: 2
    })
    const { readRegistry } = await import('../../src/main/sessions/registry')
    expect(await readRegistry()).toHaveLength(1)

    await fs.writeFile(join(tmpDir, '.claude', 'sessions', '40001.json'), '{"pid": 400', 'utf-8')
    const result = await readRegistry()
    expect(result).toHaveLength(1)
    expect(result[0].sessionId).toBe('good-1')
  })

  it('drops a cached session once its file is deleted', async () => {
    await writeSession('40002.json', {
      pid: 40002,
      sessionId: 'gone-1',
      cwd: 'C:\\a\\proj',
      startedAt: 1,
      status: 'busy',
      updatedAt: 2,
      statusUpdatedAt: 2
    })
    const { readRegistry } = await import('../../src/main/sessions/registry')
    expect(await readRegistry()).toHaveLength(1)

    await fs.rm(join(tmpDir, '.claude', 'sessions', '40002.json'))
    expect(await readRegistry()).toEqual([])
  })
})

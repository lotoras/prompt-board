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

  it('skips a file missing required fields', async () => {
    await writeSession('bad.json', { pid: 1 })

    const { readRegistry } = await import('../../src/main/sessions/registry')
    const result = await readRegistry()
    expect(result).toEqual([])
  })
})

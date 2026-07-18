import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import { atomicWriteFile, readJsonFile, writeJsonFile } from '../../src/main/lib/atomicWrite'

describe('atomicWrite', () => {
  let tmpDir: string
  let filePath: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'atomic-write-'))
    filePath = join(tmpDir, 'data.json')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe('happy path', () => {
    it('writes data and leaves no .tmp sibling', async () => {
      await atomicWriteFile(filePath, 'hello')
      expect(await fs.readFile(filePath, 'utf-8')).toBe('hello')
      await expect(fs.access(`${filePath}.tmp`)).rejects.toThrow()
    })

    it('writes pretty JSON that round-trips via readJsonFile', async () => {
      const data = { a: 1, b: 'two' }
      await writeJsonFile(filePath, data)
      const raw = await fs.readFile(filePath, 'utf-8')
      expect(raw).toBe(JSON.stringify(data, null, 2))
      const read = await readJsonFile(filePath, null)
      expect(read).toEqual(data)
    })

    it('fully replaces content when overwriting an existing file', async () => {
      await atomicWriteFile(filePath, 'first content that is longer')
      await atomicWriteFile(filePath, 'short')
      expect(await fs.readFile(filePath, 'utf-8')).toBe('short')
    })

    it('creates a missing parent directory before writing', async () => {
      const nestedPath = join(tmpDir, 'nested', 'deep', 'file.json')
      await atomicWriteFile(nestedPath, 'hello')
      expect(await fs.readFile(nestedPath, 'utf-8')).toBe('hello')
    })

    it('handles concurrent writes to the same destination without ENOENT', async () => {
      const payloads = [0, 1, 2, 3, 4].map((i) => `content-${i}`)
      const results = await Promise.allSettled(
        payloads.map((data) => atomicWriteFile(filePath, data))
      )
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true)

      const final = await fs.readFile(filePath, 'utf-8')
      expect(payloads).toContain(final)

      const entries = await fs.readdir(tmpDir)
      expect(entries.some((name) => name.endsWith('.tmp'))).toBe(false)
    })
  })

  describe('edge cases / failure', () => {
    it('returns the fallback for a missing file (ENOENT)', async () => {
      const result = await readJsonFile(join(tmpDir, 'missing.json'), { fallback: true })
      expect(result).toEqual({ fallback: true })
    })

    it('throws on invalid JSON instead of swallowing the error', async () => {
      await fs.writeFile(filePath, '{ not valid json', 'utf-8')
      await expect(readJsonFile(filePath, {})).rejects.toThrow(SyntaxError)
    })

    it('leaves a single valid final file after sequential writes', async () => {
      for (let i = 0; i < 5; i++) {
        await atomicWriteFile(filePath, `content-${i}`)
      }
      expect(await fs.readFile(filePath, 'utf-8')).toBe('content-4')
      await expect(fs.access(`${filePath}.tmp`)).rejects.toThrow()
    })
  })

  describe('rename retry', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    const eperm = (): NodeJS.ErrnoException => Object.assign(new Error('EPERM'), { code: 'EPERM' })
    const enoent = (): NodeJS.ErrnoException => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

    // Resolve the retry backoff delay instantly instead of waiting real ms,
    // without disturbing real fs I/O (which fake timers interfere with).
    const skipBackoffDelay = (): void => {
      vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
        cb()
        return 0 as unknown as NodeJS.Timeout
      }) as typeof setTimeout)
    }

    it('retries transient EPERM then succeeds', async () => {
      const realRename = fs.rename.bind(fs)
      let calls = 0
      vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
        calls++
        if (calls < 3) throw eperm()
        return realRename(...args)
      })
      skipBackoffDelay()

      await atomicWriteFile(filePath, 'hello')

      expect(await fs.readFile(filePath, 'utf-8')).toBe('hello')
      expect(fs.rename).toHaveBeenCalledTimes(3)
    })

    it('exhausts retries and rethrows', async () => {
      vi.spyOn(fs, 'rename').mockImplementation(async () => {
        throw eperm()
      })
      skipBackoffDelay()

      await expect(atomicWriteFile(filePath, 'hello')).rejects.toMatchObject({ code: 'EPERM' })

      const entries = await fs.readdir(tmpDir)
      expect(entries.some((name) => name.endsWith('.tmp'))).toBe(false)
    })

    it('does not retry non-transient errors', async () => {
      vi.spyOn(fs, 'rename').mockImplementation(async () => {
        throw enoent()
      })
      skipBackoffDelay()

      await expect(atomicWriteFile(filePath, 'hello')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(fs.rename).toHaveBeenCalledTimes(1)
    })
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
})

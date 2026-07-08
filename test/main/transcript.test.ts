import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import { tailTranscript } from '../../src/main/sessions/transcript'

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'transcript-basic.jsonl')

describe('tailTranscript', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'transcript-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  function tmpFile(name: string): string {
    return join(tmpDir, name)
  }

  describe('happy path', () => {
    it('parses title, model, and token sum on the first tail', async () => {
      const fixture = await fs.readFile(FIXTURE_PATH, 'utf-8')
      const filePath = tmpFile('t1.jsonl')
      await fs.writeFile(filePath, fixture, 'utf-8')

      const result = await tailTranscript(filePath)
      expect(result).toEqual({ aiTitle: 'First title', model: 'claude-x', totalTokens: 20 })
    })

    it('sums tokens incrementally across appended bytes only', async () => {
      const filePath = tmpFile('t2.jsonl')
      await fs.writeFile(
        filePath,
        `${JSON.stringify({ message: { model: 'claude-x', usage: { input_tokens: 10 } } })}\n`,
        'utf-8'
      )
      const first = await tailTranscript(filePath)
      expect(first.totalTokens).toBe(10)

      await fs.appendFile(
        filePath,
        `${JSON.stringify({ message: { model: 'claude-x', usage: { input_tokens: 7 } } })}\n`,
        'utf-8'
      )
      const second = await tailTranscript(filePath)
      expect(second.totalTokens).toBe(17)
    })

    it('reflects the latest aiTitle and model when multiple lines are present', async () => {
      const filePath = tmpFile('t3.jsonl')
      await fs.writeFile(
        filePath,
        `${JSON.stringify({ aiTitle: 'First title' })}\n${JSON.stringify({
          message: { model: 'claude-x', usage: {} }
        })}\n`,
        'utf-8'
      )
      await tailTranscript(filePath)

      await fs.appendFile(
        filePath,
        `${JSON.stringify({ aiTitle: 'Second title' })}\n${JSON.stringify({
          message: { model: 'claude-y', usage: {} }
        })}\n`,
        'utf-8'
      )
      const result = await tailTranscript(filePath)
      expect(result.aiTitle).toBe('Second title')
      expect(result.model).toBe('claude-y')
    })
  })

  describe('edge cases', () => {
    it('does not count a partial trailing line until it is completed', async () => {
      const filePath = tmpFile('t4.jsonl')
      await fs.writeFile(filePath, '', 'utf-8')

      const completeLine = JSON.stringify({ message: { model: 'claude-x', usage: { input_tokens: 5 } } })
      await fs.appendFile(filePath, completeLine.slice(0, -1), 'utf-8') // no trailing \n, missing last char
      const partial = await tailTranscript(filePath)
      expect(partial.totalTokens).toBe(0)
      expect(partial.model).toBeUndefined()

      await fs.appendFile(filePath, `${completeLine.slice(-1)}\n`, 'utf-8')
      const completed = await tailTranscript(filePath)
      expect(completed.totalTokens).toBe(5)
      expect(completed.model).toBe('claude-x')
    })

    it('skips blank lines and non-JSON garbage without throwing', async () => {
      const filePath = tmpFile('t5.jsonl')
      await fs.writeFile(filePath, '\nnot json at all\n\n', 'utf-8')

      const result = await tailTranscript(filePath)
      expect(result.totalTokens).toBe(0)
      expect(result.aiTitle).toBeUndefined()
      expect(result.model).toBeUndefined()
    })

    it('updates model without changing totalTokens when a line has no usage', async () => {
      const filePath = tmpFile('t6.jsonl')
      await fs.writeFile(filePath, `${JSON.stringify({ message: { model: 'claude-x' } })}\n`, 'utf-8')

      const result = await tailTranscript(filePath)
      expect(result.model).toBe('claude-x')
      expect(result.totalTokens).toBe(0)
    })

    it('sums only the numeric fields of a partial usage object', async () => {
      const filePath = tmpFile('t7.jsonl')
      await fs.writeFile(
        filePath,
        `${JSON.stringify({
          message: { model: 'claude-x', usage: { input_tokens: 4, output_tokens: 'not-a-number' } }
        })}\n`,
        'utf-8'
      )

      const result = await tailTranscript(filePath)
      expect(result.totalTokens).toBe(4)
    })
  })

  describe('failure / reset', () => {
    it('resets and re-reads from scratch when the file is truncated', async () => {
      const filePath = tmpFile('t8.jsonl')
      await fs.writeFile(
        filePath,
        `${JSON.stringify({ message: { model: 'claude-x', usage: { input_tokens: 50 } } })}\n`,
        'utf-8'
      )
      const grown = await tailTranscript(filePath)
      expect(grown.totalTokens).toBe(50)

      await fs.writeFile(
        filePath,
        `${JSON.stringify({ message: { model: 'claude-y', usage: { input_tokens: 3 } } })}\n`,
        'utf-8'
      )
      const afterTruncate = await tailTranscript(filePath)
      expect(afterTruncate.totalTokens).toBe(3)
      expect(afterTruncate.model).toBe('claude-y')
    })

    it('returns an empty enrichment without throwing for a non-existent path', async () => {
      const filePath = tmpFile('does-not-exist.jsonl')
      const result = await tailTranscript(filePath)
      expect(result).toEqual({ aiTitle: undefined, model: undefined, totalTokens: 0 })
    })
  })
})

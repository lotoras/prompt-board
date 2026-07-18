import { promises as fs } from 'fs'
import { randomBytes } from 'crypto'
import { dirname } from 'path'

const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_MAX_RETRIES = 10

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (attempt >= RENAME_MAX_RETRIES || !RENAME_RETRY_CODES.has(code)) throw err
      await delay(Math.min(200, 10 * 2 ** attempt))
    }
  }
}

/**
 * Write `data` to `filePath` atomically: write to a temp file then rename
 * over the destination. Never truncates the live file in place.
 */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  await fs.mkdir(dirname(filePath), { recursive: true })
  try {
    await fs.writeFile(tmpPath, data, 'utf-8')
    await renameWithRetry(tmpPath, filePath)
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return fallback
    throw err
  }
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await atomicWriteFile(filePath, JSON.stringify(data, null, 2))
}

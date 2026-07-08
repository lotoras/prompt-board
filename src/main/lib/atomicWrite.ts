import { promises as fs } from 'fs'

/**
 * Write `data` to `filePath` atomically: write to a temp file then rename
 * over the destination. Never truncates the live file in place.
 */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`
  await fs.writeFile(tmpPath, data, 'utf-8')
  await fs.rename(tmpPath, filePath)
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

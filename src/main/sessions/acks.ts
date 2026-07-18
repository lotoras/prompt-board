import { app } from 'electron'
import { join } from 'path'
import { readJsonFile, writeJsonFile } from '../lib/atomicWrite'

function filePath(): string {
  return join(app.getPath('userData'), 'sessionAcks.json')
}

let cache: Record<string, number> | null = null

async function load(): Promise<Record<string, number>> {
  if (cache) return cache
  try {
    cache = await readJsonFile<Record<string, number>>(filePath(), {})
  } catch (err) {
    console.error('failed to load sessionAcks.json', err)
    cache = {}
  }
  return cache
}

export async function getAcks(): Promise<Record<string, number>> {
  return load()
}

export async function acknowledgeSession(sessionId: string, statusUpdatedAt: number): Promise<void> {
  const acks = await load()
  acks[sessionId] = statusUpdatedAt
  await writeJsonFile(filePath(), acks)
}

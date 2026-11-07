import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import { EFFORT_LEVELS } from '../../shared/chat'
import type { EffortLevel } from '../../shared/types'

const FALLBACK = { model: 'opus', effort: 'high' as EffortLevel }

function isEffort(v: unknown): v is EffortLevel {
  return typeof v === 'string' && (EFFORT_LEVELS as string[]).includes(v)
}

export function readClaudeDefaults(settings: unknown): { model: string; effort: EffortLevel } {
  if (typeof settings !== 'object' || settings === null) return { ...FALLBACK }
  const s = settings as Record<string, unknown>
  const model = typeof s.model === 'string' && s.model ? s.model : FALLBACK.model

  let effort: EffortLevel | undefined
  const perModel = s.modelSettings
  if (typeof perModel === 'object' && perModel !== null) {
    for (const [key, value] of Object.entries(perModel)) {
      if (!key.toLowerCase().includes(model.toLowerCase())) continue
      const level = (value as Record<string, unknown> | null)?.effortLevel
      if (isEffort(level)) {
        effort = level
        break
      }
    }
  }
  if (!effort && isEffort(s.effortLevel)) effort = s.effortLevel
  return { model, effort: effort ?? FALLBACK.effort }
}

export async function loadClaudeDefaults(): Promise<{ model: string; effort: EffortLevel }> {
  try {
    const raw = await fs.readFile(join(os.homedir(), '.claude', 'settings.json'), 'utf-8')
    return readClaudeDefaults(JSON.parse(raw))
  } catch {
    return { ...FALLBACK }
  }
}

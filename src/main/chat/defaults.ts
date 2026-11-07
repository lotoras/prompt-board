import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import { EFFORT_LEVELS, DEFAULT_PERMISSION_MODE, toPermissionMode } from '../../shared/chat'
import type { EffortLevel, PermissionModeId } from '../../shared/types'

export interface ClaudeDefaults {
  model: string
  effort: EffortLevel
  permissionMode: PermissionModeId
}

const FALLBACK: ClaudeDefaults = {
  model: 'opus',
  effort: 'high',
  permissionMode: DEFAULT_PERMISSION_MODE
}

function isEffort(v: unknown): v is EffortLevel {
  return typeof v === 'string' && (EFFORT_LEVELS as string[]).includes(v)
}

export function readClaudeDefaults(settings: unknown): ClaudeDefaults {
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
  const perms = s.permissions
  const permissionMode = toPermissionMode(
    typeof perms === 'object' && perms !== null ? (perms as Record<string, unknown>).defaultMode : undefined
  )
  return { model, effort: effort ?? FALLBACK.effort, permissionMode }
}

export async function loadClaudeDefaults(): Promise<ClaudeDefaults> {
  try {
    const raw = await fs.readFile(join(os.homedir(), '.claude', 'settings.json'), 'utf-8')
    return readClaudeDefaults(JSON.parse(raw))
  } catch {
    return { ...FALLBACK }
  }
}

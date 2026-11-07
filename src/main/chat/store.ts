import { app } from 'electron'
import { join } from 'path'
import { DEFAULT_PERMISSION_MODE, DEFAULT_TOGGLES, toPermissionMode } from '../../shared/chat'
import type {
  EffortLevel,
  PermissionModeId,
  PersistedChat,
  PersistedChatsState,
  PersistedTerminalsState,
  Project
} from '../../shared/types'
import { readJsonFile, writeJsonFile } from '../lib/atomicWrite'
import { listProjects } from '../projects/store'
import { loadPersisted } from '../pty/persistence'
import { loadClaudeDefaults } from './defaults'

function filePath(): string {
  return join(app.getPath('userData'), 'chats.json')
}

export function migrateFromTerminals(
  t: PersistedTerminalsState,
  projects: Project[],
  now: number,
  defaults: { model: string; effort: EffortLevel; permissionMode?: PermissionModeId }
): PersistedChatsState {
  const byKey = new Map(projects.map((p) => [p.projectKey, p]))
  const chats: PersistedChat[] = []
  const chatIdBySession = new Map<string, string>()
  for (const term of t.terminals) {
    const project = byKey.get(term.projectKey)
    if (!project) continue
    const chatId = 'mig-' + term.sessionId
    chatIdBySession.set(term.sessionId, chatId)
    chats.push({
      chatId,
      projectKey: term.projectKey,
      sessionId: term.sessionId,
      title: term.title || 'Chat',
      cwd: project.basePath,
      model: defaults.model,
      effort: defaults.effort,
      toggles: DEFAULT_TOGGLES,
      permissionMode: defaults.permissionMode ?? DEFAULT_PERMISSION_MODE,
      started: true,
      createdAt: now,
      updatedAt: now
    })
  }
  const activeByProject: Record<string, string> = {}
  for (const [projectKey, sessionId] of Object.entries(t.activeSessionByProject ?? {})) {
    const chatId = chatIdBySession.get(sessionId)
    if (chatId) activeByProject[projectKey] = chatId
  }
  return { chats, activeByProject }
}

export async function saveChatsState(state: PersistedChatsState): Promise<void> {
  await writeJsonFile(filePath(), state)
}

export async function loadChatsState(): Promise<PersistedChatsState> {
  let existing: PersistedChatsState | null
  try {
    existing = await readJsonFile<PersistedChatsState | null>(filePath(), null)
  } catch {
    return { chats: [], activeByProject: {} }
  }
  if (existing) {
    if (!Array.isArray(existing.chats)) return { chats: [], activeByProject: {} }
    const chats = existing.chats.map((c) => ({ ...c, permissionMode: toPermissionMode(c.permissionMode) }))
    return { chats, activeByProject: existing.activeByProject ?? {} }
  }
  const migrated = migrateFromTerminals(
    await loadPersisted(),
    await listProjects(),
    Date.now(),
    await loadClaudeDefaults()
  )
  await saveChatsState(migrated)
  return migrated
}

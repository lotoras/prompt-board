import { app, BrowserWindow } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { pathKey, projectPaths } from '../../shared/pathKey'
import { IPC_CHANNELS } from '../../shared/types'
import type { Project, ProjectInput } from '../../shared/types'
import { readJsonFile, writeJsonFile } from '../lib/atomicWrite'
import { enqueueProject, isApplyingRemote, nextTimestamp } from '../sync/engine'

function filePath(): string {
  return join(app.getPath('userData'), 'projects.json')
}

let cache: Project[] | null = null
let getWindowRef: (() => BrowserWindow | null) | null = null

export function setWindowGetter(getWindow: () => BrowserWindow | null): void {
  getWindowRef = getWindow
}

async function load(): Promise<Project[]> {
  if (cache) return cache
  try {
    cache = await readJsonFile<Project[]>(filePath(), [])
  } catch (err) {
    console.error('failed to load projects.json', err)
    cache = []
  }
  return cache
}

async function persist(): Promise<void> {
  await writeJsonFile(filePath(), cache ?? [])
}

function broadcastChanged(): void {
  const win = getWindowRef?.()
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.projects.changed, cache ?? [])
  }
}

export async function assertProjectDirectory(basePath: string): Promise<void> {
  let stat
  try {
    stat = await fs.stat(basePath)
  } catch {
    throw new Error(`basePath does not exist: ${basePath}`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`basePath is not a directory: ${basePath}`)
  }
}

/** Trimmed, de-duplicated other paths (never the base path itself); undefined when none. */
function cleanOtherPaths(basePath: string, otherPaths: string[] | undefined): string[] | undefined {
  const seen = new Set([pathKey(basePath)])
  const out: string[] = []
  for (const raw of otherPaths ?? []) {
    const path = raw.trim()
    if (!path || seen.has(pathKey(path))) continue
    seen.add(pathKey(path))
    out.push(path)
  }
  return out.length > 0 ? out : undefined
}

/**
 * At least one of the project's folders must exist on this device — the others can be
 * the same project's checkout on another PC.
 */
async function assertSomeProjectDirectory(paths: string[]): Promise<void> {
  let first: unknown
  for (const path of paths) {
    try {
      await assertProjectDirectory(path)
      return
    } catch (err) {
      first ??= err
    }
  }
  throw first
}

/** The project's folder on this device: the first of its paths that exists, else the base path. */
export function localProjectPath(project: Project): string {
  return projectPaths(project).find((p) => existsSync(p)) ?? project.basePath
}

export async function listProjects(): Promise<Project[]> {
  return load()
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const otherPaths = cleanOtherPaths(input.basePath, input.otherPaths)
  await assertSomeProjectDirectory([input.basePath, ...(otherPaths ?? [])])
  const projects = await load()
  const projectKey = pathKey(input.basePath)
  if (projects.some((p) => p.projectKey === projectKey)) {
    throw new Error(`Project already exists for path: ${input.basePath}`)
  }
  const now = nextTimestamp()
  const project: Project = {
    projectKey,
    name: input.name,
    basePath: input.basePath,
    ...(otherPaths ? { otherPaths } : {}),
    createdAt: now,
    updatedAt: now
  }
  projects.push(project)
  await persist()
  broadcastChanged()
  if (!isApplyingRemote()) await enqueueProject(project)
  return project
}

export async function updateProject(
  projectKey: string,
  patch: Partial<ProjectInput>
): Promise<Project> {
  const projects = await load()
  const index = projects.findIndex((p) => p.projectKey === projectKey)
  if (index === -1) {
    throw new Error(`Project not found: ${projectKey}`)
  }
  const existing = projects[index]
  const basePath = patch.basePath ?? existing.basePath
  const otherPaths = cleanOtherPaths(basePath, patch.otherPaths ?? existing.otherPaths)
  if (patch.basePath !== undefined || patch.otherPaths !== undefined) {
    await assertSomeProjectDirectory([basePath, ...(otherPaths ?? [])])
  }
  const updated: Project = {
    ...existing,
    ...patch,
    projectKey: patch.basePath ? pathKey(patch.basePath) : existing.projectKey,
    updatedAt: nextTimestamp()
  }
  delete updated.otherPaths
  if (otherPaths) updated.otherPaths = otherPaths
  projects[index] = updated
  await persist()
  broadcastChanged()
  if (!isApplyingRemote()) await enqueueProject(updated)
  return updated
}

export async function deleteProject(projectKey: string): Promise<void> {
  const projects = await load()
  const index = projects.findIndex((p) => p.projectKey === projectKey)
  if (index === -1) return
  const [removed] = projects.splice(index, 1)
  await persist()
  broadcastChanged()
  if (!isApplyingRemote()) await enqueueProject(removed, nextTimestamp())
}

/** Applies a remote row as-is (used by the sync engine's LWW merge; never enqueues). */
export async function applyRemoteProject(project: Project): Promise<void> {
  const projects = await load()
  const index = projects.findIndex((p) => p.projectKey === project.projectKey)
  if (index === -1) projects.push(project)
  else projects[index] = project
  await persist()
  broadcastChanged()
}

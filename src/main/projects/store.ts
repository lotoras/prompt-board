import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { pathKey } from '../../shared/pathKey'
import type { Project, ProjectInput } from '../../shared/types'
import { readJsonFile, writeJsonFile } from '../lib/atomicWrite'

function filePath(): string {
  return join(app.getPath('userData'), 'projects.json')
}

let cache: Project[] | null = null

async function load(): Promise<Project[]> {
  if (cache) return cache
  cache = await readJsonFile<Project[]>(filePath(), [])
  return cache
}

async function persist(): Promise<void> {
  await writeJsonFile(filePath(), cache ?? [])
}

async function assertDirectory(basePath: string): Promise<void> {
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

export async function listProjects(): Promise<Project[]> {
  return load()
}

export async function createProject(input: ProjectInput): Promise<Project> {
  await assertDirectory(input.basePath)
  const projects = await load()
  const projectKey = pathKey(input.basePath)
  if (projects.some((p) => p.projectKey === projectKey)) {
    throw new Error(`Project already exists for path: ${input.basePath}`)
  }
  const now = Date.now()
  const project: Project = {
    projectKey,
    name: input.name,
    basePath: input.basePath,
    createdAt: now,
    updatedAt: now
  }
  projects.push(project)
  await persist()
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
  if (patch.basePath !== undefined) {
    await assertDirectory(patch.basePath)
  }
  const existing = projects[index]
  const updated: Project = {
    ...existing,
    ...patch,
    projectKey: patch.basePath ? pathKey(patch.basePath) : existing.projectKey,
    updatedAt: Date.now()
  }
  projects[index] = updated
  await persist()
  return updated
}

export async function deleteProject(projectKey: string): Promise<void> {
  const projects = await load()
  const index = projects.findIndex((p) => p.projectKey === projectKey)
  if (index === -1) return
  projects.splice(index, 1)
  await persist()
}

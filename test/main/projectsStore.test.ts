import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import { pathKey } from '../../src/shared/pathKey'

const { userDataDir } = vi.hoisted(() => ({ userDataDir: { current: '' } }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir.current }
}))

describe('projects/store', () => {
  let tmpDir: string
  let projectDir: string

  beforeEach(async () => {
    vi.resetModules()
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'projects-store-'))
    userDataDir.current = tmpDir
    projectDir = await fs.mkdtemp(join(os.tmpdir(), 'projects-store-basepath-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    await fs.rm(projectDir, { recursive: true, force: true })
  })

  async function loadStore() {
    return import('../../src/main/projects/store')
  }

  describe('happy path', () => {
    it('creates a project and persists it atomically', async () => {
      const { createProject } = await loadStore()
      const project = await createProject({ name: 'My Project', basePath: projectDir })

      expect(project.projectKey).toBe(pathKey(projectDir))
      expect(project.createdAt).toBeGreaterThan(0)
      expect(project.updatedAt).toBeGreaterThan(0)

      const file = join(tmpDir, 'projects.json')
      const raw = await fs.readFile(file, 'utf-8')
      expect(() => JSON.parse(raw)).not.toThrow()
      await expect(fs.access(`${file}.tmp`)).rejects.toThrow()
    })

    it('lists created projects and persists across a fresh module load', async () => {
      const { createProject, listProjects } = await loadStore()
      await createProject({ name: 'My Project', basePath: projectDir })
      expect(await listProjects()).toHaveLength(1)

      vi.resetModules()
      const fresh = await loadStore()
      const reloaded = await fresh.listProjects()
      expect(reloaded).toHaveLength(1)
      expect(reloaded[0].basePath).toBe(projectDir)
    })

    it('updates a project name without changing its projectKey', async () => {
      const { createProject, updateProject } = await loadStore()
      const project = await createProject({ name: 'Old Name', basePath: projectDir })
      const updated = await updateProject(project.projectKey, { name: 'New Name' })
      expect(updated.name).toBe('New Name')
      expect(updated.projectKey).toBe(project.projectKey)
      expect(updated.updatedAt).toBeGreaterThanOrEqual(project.updatedAt)
    })

    it('recomputes projectKey when basePath changes', async () => {
      const { createProject, updateProject } = await loadStore()
      const project = await createProject({ name: 'Name', basePath: projectDir })
      const newDir = await fs.mkdtemp(join(os.tmpdir(), 'projects-store-newbase-'))
      try {
        const updated = await updateProject(project.projectKey, { basePath: newDir })
        expect(updated.projectKey).toBe(pathKey(newDir))
      } finally {
        await fs.rm(newDir, { recursive: true, force: true })
      }
    })

    it('deletes a project', async () => {
      const { createProject, deleteProject, listProjects } = await loadStore()
      const project = await createProject({ name: 'Name', basePath: projectDir })
      await deleteProject(project.projectKey)
      expect(await listProjects()).toEqual([])
    })
  })

  describe('edge cases / failure', () => {
    it('rejects creation with a non-existent basePath', async () => {
      const { createProject } = await loadStore()
      await expect(
        createProject({ name: 'Name', basePath: join(tmpDir, 'nope') })
      ).rejects.toThrow('basePath does not exist')
    })

    it('rejects creation when basePath is a file, not a directory', async () => {
      const filePath = join(projectDir, 'file.txt')
      await fs.writeFile(filePath, 'x', 'utf-8')
      const { createProject } = await loadStore()
      await expect(createProject({ name: 'Name', basePath: filePath })).rejects.toThrow(
        'is not a directory'
      )
    })

    it('rejects creating a duplicate project for the same normalized path', async () => {
      const { createProject } = await loadStore()
      await createProject({ name: 'Name', basePath: projectDir })
      await expect(createProject({ name: 'Other', basePath: projectDir })).rejects.toThrow(
        'already exists'
      )
    })

    it('rejects updating a missing project', async () => {
      const { updateProject } = await loadStore()
      await expect(updateProject('missing-key', { name: 'x' })).rejects.toThrow(
        'Project not found'
      )
    })

    it('resolves without throwing when deleting a missing project, leaving the list unchanged', async () => {
      const { createProject, deleteProject, listProjects } = await loadStore()
      await createProject({ name: 'Name', basePath: projectDir })
      await expect(deleteProject('missing-key')).resolves.toBeUndefined()
      expect(await listProjects()).toHaveLength(1)
    })

    it('returns an empty list when no projects file exists', async () => {
      const { listProjects } = await loadStore()
      expect(await listProjects()).toEqual([])
    })
  })
})

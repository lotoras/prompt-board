import type { StateCreator } from 'zustand'
import type { Project, ProjectInput } from '../../../shared/types'
import { api } from '../lib/api'
import type { StoreState } from './index'

export interface ProjectsSlice {
  projects: Project[]
  setProjects: (projects: Project[]) => void
  loadProjects: () => Promise<void>
  createProject: (input: ProjectInput) => Promise<Project>
  updateProject: (projectKey: string, patch: Partial<ProjectInput>) => Promise<Project>
  deleteProject: (projectKey: string) => Promise<void>
}

export const createProjectsSlice: StateCreator<StoreState, [], [], ProjectsSlice> = (set) => ({
  projects: [],
  setProjects: (projects) => set({ projects }),
  loadProjects: async () => {
    const projects = await api.projects.list()
    set({ projects })
  },
  createProject: async (input) => {
    const project = await api.projects.create(input)
    set((state) => ({ projects: [...state.projects, project] }))
    return project
  },
  updateProject: async (projectKey, patch) => {
    const project = await api.projects.update(projectKey, patch)
    set((state) => ({
      projects: state.projects.map((p) => (p.projectKey === projectKey ? project : p))
    }))
    return project
  },
  deleteProject: async (projectKey) => {
    await api.projects.delete(projectKey)
    set((state) => ({ projects: state.projects.filter((p) => p.projectKey !== projectKey) }))
  }
})

import type { StateCreator } from 'zustand'
import type { StoreState } from './index'

export type ProjectTab = 'sessions' | 'board' | 'terminals'

export type UiView =
  { kind: 'global-board' } | { kind: 'project'; projectKey: string; tab: ProjectTab }

export type ProjectModalState =
  | { mode: 'create' }
  | { mode: 'edit'; projectKey: string }
  | { mode: 'promote'; projectKey: string; suggestedName: string }

export interface UiSlice {
  view: UiView
  setView: (view: UiView) => void
  setProjectTab: (tab: ProjectTab) => void
  editingCardId: string | null
  setEditingCardId: (id: string | null) => void
  projectModal: ProjectModalState | null
  setProjectModal: (modal: ProjectModalState | null) => void
}

const STORAGE_KEY = 'prompt-board:ui:view'

function loadInitialView(): UiView {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { kind: 'global-board' }
    const parsed = JSON.parse(raw) as UiView
    if (parsed.kind === 'global-board') return parsed
    if (parsed.kind === 'project' && typeof parsed.projectKey === 'string') return parsed
  } catch {
    // ignore malformed storage
  }
  return { kind: 'global-board' }
}

function persistView(view: UiView): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(view))
  } catch {
    // ignore storage failures (e.g. private mode)
  }
}

export const createUiSlice: StateCreator<StoreState, [], [], UiSlice> = (set, get) => ({
  view: loadInitialView(),
  setView: (view) => {
    persistView(view)
    set({ view })
  },
  setProjectTab: (tab) => {
    const current = get().view
    if (current.kind !== 'project') return
    const next: UiView = { ...current, tab }
    persistView(next)
    set({ view: next })
  },
  editingCardId: null,
  setEditingCardId: (id) => set({ editingCardId: id }),
  projectModal: null,
  setProjectModal: (modal) => set({ projectModal: modal })
})

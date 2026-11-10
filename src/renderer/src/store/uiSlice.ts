import type { StateCreator } from 'zustand'
import type { StoreState } from './index'

export type UiView = { kind: 'global-board' } | { kind: 'project'; projectKey: string }

export type ProjectModalState =
  | { mode: 'create' }
  | { mode: 'edit'; projectKey: string }
  | { mode: 'promote'; projectKey: string; suggestedName: string }

export type PopoverKind = 'model' | 'effort' | 'base' | 'mode' | 'account'

export interface UiSlice {
  view: UiView
  setView: (view: UiView) => void
  editingCardId: string | null
  setEditingCardId: (id: string | null) => void
  projectModal: ProjectModalState | null
  setProjectModal: (modal: ProjectModalState | null) => void
  syncModalOpen: boolean
  setSyncModalOpen: (open: boolean) => void
  globalBoardMode: 'board' | 'aktuelles'
  setGlobalBoardMode: (mode: 'board' | 'aktuelles') => void
  soundEnabled: boolean
  setSoundEnabled: (on: boolean) => void
  sideOpen: boolean
  setSideOpen: (open: boolean) => void
  drawerOpen: boolean
  toggleDrawer: (open?: boolean) => void
  changesOpen: boolean
  setChangesOpen: (open: boolean) => void
  popover: PopoverKind | null
  setPopover: (popover: PopoverKind | null) => void
  /** The last toast stays in state (hidden) so its text does not vanish mid fade-out. */
  toast: { text: string; n: number; visible: boolean } | null
  showToast: (text: string) => void
}

const STORAGE_KEY = 'prompt-board:ui:view'
const SOUND_KEY = 'prompt-board:ui:sound'

function loadSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'false'
  } catch {
    return true
  }
}

function persistSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, String(on))
  } catch {
    // ignore storage failures (e.g. private mode)
  }
}

function loadInitialView(): UiView {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { kind: 'global-board' }
    const parsed = JSON.parse(raw) as UiView
    if (parsed.kind === 'global-board') return parsed
    if (parsed.kind === 'project' && typeof parsed.projectKey === 'string') {
      return { kind: 'project', projectKey: parsed.projectKey }
    }
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

let toastTimer: ReturnType<typeof setTimeout> | undefined
let toastCount = 0

export const createUiSlice: StateCreator<StoreState, [], [], UiSlice> = (set, get) => ({
  view: loadInitialView(),
  setView: (view) => {
    persistView(view)
    set({ view, sideOpen: false })
  },
  editingCardId: null,
  setEditingCardId: (id) => set({ editingCardId: id }),
  projectModal: null,
  setProjectModal: (modal) => set({ projectModal: modal }),
  syncModalOpen: false,
  setSyncModalOpen: (open) => set({ syncModalOpen: open }),
  globalBoardMode: 'board',
  setGlobalBoardMode: (mode) => set({ globalBoardMode: mode }),
  soundEnabled: loadSoundEnabled(),
  setSoundEnabled: (on) => {
    persistSoundEnabled(on)
    set({ soundEnabled: on })
  },
  sideOpen: false,
  setSideOpen: (open) => set({ sideOpen: open }),
  drawerOpen: false,
  toggleDrawer: (open) => set({ drawerOpen: open ?? !get().drawerOpen }),
  changesOpen: false,
  setChangesOpen: (changesOpen) => set({ changesOpen }),
  popover: null,
  setPopover: (popover) => set({ popover }),
  toast: null,
  showToast: (text) => {
    toastCount += 1
    set({ toast: { text, n: toastCount, visible: true } })
    clearTimeout(toastTimer)
    toastTimer = setTimeout(
      () => set((s) => (s.toast ? { toast: { ...s.toast, visible: false } } : s)),
      2200
    )
  }
})

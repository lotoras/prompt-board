import { create } from 'zustand'
import { type SessionsSlice, createSessionsSlice } from './sessionsSlice'
import { type ProjectsSlice, createProjectsSlice } from './projectsSlice'
import { type BoardsSlice, createBoardsSlice } from './boardsSlice'
import { type UiSlice, createUiSlice } from './uiSlice'
import { type TerminalsSlice, createTerminalsSlice } from './terminalsSlice'

export type StoreState = SessionsSlice & ProjectsSlice & BoardsSlice & UiSlice & TerminalsSlice

export const useStore = create<StoreState>()((...a) => ({
  ...createSessionsSlice(...a),
  ...createProjectsSlice(...a),
  ...createBoardsSlice(...a),
  ...createUiSlice(...a),
  ...createTerminalsSlice(...a)
}))

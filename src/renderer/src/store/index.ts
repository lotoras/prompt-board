import { create } from 'zustand'
import { type SessionsSlice, createSessionsSlice } from './sessionsSlice'
import { type ProjectsSlice, createProjectsSlice } from './projectsSlice'
import { type BoardsSlice, createBoardsSlice } from './boardsSlice'
import { type UiSlice, createUiSlice } from './uiSlice'

export type StoreState = SessionsSlice & ProjectsSlice & BoardsSlice & UiSlice

export const useStore = create<StoreState>()((...a) => ({
  ...createSessionsSlice(...a),
  ...createProjectsSlice(...a),
  ...createBoardsSlice(...a),
  ...createUiSlice(...a)
}))

import type { StateCreator } from 'zustand'
import type { SyncStatus } from '../../../shared/types'
import type { StoreState } from './index'

export interface SyncSlice {
  syncStatus: SyncStatus
  setSyncStatus: (status: SyncStatus) => void
}

const initialSyncStatus: SyncStatus = { state: 'disabled', pendingOps: 0 }

export const createSyncSlice: StateCreator<StoreState, [], [], SyncSlice> = (set) => ({
  syncStatus: initialSyncStatus,
  setSyncStatus: (status) => set({ syncStatus: status })
})

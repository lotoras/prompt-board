import type { SyncStatus } from '../../../../shared/types'

export function syncDotColor(status: SyncStatus): 'green' | 'amber' | 'grey' {
  if (status.state === 'disabled') return 'grey'
  if (status.state === 'online' && status.pendingOps === 0) return 'green'
  return 'amber'
}

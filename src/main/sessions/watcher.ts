import chokidar, { type FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { reconcilePendingSpawns, refreshPtyBindings } from '../pty/reconcile'
import { sessionsDir } from './registry'
import { buildSnapshot } from './snapshot'
import { projectsDir } from './transcript'

const DEBOUNCE_MS = 150
const SAFETY_POLL_MS = 5000

let watcher: FSWatcher | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastSnapshotJson = ''
let running = false
let rerun = false
let forceNext = false

async function recomputeOnce(getWindow: () => BrowserWindow | null, force: boolean): Promise<void> {
  try {
    const snapshot = await buildSnapshot()
    refreshPtyBindings(snapshot, getWindow)
    reconcilePendingSpawns(snapshot, getWindow)
    const json = JSON.stringify(snapshot)
    if (!force && json === lastSnapshotJson) return
    lastSnapshotJson = json
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.sessions.changed, snapshot)
    }
  } catch (err) {
    console.error('recomputeOnce failed', err)
  }
}

/**
 * Single-flight: a call made while a recompute is running queues one
 * follow-up run instead of overlapping, so an older snapshot can never be
 * emitted after a newer one. `force` emits even when the snapshot is unchanged.
 */
async function recomputeAndEmit(
  getWindow: () => BrowserWindow | null,
  force = false
): Promise<void> {
  if (force) forceNext = true
  if (running) {
    rerun = true
    return
  }
  running = true
  try {
    do {
      rerun = false
      const forceThis = forceNext
      forceNext = false
      await recomputeOnce(getWindow, forceThis)
    } while (rerun)
  } finally {
    running = false
  }
}

function scheduleDebounced(getWindow: () => BrowserWindow | null): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void recomputeAndEmit(getWindow)
  }, DEBOUNCE_MS)
}

/**
 * Watch the sessions registry and transcript directories for changes and
 * push a recomputed snapshot to the renderer when it differs from the last
 * one sent. Backed by a 5s safety poll to cover missed FS events.
 */
export function startSessionsWatcher(getWindow: () => BrowserWindow | null): void {
  watcher = chokidar.watch([sessionsDir(), projectsDir()], {
    ignoreInitial: true,
    depth: 2
  })

  watcher.on('all', () => scheduleDebounced(getWindow))

  pollTimer = setInterval(() => {
    void recomputeAndEmit(getWindow)
  }, SAFETY_POLL_MS)

  void recomputeAndEmit(getWindow)
}

export function triggerSnapshotRefresh(getWindow: () => BrowserWindow | null): void {
  scheduleDebounced(getWindow)
}

/** Recompute immediately and always emit, so the renderer drops any optimistic state. */
export function refreshSnapshotNow(getWindow: () => BrowserWindow | null): Promise<void> {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = null
  return recomputeAndEmit(getWindow, true)
}

export function stopSessionsWatcher(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (pollTimer) clearInterval(pollTimer)
  void watcher?.close()
  watcher = null
  pollTimer = null
  debounceTimer = null
}

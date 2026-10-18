import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionsSnapshot } from '../../src/shared/types'

const { buildSnapshotMock } = vi.hoisted(() => ({ buildSnapshotMock: vi.fn() }))

vi.mock('../../src/main/sessions/snapshot', () => ({ buildSnapshot: buildSnapshotMock }))
vi.mock('../../src/main/pty/reconcile', () => ({
  refreshPtyBindings: vi.fn(),
  reconcilePendingSpawns: vi.fn()
}))
vi.mock('chokidar', () => ({
  default: { watch: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })) }
}))
vi.mock('electron', () => ({ app: { getPath: () => '' } }))

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function snap(name: string): SessionsSnapshot {
  return {
    projects: [{ projectKey: name, name, source: 'auto', needsAttention: false, sessions: [] }]
  }
}

describe('refreshSnapshotNow', () => {
  beforeEach(() => {
    vi.resetModules()
    buildSnapshotMock.mockReset()
  })

  function setup(): { send: ReturnType<typeof vi.fn>; getWindow: () => never } {
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    return { send, getWindow: (): never => win as never }
  }

  it('never overlaps rebuilds: calls during a run coalesce into one follow-up, newest emitted last', async () => {
    const first = deferred<SessionsSnapshot>()
    buildSnapshotMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(snap('new'))
    const { send, getWindow } = setup()

    const { refreshSnapshotNow } = await import('../../src/main/sessions/watcher')
    const p1 = refreshSnapshotNow(getWindow)
    void refreshSnapshotNow(getWindow)
    void refreshSnapshotNow(getWindow)
    expect(buildSnapshotMock).toHaveBeenCalledTimes(1)

    first.resolve(snap('old'))
    await p1

    expect(buildSnapshotMock).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.at(-1)?.[1]).toEqual(snap('new'))
  })

  it('emits even when the snapshot is unchanged', async () => {
    buildSnapshotMock.mockResolvedValue(snap('same'))
    const { send, getWindow } = setup()

    const { refreshSnapshotNow } = await import('../../src/main/sessions/watcher')
    await refreshSnapshotNow(getWindow)
    await refreshSnapshotNow(getWindow)

    expect(send).toHaveBeenCalledTimes(2)
  })
})

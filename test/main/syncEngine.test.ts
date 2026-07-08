import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'

const { userDataDir, supabaseState } = vi.hoisted(() => ({
  userDataDir: { current: '' },
  supabaseState: {
    projects: [] as Record<string, unknown>[],
    cards: [] as Record<string, unknown>[],
    upsertImpl: null as null | ((table: string, row: unknown) => { error: unknown } | Promise<{ error: unknown }>)
  }
}))

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir.current }
}))

vi.mock('@supabase/supabase-js', () => {
  function makeClient() {
    return {
      auth: {
        setSession: vi.fn(async () => ({ error: null })),
        signInWithPassword: vi.fn(async () => ({
          data: { session: { access_token: 'remote-at', refresh_token: 'remote-rt' } },
          error: null
        }))
      },
      from(table: string) {
        return {
          select: () => {
            const data = table === 'projects' ? supabaseState.projects : supabaseState.cards
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const thenable: any = Promise.resolve({ data, error: null })
            thenable.gt = () => thenable
            return thenable
          },
          upsert: async (row: unknown) => {
            if (supabaseState.upsertImpl) return supabaseState.upsertImpl(table, row)
            return { error: null }
          }
        }
      },
      channel() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ch: any = {
          on: vi.fn(() => ch),
          subscribe: vi.fn((cb?: (status: string) => void) => {
            cb?.('SUBSCRIBED')
            return ch
          }),
          unsubscribe: vi.fn(async () => {})
        }
        return ch
      }
    }
  }
  return { createClient: vi.fn(() => makeClient()) }
})

describe('sync/engine', () => {
  let tmpDir: string
  let projectDir: string

  beforeEach(async () => {
    vi.resetModules()
    supabaseState.projects = []
    supabaseState.cards = []
    supabaseState.upsertImpl = null
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'sync-engine-'))
    userDataDir.current = tmpDir
    projectDir = await fs.mkdtemp(join(os.tmpdir(), 'sync-engine-basepath-'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.doUnmock('../../src/main/sync/config')
    await fs.rm(tmpDir, { recursive: true, force: true })
    await fs.rm(projectDir, { recursive: true, force: true })
  })

  async function loadModules() {
    const [engine, config, projectsStore, kanbanStore] = await Promise.all([
      import('../../src/main/sync/engine'),
      import('../../src/main/sync/config'),
      import('../../src/main/projects/store'),
      import('../../src/main/kanban/store')
    ])
    return { engine, config, projectsStore, kanbanStore }
  }

  async function configureSync(config: Awaited<ReturnType<typeof loadModules>>['config'], deviceId = 'local-device') {
    await config.saveSyncConfig({
      url: 'https://x.supabase.co',
      anonKey: 'anon-key',
      email: 'a@b.com',
      deviceId,
      session: { accessToken: 'at', refreshToken: 'rt' }
    })
  }

  describe('LWW merge', () => {
    it('applies a remote project row that is newer than local (no local row yet)', async () => {
      const { engine, config, projectsStore } = await loadModules()
      const now = Date.now()
      supabaseState.projects = [
        {
          project_key: 'proj-1',
          name: 'Remote Name',
          base_path: '/remote/path',
          created_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(),
          deleted_at: null,
          device_id: 'remote-device'
        }
      ]
      await configureSync(config)
      await engine.startSync(() => null)

      const projects = await projectsStore.listProjects()
      expect(projects).toHaveLength(1)
      expect(projects[0].name).toBe('Remote Name')
    })

    it('ignores an older remote row when a newer local row exists', async () => {
      const { engine, config, projectsStore } = await loadModules()
      const local = await projectsStore.createProject({ name: 'Local Name', basePath: projectDir })

      supabaseState.projects = [
        {
          project_key: local.projectKey,
          name: 'Stale Remote Name',
          base_path: local.basePath,
          created_at: new Date(local.updatedAt - 10000).toISOString(),
          updated_at: new Date(local.updatedAt - 10000).toISOString(),
          deleted_at: null,
          device_id: 'remote-device'
        }
      ]
      await configureSync(config)
      await engine.startSync(() => null)

      const projects = await projectsStore.listProjects()
      expect(projects.find((p) => p.projectKey === local.projectKey)?.name).toBe('Local Name')
    })

    it('ignores a remote row with an identical timestamp to local', async () => {
      const { engine, config, projectsStore } = await loadModules()
      const local = await projectsStore.createProject({ name: 'Local Name', basePath: projectDir })

      supabaseState.projects = [
        {
          project_key: local.projectKey,
          name: 'Equal Timestamp Remote',
          base_path: local.basePath,
          created_at: new Date(local.updatedAt).toISOString(),
          updated_at: new Date(local.updatedAt).toISOString(),
          deleted_at: null,
          device_id: 'remote-device'
        }
      ]
      await configureSync(config)
      await engine.startSync(() => null)

      const projects = await projectsStore.listProjects()
      expect(projects.find((p) => p.projectKey === local.projectKey)?.name).toBe('Local Name')
    })

    it('applies a tombstoned remote row (deleted_at set, newer) by deleting the local row', async () => {
      const { engine, config, projectsStore } = await loadModules()
      const local = await projectsStore.createProject({ name: 'Local Name', basePath: projectDir })

      supabaseState.projects = [
        {
          project_key: local.projectKey,
          name: local.name,
          base_path: local.basePath,
          created_at: new Date(local.updatedAt).toISOString(),
          updated_at: new Date(local.updatedAt + 10000).toISOString(),
          deleted_at: new Date(local.updatedAt + 10000).toISOString(),
          device_id: 'remote-device'
        }
      ]
      await configureSync(config)
      await engine.startSync(() => null)

      const projects = await projectsStore.listProjects()
      expect(projects.find((p) => p.projectKey === local.projectKey)).toBeUndefined()
    })

    it('does not re-enqueue an applied remote change to the outbox (applyingRemote guard)', async () => {
      const { engine, config } = await loadModules()
      const now = Date.now()
      supabaseState.projects = [
        {
          project_key: 'proj-remote-only',
          name: 'Remote Name',
          base_path: '/remote/path',
          created_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(),
          deleted_at: null,
          device_id: 'remote-device'
        }
      ]
      await configureSync(config)
      await engine.startSync(() => null)

      const outbox = await config.loadOutbox()
      expect(outbox.ops.find((op) => op.id === 'projects:proj-remote-only')).toBeUndefined()
    })
  })

  describe('outbox', () => {
    it('enqueues a local mutation and persists it to sync-outbox.json', async () => {
      const { config, projectsStore } = await loadModules()
      await configureSync(config)
      const project = await projectsStore.createProject({ name: 'Name', basePath: projectDir })

      const raw = await fs.readFile(join(tmpDir, 'sync-outbox.json'), 'utf-8')
      const parsed = JSON.parse(raw)
      expect(parsed.ops).toHaveLength(1)
      expect(parsed.ops[0].id).toBe(`projects:${project.projectKey}`)
      expect(parsed.ops[0].table).toBe('projects')
    })

    it('survives a vi.resetModules() restart', async () => {
      const { config, projectsStore } = await loadModules()
      await configureSync(config)
      const project = await projectsStore.createProject({ name: 'Name', basePath: projectDir })

      vi.resetModules()
      const freshConfig = await import('../../src/main/sync/config')
      const outbox = await freshConfig.loadOutbox()
      expect(outbox.ops).toHaveLength(1)
      expect(outbox.ops[0].id).toBe(`projects:${project.projectKey}`)
    })

    it('dedups per row id, keeping only the latest op for the same row', async () => {
      const { config, projectsStore } = await loadModules()
      await configureSync(config)
      const project = await projectsStore.createProject({ name: 'Original', basePath: projectDir })
      await projectsStore.updateProject(project.projectKey, { name: 'Updated Once' })
      await projectsStore.updateProject(project.projectKey, { name: 'Updated Twice' })

      const outbox = await config.loadOutbox()
      const ops = outbox.ops.filter((op) => op.id === `projects:${project.projectKey}`)
      expect(ops).toHaveLength(1)
      expect((ops[0].row as { name: string }).name).toBe('Updated Twice')
    })

    it('retries a failing upsert with backoff, then succeeds and drains the queue', async () => {
      // Back the outbox/config with an in-memory store instead of real fs: real fs promises
      // resolve via the real event loop, which fake timers (used below for the backoff) don't
      // drive, so mixing them makes the awaited I/O inside flush() resolve unpredictably late.
      let outboxState: { ops: { id: string; table: string; row: unknown }[]; lastPulledAt?: number } = {
        ops: []
      }
      let syncConfigState: unknown = {
        url: 'https://x.supabase.co',
        anonKey: 'anon-key',
        email: 'a@b.com',
        deviceId: 'local-device',
        session: { accessToken: 'at', refreshToken: 'rt' }
      }
      vi.doMock('../../src/main/sync/config', () => ({
        loadSyncConfig: async () => syncConfigState,
        saveSyncConfig: async (c: unknown) => {
          syncConfigState = c
        },
        loadOutbox: async () => outboxState,
        saveOutbox: async (state: typeof outboxState) => {
          outboxState = state
        },
        resetSyncCaches: () => {}
      }))

      vi.useFakeTimers()
      try {
        const { engine, projectsStore } = await loadModules()
        await engine.startSync(() => null)

        let attempt = 0
        supabaseState.upsertImpl = () => {
          attempt += 1
          if (attempt === 1) return { error: { message: 'boom' } }
          return { error: null }
        }

        await projectsStore.createProject({ name: 'Name', basePath: projectDir })

        // first flush attempt fails
        await vi.advanceTimersByTimeAsync(0)
        expect(engine.getSyncStatus().state).toBe('offline')
        expect(outboxState.ops).toHaveLength(1)

        // backoff elapses (MIN_BACKOFF_MS doubled to 2000ms after the first failure), retry succeeds and drains
        await vi.advanceTimersByTimeAsync(2000)
        expect(engine.getSyncStatus().state).toBe('online')
        expect(outboxState.ops).toHaveLength(0)
        expect(attempt).toBe(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('nextTimestamp clock-skew guard', () => {
    it('stays close to Date.now() before any remote timestamp is observed', async () => {
      const { engine } = await loadModules()
      const before = Date.now()
      expect(engine.nextTimestamp()).toBeGreaterThanOrEqual(before)
    })

    it('becomes monotonic (now vs lastSeenRemote+1) after observing a future remote timestamp', async () => {
      const { engine, config } = await loadModules()
      const future = Date.now() + 10_000_000
      supabaseState.projects = [
        {
          project_key: 'proj-future',
          name: 'Future Remote',
          base_path: '/remote/path',
          created_at: new Date(future).toISOString(),
          updated_at: new Date(future).toISOString(),
          deleted_at: null,
          device_id: 'remote-device'
        }
      ]
      await configureSync(config)
      await engine.startSync(() => null)

      expect(engine.nextTimestamp()).toBe(future + 1)
    })
  })

  describe('config via engine.configure()', () => {
    it('generates a deviceId once and keeps it stable across a reconfigure', async () => {
      const { engine, config } = await loadModules()
      const first = await engine.configure(
        { url: 'https://x.supabase.co', anonKey: 'anon', email: 'a@b.com', password: 'secret' },
        () => null
      )
      expect(first.state).not.toBe('disabled')
      const afterFirst = await config.loadSyncConfig()
      const deviceId = afterFirst?.deviceId
      expect(deviceId).toBeTruthy()

      await engine.configure(
        { url: 'https://x.supabase.co', anonKey: 'anon', email: 'a@b.com', password: 'secret' },
        () => null
      )
      const afterSecond = await config.loadSyncConfig()
      expect(afterSecond?.deviceId).toBe(deviceId)
    })

    it('persists the session but never writes the password to sync.json', async () => {
      const { engine } = await loadModules()
      await engine.configure(
        { url: 'https://x.supabase.co', anonKey: 'anon', email: 'a@b.com', password: 'super-secret' },
        () => null
      )
      const raw = await fs.readFile(join(tmpDir, 'sync.json'), 'utf-8')
      const parsed = JSON.parse(raw)
      expect(parsed.session).toEqual({ accessToken: 'remote-at', refreshToken: 'remote-rt' })
      expect(raw).not.toContain('super-secret')
      expect(raw).not.toContain('password')
    })
  })
})

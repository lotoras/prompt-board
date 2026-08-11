import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
// `node-pty` is a native module loaded lazily inside manager.ts via a plain
// `require('node-pty')`. Vitest's `vi.mock` only intercepts statically/dynamically
// `import()`-ed specifiers, not raw `require()` calls resolved through Node's own
// module cache, so mocking the module factory-style (`vi.mock('node-pty', ...)`) is
// silently ignored here and the real native addon gets loaded. Instead we import the
// real (already-required) module object and spy on its `spawn` export directly --
// both the static `import` below and manager.ts's `require('node-pty')` resolve to
// the same singleton via Node's module cache, so the spy is visible to manager.ts too.
import * as nodePty from 'node-pty'
import { IPC_CHANNELS } from '../../src/shared/types'

const { registerPendingSpawn, preclaimSession } = vi.hoisted(() => ({
  registerPendingSpawn: vi.fn(),
  preclaimSession: vi.fn()
}))

vi.mock('../../src/main/pty/reconcile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/pty/reconcile')>()
  return {
    ...actual,
    registerPendingSpawn,
    preclaimSession
  }
})

const { assertProjectDirectory } = vi.hoisted(() => ({
  assertProjectDirectory: vi.fn(async () => {})
}))

type FakePty = {
  onData: (cb: (data: string) => void) => void
  onExit: (cb: (e: { exitCode: number }) => void) => void
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emitData: (d: string) => void
  emitExit: (code: number) => void
}

const fakePtys: FakePty[] = []

function makeFakePty(): FakePty {
  let dataCb: ((data: string) => void) | undefined
  let exitCb: ((e: { exitCode: number }) => void) | undefined
  const p: FakePty = {
    onData: (cb) => {
      dataCb = cb
    },
    onExit: (cb) => {
      exitCb = cb
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData: (d) => dataCb && dataCb(d),
    emitExit: (code) => exitCb && exitCb({ exitCode: code })
  }
  fakePtys.push(p)
  return p
}

vi.mock('../../src/main/projects/store', () => ({
  listProjects: vi.fn(async () => [
    {
      projectKey: 'proj-1',
      name: 'P',
      basePath: 'C:/tmp/proj',
      createdAt: 0,
      updatedAt: 0
    }
  ]),
  assertProjectDirectory
}))

const MAX_BUFFER = 256 * 1024

describe('pty/manager', () => {
  let mgr: typeof import('../../src/main/pty/manager')
  let sent: Array<{ channel: string; payload: unknown }>
  let win: { isDestroyed: () => boolean; webContents: { send: (channel: string, payload: unknown) => void } }
  let getWindow: () => BrowserWindow | null

  beforeEach(async () => {
    vi.resetModules()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(nodePty as any, 'spawn').mockImplementation(makeFakePty as any)
    registerPendingSpawn.mockClear()
    preclaimSession.mockClear()
    assertProjectDirectory.mockReset()
    assertProjectDirectory.mockImplementation(async () => {})
    mgr = await import('../../src/main/pty/manager')
    fakePtys.length = 0
    sent = []
    win = {
      isDestroyed: () => false,
      webContents: { send: (channel, payload) => sent.push({ channel, payload }) }
    }
    getWindow = () => win as unknown as BrowserWindow
  })

  function replay(): { channel: string; payload: { ptyId: string; data: string; replay?: boolean } } | undefined {
    return sent.find(
      (s) => s.channel === IPC_CHANNELS.pty.data && (s.payload as { replay?: boolean }).replay
    ) as { channel: string; payload: { ptyId: string; data: string; replay?: boolean } } | undefined
  }

  async function spawnFake(): Promise<{ ptyId: string; fake: (typeof fakePtys)[number] }> {
    const { ptyId } = await mgr.spawnPty(getWindow, { projectKey: 'proj-1' })
    const fake = fakePtys[fakePtys.length - 1]
    return { ptyId, fake }
  }

  describe('happy path', () => {
    it('accumulates onData chunks into the buffer', async () => {
      const { ptyId, fake } = await spawnFake()

      fake.emitData('abc')
      fake.emitData('def')
      mgr.attachPty(getWindow, ptyId)

      expect(replay()?.payload).toEqual({ ptyId, data: 'abcdef', replay: true })
    })

    it('each onData also emits a live pty.data event (no replay)', async () => {
      const { ptyId, fake } = await spawnFake()

      fake.emitData('abc')
      fake.emitData('def')

      const liveEvents = sent.filter(
        (s) => s.channel === IPC_CHANNELS.pty.data && !(s.payload as { replay?: boolean }).replay
      )
      expect(liveEvents.map((s) => s.payload)).toEqual([
        { ptyId, data: 'abc' },
        { ptyId, data: 'def' }
      ])
    })

    it('attachPty replays the full buffer on the pty.data channel with replay:true', async () => {
      const { ptyId, fake } = await spawnFake()

      fake.emitData('abc')
      fake.emitData('def')
      mgr.attachPty(getWindow, ptyId)

      const r = replay()
      expect(r?.channel).toBe(IPC_CHANNELS.pty.data)
      expect(r?.payload).toEqual({ ptyId, data: 'abcdef', replay: true })
    })
  })

  describe('edge cases', () => {
    it('caps the buffer at MAX_BUFFER, keeping the newest bytes', async () => {
      const { ptyId, fake } = await spawnFake()

      const first = 'a'.repeat(MAX_BUFFER)
      const second = 'b'.repeat(100)
      fake.emitData(first)
      fake.emitData(second)
      mgr.attachPty(getWindow, ptyId)

      const expected = (first + second).slice(-MAX_BUFFER)
      const data = replay()?.payload.data
      expect(data?.length).toBe(MAX_BUFFER)
      expect(data).toBe(expected)
    })

    it('clears the buffer on exit -> replay is empty string', async () => {
      const { ptyId, fake } = await spawnFake()

      fake.emitData('x')
      fake.emitExit(0)
      mgr.attachPty(getWindow, ptyId)

      expect(replay()?.payload.data).toBe('')
      const exitEvent = sent.find((s) => s.channel === IPC_CHANNELS.pty.exit)
      expect(exitEvent?.payload).toEqual({ ptyId, exitCode: 0 })
    })

    it('clears the buffer on kill -> replay is empty string', async () => {
      const { ptyId, fake } = await spawnFake()

      fake.emitData('x')
      mgr.killPty(ptyId)

      expect(fake.kill).toHaveBeenCalled()

      mgr.attachPty(getWindow, ptyId)
      expect(replay()?.payload.data).toBe('')
    })

    it('attachPty for an unknown pty emits replay with empty string', () => {
      mgr.attachPty(getWindow, 'nope')

      const event = sent.find((s) => s.channel === IPC_CHANNELS.pty.data)
      expect(event?.payload).toEqual({ ptyId: 'nope', data: '', replay: true })
    })

    it('attachPty is a no-op when the window is destroyed', async () => {
      const { ptyId } = await spawnFake()
      win.isDestroyed = () => true

      mgr.attachPty(getWindow, ptyId)

      expect(sent.length).toBe(0)
    })
  })

  describe('failure hardening', () => {
    it('writePty forwards data to the pty', async () => {
      const { ptyId, fake } = await spawnFake()

      mgr.writePty(ptyId, 'hi')

      expect(fake.write).toHaveBeenCalledWith('hi')
    })

    it('writePty on a missing pty does not throw', () => {
      expect(() => mgr.writePty('nope', 'x')).not.toThrow()
    })

    it('writePty does not throw when the native write throws', async () => {
      const { ptyId, fake } = await spawnFake()
      fake.write.mockImplementation(() => {
        throw new Error('dead pty')
      })

      expect(() => mgr.writePty(ptyId, 'x')).not.toThrow()
    })

    it('resizePty on a missing pty does not throw', () => {
      expect(() => mgr.resizePty('nope', 100, 40)).not.toThrow()
    })

    it('resizePty does not throw when the native resize throws', async () => {
      const { ptyId, fake } = await spawnFake()
      fake.resize.mockImplementation(() => {
        throw new Error('dead pty')
      })

      expect(() => mgr.resizePty(ptyId, 100, 40)).not.toThrow()
    })

    it('killPty on a missing pty is a no-op', () => {
      expect(() => mgr.killPty('nope')).not.toThrow()
      expect(sent.length).toBe(0)
    })

    it('spawnPty rejects when the project basePath fails validation', async () => {
      assertProjectDirectory.mockRejectedValueOnce(
        new Error('basePath does not exist: C:/tmp/proj')
      )

      await expect(mgr.spawnPty(getWindow, { projectKey: 'proj-1' })).rejects.toThrow(
        /P.*basePath does not exist: C:\/tmp\/proj/
      )
      expect(nodePty.spawn).not.toHaveBeenCalled()
    })
  })

  describe('spawn options', () => {
    it('spawns powershell with useConpty but without conptyInheritCursor', async () => {
      await spawnFake()

      const spawnMock = vi.mocked(nodePty.spawn)
      const [command, , opts] = spawnMock.mock.calls[spawnMock.mock.calls.length - 1]

      expect(command).toBe('powershell.exe')
      // Regression guard: conptyInheritCursor:true caused a stray leading 'C' in every terminal.
      expect((opts as { conptyInheritCursor?: boolean }).conptyInheritCursor).not.toBe(true)
      expect((opts as { useConpty?: boolean }).useConpty).toBe(true)
    })

    it('spawns with CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN set in the inherited env', async () => {
      await spawnFake()

      const spawnMock = vi.mocked(nodePty.spawn)
      const [, , opts] = spawnMock.mock.calls[spawnMock.mock.calls.length - 1]

      expect((opts as { env?: Record<string, string> }).env?.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN).toBe('1')
    })
  })

  describe('reconcile hooks', () => {
    it('a resume spawn preclaims the session and registers a pending spawn with the expected session id', async () => {
      await mgr.spawnPty(getWindow, { projectKey: 'proj-1', resumeSessionId: 'sess-42' })

      expect(preclaimSession).toHaveBeenCalledWith('sess-42')
      expect(registerPendingSpawn).toHaveBeenCalledWith(
        expect.any(String),
        'proj-1',
        expect.any(Number),
        'sess-42'
      )

      const spawnMock = vi.mocked(nodePty.spawn)
      const [, args] = spawnMock.mock.calls[spawnMock.mock.calls.length - 1]
      expect(args).toContain('claude --resume sess-42')
    })

    it('a fresh spawn does not preclaim and registers a pending spawn with undefined expected session id', async () => {
      await mgr.spawnPty(getWindow, { projectKey: 'proj-1' })

      expect(preclaimSession).not.toHaveBeenCalled()
      expect(registerPendingSpawn).toHaveBeenCalledWith(
        expect.any(String),
        'proj-1',
        expect.any(Number),
        undefined
      )

      const spawnMock = vi.mocked(nodePty.spawn)
      const [, args] = spawnMock.mock.calls[spawnMock.mock.calls.length - 1]
      expect(args).toContain('clauded')
    })
  })
})

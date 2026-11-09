import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
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

const { registerPendingSpawn, preclaimSession, isPendingSpawn, clearPendingSpawn, reconcileActualRef } =
  vi.hoisted(() => {
    // Holds the real (unmocked) reconcile module for the current test's module
    // generation, so tests can drive its real `registerPendingSpawn` /
    // `reconcilePendingSpawns` to populate the same pid<->session bindings map
    // that manager.ts's (merged-mock) `releasePtyBinding`/`listPtyBindings` read.
    const reconcileActualRef = {
      current: undefined as typeof import('../../src/main/pty/reconcile') | undefined
    }
    return {
      registerPendingSpawn: vi.fn(),
      preclaimSession: vi.fn(),
      isPendingSpawn: vi.fn(() => false),
      // Spy that calls through to the real implementation.
      clearPendingSpawn: vi.fn((ptyId: string) => reconcileActualRef.current!.clearPendingSpawn(ptyId)),
      reconcileActualRef
    }
  })

vi.mock('../../src/main/pty/reconcile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/pty/reconcile')>()
  reconcileActualRef.current = actual
  return {
    ...actual,
    registerPendingSpawn,
    preclaimSession,
    isPendingSpawn,
    clearPendingSpawn
  }
})

const { locateTranscript } = vi.hoisted(() => ({
  locateTranscript: vi.fn(async () => 'C:/fake/transcript.jsonl')
}))

vi.mock('../../src/main/sessions/transcript', () => ({
  locateTranscript
}))

const { assertProjectDirectory } = vi.hoisted(() => ({
  assertProjectDirectory: vi.fn(async () => {})
}))

type FakePty = {
  onData: (cb: (data: string) => void) => { dispose(): void }
  onExit: (cb: (e: { exitCode: number }) => void) => void
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emitData: (d: string) => void
  emitExit: (code: number) => void
}

const fakePtys: FakePty[] = []

function makeFakePty(): FakePty {
  const dataCbs = new Set<(data: string) => void>()
  let exitCb: ((e: { exitCode: number }) => void) | undefined
  const p: FakePty = {
    onData: (cb) => {
      dataCbs.add(cb)
      return { dispose: () => dataCbs.delete(cb) }
    },
    onExit: (cb) => {
      exitCb = cb
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData: (d) => [...dataCbs].forEach((cb) => cb(d)),
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
const MARKER = 'prompt-board: Claude failed to start'

function expectFreshCommand(command: string): void {
  expect(command).toContain('clauded;')
  expect(command).toContain(MARKER)
  expect(command).toContain('codex (')
  expect(command).toContain('-lt 30')
  expect(command).not.toContain('"')
}

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
    clearPendingSpawn.mockClear()
    isPendingSpawn.mockReset()
    isPendingSpawn.mockReturnValue(false)
    locateTranscript.mockReset()
    locateTranscript.mockImplementation(async () => 'C:/fake/transcript.jsonl')
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
      expect(exitEvent?.payload).toEqual({ ptyId, exitCode: 0, resumeFailed: false })
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

  describe('account selection', () => {
    const lastCall = (): [string, string[], { env?: Record<string, string | undefined> }] => {
      const m = vi.mocked(nodePty.spawn).mock
      return m.calls[m.calls.length - 1] as never
    }

    it('account 2 fresh spawn runs clauded2', async () => {
      await mgr.spawnPty(getWindow, { projectKey: 'proj-1', account: 2 })
      expect(lastCall()[1].slice(0, 3)).toEqual(['-NoLogo', '-NoProfile', '-Command'])
      // The fresh command wraps the launcher in the Codex startup-failure net.
      expect(lastCall()[1][3]).toContain('; clauded2; $ok=$?')
    })

    it('account 2 resume runs clauded2 --resume <id>', async () => {
      await mgr.spawnPty(getWindow, { projectKey: 'proj-1', account: 2, resumeSessionId: 'sess-9' })
      expect(lastCall()[1]).toEqual(['-NoLogo', '-NoProfile', '-Command', 'clauded2 --resume sess-9'])
    })

    it('no account and account 1 both run plain clauded, never clauded2', async () => {
      await mgr.spawnPty(getWindow, { projectKey: 'proj-1' })
      expect(lastCall()[1][3]).toContain('; clauded; $ok=$?')
      expect(lastCall()[1][3]).not.toContain('clauded2')
      await mgr.spawnPty(getWindow, { projectKey: 'proj-1', account: 1 })
      expect(lastCall()[1][3]).toContain('; clauded; $ok=$?')
      expect(lastCall()[1][3]).not.toContain('clauded2')
    })

    it('account 1 strips an inherited CLAUDE_CONFIG_DIR from the pty env', async () => {
      const prev = process.env.CLAUDE_CONFIG_DIR
      process.env.CLAUDE_CONFIG_DIR = 'C:/some/other/.claude-2'
      try {
        await mgr.spawnPty(getWindow, { projectKey: 'proj-1', account: 1 })
        expect(lastCall()[2].env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
      } finally {
        if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
        else process.env.CLAUDE_CONFIG_DIR = prev
      }
    })

    it('account 2 env still sets CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN', async () => {
      await mgr.spawnPty(getWindow, { projectKey: 'proj-1', account: 2 })
      expect(lastCall()[2].env?.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN).toBe('1')
    })

    it('passes the account as the 5th arg of registerPendingSpawn', async () => {
      await mgr.spawnPty(getWindow, { projectKey: 'proj-1', account: 2 })
      expect(registerPendingSpawn).toHaveBeenCalledWith(
        expect.any(String),
        'proj-1',
        expect.any(Number),
        undefined,
        2
      )
    })
  })

  describe('reconcile hooks', () => {
    it('a resume spawn preclaims the session and registers a pending spawn with the expected session id', async () => {
      const result = await mgr.spawnPty(getWindow, { projectKey: 'proj-1', resumeSessionId: 'sess-42' })

      expect(result).toEqual({ ptyId: expect.any(String), resumed: true })
      expect(preclaimSession).toHaveBeenCalledWith('sess-42')
      expect(registerPendingSpawn).toHaveBeenCalledWith(
        expect.any(String),
        'proj-1',
        expect.any(Number),
        'sess-42',
        1
      )

      const spawnMock = vi.mocked(nodePty.spawn)
      const [, args] = spawnMock.mock.calls[spawnMock.mock.calls.length - 1]
      expect(args).toEqual(['-NoLogo', '-NoProfile', '-Command', 'clauded --resume sess-42'])
    })

    it('a fresh spawn does not preclaim and registers a pending spawn with undefined expected session id', async () => {
      const result = await mgr.spawnPty(getWindow, { projectKey: 'proj-1' })

      expect(result).toEqual({ ptyId: expect.any(String), resumed: false })
      expect(preclaimSession).not.toHaveBeenCalled()
      expect(registerPendingSpawn).toHaveBeenCalledWith(
        expect.any(String),
        'proj-1',
        expect.any(Number),
        undefined,
        1
      )

      const spawnMock = vi.mocked(nodePty.spawn)
      const [, args] = spawnMock.mock.calls[spawnMock.mock.calls.length - 1]
      expect((args as string[]).slice(0, 3)).toEqual(['-NoLogo', '-NoProfile', '-Command'])
      expectFreshCommand((args as string[])[3])
    })
  })

  describe('resume downgrade', () => {
    it('downgrades to a fresh clauded with a notice when the transcript is missing', async () => {
      locateTranscript.mockImplementation(async () => null)

      const result = await mgr.spawnPty(getWindow, { projectKey: 'proj-1', resumeSessionId: 'sess-42' })

      expect(result).toEqual({ ptyId: expect.any(String), resumed: false })
      expect(preclaimSession).not.toHaveBeenCalled()
      expect(registerPendingSpawn).toHaveBeenCalledWith(
        expect.any(String),
        'proj-1',
        expect.any(Number),
        undefined,
        1
      )

      const spawnMock = vi.mocked(nodePty.spawn)
      const [, args] = spawnMock.mock.calls[spawnMock.mock.calls.length - 1]
      const command = (args as string[])[3]
      expect(command.startsWith("Write-Host 'prompt-board:")).toBe(true)
      expectFreshCommand(command)
    })

    it('prints the notice when freshFallback is requested even without a resume id', async () => {
      const result = await mgr.spawnPty(getWindow, { projectKey: 'proj-1', freshFallback: true })

      expect(result).toEqual({ ptyId: expect.any(String), resumed: false })

      const spawnMock = vi.mocked(nodePty.spawn)
      const [, args] = spawnMock.mock.calls[spawnMock.mock.calls.length - 1]
      const command = (args as string[])[3]
      expect(command.startsWith("Write-Host 'prompt-board:")).toBe(true)
      expectFreshCommand(command)
    })

    it('a plain spawn has no notice and starts with the clauded fallback command', async () => {
      await mgr.spawnPty(getWindow, { projectKey: 'proj-1' })

      const spawnMock = vi.mocked(nodePty.spawn)
      const [, args] = spawnMock.mock.calls[spawnMock.mock.calls.length - 1]
      const command = (args as string[])[3]
      expect(command.startsWith('Write-Host')).toBe(false)
      expect(command.startsWith('clauded') || command.startsWith('$t=Get-Date; clauded')).toBe(true)
      expectFreshCommand(command)
    })
  })

  describe('reconcile release wiring', () => {
    it('killPty and pty exit both release the pid-anchored binding via listPtyBindings()', async () => {
      const reconcileActual = reconcileActualRef.current!
      const noopWin = { isDestroyed: () => false, webContents: { send: vi.fn() } }
      const makeSession = (pid: number, sessionId: string) => ({
        pid,
        sessionId,
        cwd: 'C:/tmp/proj',
        status: 'idle' as const,
        startedAt: 1000,
        updatedAt: 1000,
        statusUpdatedAt: 1000
      })
      const makeSnapshot = (sessions: ReturnType<typeof makeSession>[]) => ({
        projects: [
          { projectKey: 'proj-1', name: 'P', source: 'auto' as const, needsAttention: false, sessions }
        ]
      })

      const { ptyId: killedPtyId } = await spawnFake()
      reconcileActual.registerPendingSpawn(killedPtyId, 'proj-1', 1000)
      reconcileActual.reconcilePendingSpawns(
        makeSnapshot([makeSession(1, 'sess-kill')]),
        () => noopWin as never
      )

      const { ptyId: exitedPtyId, fake } = await spawnFake()
      reconcileActual.registerPendingSpawn(exitedPtyId, 'proj-1', 1000)
      reconcileActual.reconcilePendingSpawns(
        makeSnapshot([makeSession(2, 'sess-exit')]),
        () => noopWin as never
      )

      expect(reconcileActual.listPtyBindings()).toEqual(
        expect.arrayContaining([
          { ptyId: killedPtyId, sessionId: 'sess-kill' },
          { ptyId: exitedPtyId, sessionId: 'sess-exit' }
        ])
      )

      mgr.killPty(killedPtyId)
      fake.emitExit(0)

      expect(reconcileActual.listPtyBindings()).toEqual([])
    })
  })

  describe('codex fallback', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    const hasPaste = (fake: FakePty): boolean =>
      fake.write.mock.calls.some((c) => typeof c[0] === 'string' && c[0].includes('\x1b[200~'))

    it('clears the pending spawn when the marker is split across two chunks (fresh spawn)', async () => {
      isPendingSpawn.mockReturnValue(true)
      const { ptyId, fake } = await spawnFake()

      fake.emitData('some output ' + MARKER.slice(0, 15))
      expect(clearPendingSpawn).not.toHaveBeenCalledWith(ptyId)
      fake.emitData(MARKER.slice(15) + ' (exit 3) - starting Codex')

      expect(clearPendingSpawn).toHaveBeenCalledWith(ptyId)
    })

    it('clears the pending spawn only once even if the marker is seen again', async () => {
      const { ptyId, fake } = await spawnFake()

      fake.emitData(MARKER)
      fake.emitData(MARKER)

      expect(clearPendingSpawn.mock.calls.filter((c) => c[0] === ptyId)).toHaveLength(1)
    })

    it('does not clear the pending spawn from the marker path for a resume spawn', async () => {
      const { ptyId } = await mgr.spawnPty(getWindow, { projectKey: 'proj-1', resumeSessionId: 'sess-42' })
      const fake = fakePtys[fakePtys.length - 1]

      fake.emitData(MARKER.slice(0, 15))
      fake.emitData(MARKER.slice(15))

      expect(clearPendingSpawn).not.toHaveBeenCalledWith(ptyId)
    })

    it('does not clear the pending spawn for unrelated output', async () => {
      const { ptyId, fake } = await spawnFake()

      fake.emitData('hello world')

      expect(clearPendingSpawn).not.toHaveBeenCalledWith(ptyId)
    })

    it('never pastes the initialQuery after the marker was seen', async () => {
      vi.useFakeTimers()
      await mgr.spawnPty(getWindow, { projectKey: 'proj-1', initialQuery: 'hello' })
      const fake = fakePtys[fakePtys.length - 1]

      fake.emitData(MARKER)
      vi.advanceTimersByTime(15000)

      expect(hasPaste(fake)).toBe(false)
    })

    it('control: without the marker the initialQuery paste is written after 10s', async () => {
      vi.useFakeTimers()
      await mgr.spawnPty(getWindow, { projectKey: 'proj-1', initialQuery: 'hello' })
      const fake = fakePtys[fakePtys.length - 1]

      vi.advanceTimersByTime(15000)

      expect(hasPaste(fake)).toBe(true)
    })

    describe('shell semantics', () => {
      let tmp: string

      beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-codex-'))
        fs.writeFileSync(path.join(tmp, 'codex.cmd'), '@echo CODEX:%*\r\n')
      })

      afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true })
      })

      async function runFresh(): Promise<string> {
        await mgr.spawnPty(getWindow, { projectKey: 'proj-1' })
        const spawnMock = vi.mocked(nodePty.spawn)
        const [, args] = spawnMock.mock.calls[spawnMock.mock.calls.length - 1]
        const sysRoot = process.env.SystemRoot!
        const r = spawnSync(
          path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          args as string[],
          {
            cwd: tmp,
            env: {
              PATH: `${tmp};${sysRoot}\\System32`,
              PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
              SystemRoot: sysRoot,
              ComSpec: process.env.ComSpec ?? path.join(sysRoot, 'System32', 'cmd.exe')
            },
            encoding: 'utf8',
            timeout: 30000
          }
        )
        return `${r.stdout ?? ''}${r.stderr ?? ''}`
      }

      it.runIf(process.platform === 'win32')(
        'clauded failing fast starts codex with the marker and exit code',
        async () => {
          fs.writeFileSync(path.join(tmp, 'clauded.cmd'), '@exit /b 3\r\n')
          const out = await runFresh()
          expect(out).toContain(MARKER)
          expect(out).toContain('exit 3')
          expect(out).toContain('CODEX:')
        },
        40000
      )

      it.runIf(process.platform === 'win32')(
        'missing clauded starts codex with command not found',
        async () => {
          const out = await runFresh()
          expect(out).toContain('command not found')
          expect(out).toContain('CODEX:')
        },
        40000
      )

      it.runIf(process.platform === 'win32')(
        'clauded exiting 0 does not start codex',
        async () => {
          fs.writeFileSync(path.join(tmp, 'clauded.cmd'), '@exit /b 0\r\n')
          const out = await runFresh()
          expect(out).not.toContain('CODEX:')
        },
        40000
      )
    })
  })

  describe('resume failure net', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('marks resumeFailed when the resume pty exits quickly while still unclaimed', async () => {
      isPendingSpawn.mockReturnValue(true)
      const { ptyId, fake } = await spawnFake2({ projectKey: 'proj-1', resumeSessionId: 'sess-42' })

      fake.emitExit(1)

      const exitEvent = sent.find((s) => s.channel === IPC_CHANNELS.pty.exit)
      expect(exitEvent?.payload).toEqual({ ptyId, exitCode: 1, resumeFailed: true })
    })

    it('does not mark resumeFailed once the pty has been claimed (isPendingSpawn false)', async () => {
      isPendingSpawn.mockReturnValue(false)
      const { ptyId, fake } = await spawnFake2({ projectKey: 'proj-1', resumeSessionId: 'sess-42' })

      fake.emitExit(1)

      const exitEvent = sent.find((s) => s.channel === IPC_CHANNELS.pty.exit)
      expect(exitEvent?.payload).toEqual({ ptyId, exitCode: 1, resumeFailed: false })
    })

    it('does not mark resumeFailed once the failure window has elapsed', async () => {
      vi.useFakeTimers()
      isPendingSpawn.mockReturnValue(true)
      const { ptyId, fake } = await spawnFake2({ projectKey: 'proj-1', resumeSessionId: 'sess-42' })

      vi.advanceTimersByTime(10001)
      fake.emitExit(1)

      const exitEvent = sent.find((s) => s.channel === IPC_CHANNELS.pty.exit)
      expect(exitEvent?.payload).toEqual({ ptyId, exitCode: 1, resumeFailed: false })
    })

    async function spawnFake2(
      input: Parameters<typeof mgr.spawnPty>[1]
    ): Promise<{ ptyId: string; fake: (typeof fakePtys)[number] }> {
      const { ptyId } = await mgr.spawnPty(getWindow, input)
      const fake = fakePtys[fakePtys.length - 1]
      return { ptyId, fake }
    }
  })
})

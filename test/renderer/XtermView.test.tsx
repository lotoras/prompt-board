// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { PtyDataEvent } from '../../src/shared/types'

const { termInstances, Terminal, FitAddon } = vi.hoisted(() => {
  const termInstances: Array<{
    write: ReturnType<typeof vi.fn>
    loadAddon: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    onData: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    hasSelection: ReturnType<typeof vi.fn>
    getSelection: ReturnType<typeof vi.fn>
    clearSelection: ReturnType<typeof vi.fn>
    paste: ReturnType<typeof vi.fn>
    attachCustomWheelEventHandler: ReturnType<typeof vi.fn>
    scrollLines: ReturnType<typeof vi.fn>
    buffer: { active: { type: string } }
    modes: { mouseTrackingMode: string; applicationCursorKeysMode: boolean }
    cols: number
    rows: number
  }> = []
  class Terminal {
    write = vi.fn()
    loadAddon = vi.fn()
    open = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
    dispose = vi.fn()
    focus = vi.fn()
    hasSelection = vi.fn(() => false)
    getSelection = vi.fn(() => '')
    clearSelection = vi.fn()
    paste = vi.fn()
    attachCustomWheelEventHandler = vi.fn()
    scrollLines = vi.fn()
    buffer = { active: { type: 'normal' } }
    modes = { mouseTrackingMode: 'none', applicationCursorKeysMode: false }
    cols = 80
    rows = 24
    constructor() {
      termInstances.push(this)
    }
  }
  class FitAddon {
    fit = vi.fn()
  }
  return { termInstances, Terminal, FitAddon }
})

vi.mock('@xterm/xterm', () => ({ Terminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon }))

const { holder, onData, onExit, attach, write } = vi.hoisted(() => {
  const holder: { data: ((payload: PtyDataEvent) => void) | null; exit: ((payload: unknown) => void) | null } = {
    data: null,
    exit: null
  }
  return {
    holder,
    onData: vi.fn((cb: (payload: PtyDataEvent) => void) => {
      holder.data = cb
      return vi.fn()
    }),
    onExit: vi.fn((cb: (payload: unknown) => void) => {
      holder.exit = cb
      return vi.fn()
    }),
    attach: vi.fn(() => Promise.resolve()),
    write: vi.fn()
  }
})

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: {
    pty: {
      onData,
      onExit,
      attach,
      write,
      resize: vi.fn(),
      getPathForFile: vi.fn(() => '')
    },
    clipboard: { writeText: vi.fn(), readText: vi.fn(async () => '') }
  }
}))

import { XtermView } from '../../src/renderer/src/features/terminal/XtermView'

describe('XtermView', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver
    write.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  describe('happy path', () => {
    it('writes the replay backlog exactly once', () => {
      render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]

      holder.data?.({ ptyId: 'pty-1', data: 'BACKLOG', replay: true })

      expect(term.write).toHaveBeenCalledTimes(1)
      expect(term.write).toHaveBeenCalledWith('BACKLOG')
    })
  })

  describe('ordering (the core of the fix)', () => {
    it('drops live data that arrives before the replay, then shows replay then live in order', () => {
      render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]

      holder.data?.({ ptyId: 'pty-1', data: 'LIVE1' })
      expect(term.write).not.toHaveBeenCalled()

      holder.data?.({ ptyId: 'pty-1', data: 'BACKLOG', replay: true })
      holder.data?.({ ptyId: 'pty-1', data: 'LIVE2' })

      expect(term.write.mock.calls.map((c: unknown[]) => c[0])).toEqual(['BACKLOG', 'LIVE2'])
    })

    it('ignores events for a different ptyId', () => {
      render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]

      holder.data?.({ ptyId: 'other', data: 'X', replay: true })

      expect(term.write).not.toHaveBeenCalled()
    })
  })

  describe('failure / lifecycle', () => {
    it('a pty.data event after unmount does not throw and is not written', () => {
      const { unmount } = render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]

      unmount()

      expect(() => holder.data?.({ ptyId: 'pty-1', data: 'AFTER', replay: true })).not.toThrow()
      expect(term.write).not.toHaveBeenCalledWith('AFTER')
    })
  })

  describe('wheel scrolling', () => {
    it('scrolls the normal buffer and consumes the event', () => {
      render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]
      const wheel = term.attachCustomWheelEventHandler.mock.calls[0][0]

      const resultDown = wheel({ deltaY: 120, deltaMode: 0 } as WheelEvent)
      expect(resultDown).toBe(false)
      expect(term.scrollLines).toHaveBeenCalledWith(3)

      const resultUp = wheel({ deltaY: -120, deltaMode: 0 } as WheelEvent)
      expect(resultUp).toBe(false)
      expect(term.scrollLines).toHaveBeenCalledWith(-3)
    })

    it('lets the alternate buffer handle the wheel event while the process is running', () => {
      render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]
      const wheel = term.attachCustomWheelEventHandler.mock.calls[0][0]
      term.buffer.active.type = 'alternate'
      term.modes.mouseTrackingMode = 'vt200'

      const result = wheel({ deltaY: 120, deltaMode: 0 } as WheelEvent)

      expect(result).toBe(true)
      expect(term.scrollLines).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
    })

    it('emulates alternate scroll with arrow sequences when the alternate buffer has no mouse tracking', () => {
      render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]
      const wheel = term.attachCustomWheelEventHandler.mock.calls[0][0]
      term.buffer.active.type = 'alternate'
      term.modes.mouseTrackingMode = 'none'

      const resultUp = wheel({ deltaY: -120, deltaMode: 0 } as WheelEvent)
      expect(resultUp).toBe(false)
      expect(write).toHaveBeenCalledWith('pty-1', '\x1b[A\x1b[A\x1b[A')

      const resultDown = wheel({ deltaY: 120, deltaMode: 0 } as WheelEvent)
      expect(resultDown).toBe(false)
      expect(write).toHaveBeenCalledWith('pty-1', '\x1b[B\x1b[B\x1b[B')

      expect(term.scrollLines).not.toHaveBeenCalled()
    })

    it('uses application cursor key sequences when applicationCursorKeysMode is set', () => {
      render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]
      const wheel = term.attachCustomWheelEventHandler.mock.calls[0][0]
      term.buffer.active.type = 'alternate'
      term.modes.mouseTrackingMode = 'none'
      term.modes.applicationCursorKeysMode = true

      const result = wheel({ deltaY: -120, deltaMode: 0 } as WheelEvent)

      expect(result).toBe(false)
      expect(term.scrollLines).not.toHaveBeenCalled()
      expect(write).toHaveBeenCalledWith('pty-1', '\x1bOA\x1bOA\x1bOA')
    })

    it('scrolls the alternate buffer once the process has exited', () => {
      render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]
      const wheel = term.attachCustomWheelEventHandler.mock.calls[0][0]
      term.buffer.active.type = 'alternate'

      holder.exit?.({ ptyId: 'pty-1', exitCode: 1 })
      const result = wheel({ deltaY: 120, deltaMode: 0 } as WheelEvent)

      expect(result).toBe(false)
      expect(term.scrollLines).toHaveBeenCalledWith(3)
    })

    it('resets terminal modes before writing the exit message', () => {
      render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]

      holder.exit?.({ ptyId: 'pty-1', exitCode: 0 })

      const calls = term.write.mock.calls.map((c: unknown[]) => c[0])
      const resetIndex = calls.indexOf('\x1b[?1049l\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l')
      const exitMsgIndex = calls.findIndex(
        (c: unknown) => typeof c === 'string' && c.includes('process exited with code 0')
      )
      expect(resetIndex).toBeGreaterThanOrEqual(0)
      expect(exitMsgIndex).toBeGreaterThan(resetIndex)
    })

    it('ignores wheel events with no vertical delta', () => {
      render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]
      const wheel = term.attachCustomWheelEventHandler.mock.calls[0][0]

      const result = wheel({ deltaY: 0, deltaMode: 0 } as WheelEvent)

      expect(result).toBe(true)
      expect(term.scrollLines).not.toHaveBeenCalled()
    })

    it('accumulates sub-line deltas instead of rounding up', () => {
      render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]
      const wheel = term.attachCustomWheelEventHandler.mock.calls[0][0]

      const resultFirst = wheel({ deltaY: 20, deltaMode: 0 } as WheelEvent)
      expect(resultFirst).toBe(false)
      expect(term.scrollLines).not.toHaveBeenCalled()

      const resultSecond = wheel({ deltaY: 20, deltaMode: 0 } as WheelEvent)
      expect(resultSecond).toBe(false)
      expect(term.scrollLines).toHaveBeenCalledTimes(1)
      expect(term.scrollLines).toHaveBeenCalledWith(1)
    })

    it('consumes page-mode deltas scaled by rows', () => {
      render(<XtermView ptyId="pty-1" visible={true} />)
      const term = termInstances[termInstances.length - 1]
      const wheel = term.attachCustomWheelEventHandler.mock.calls[0][0]

      const result = wheel({ deltaY: 1, deltaMode: 2 } as WheelEvent)

      expect(result).toBe(false)
      expect(term.scrollLines).toHaveBeenCalledWith(24)
    })
  })
})

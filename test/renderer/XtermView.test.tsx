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
    buffer: { active: { type: string } }
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
    buffer = { active: { type: 'normal' } }
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

const { holder, onData, onExit, attach } = vi.hoisted(() => {
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
    attach: vi.fn(() => Promise.resolve())
  }
})

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: {
    pty: {
      onData,
      onExit,
      attach,
      write: vi.fn(),
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
})

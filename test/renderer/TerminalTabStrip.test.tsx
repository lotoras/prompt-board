// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { TerminalMeta } from '../../src/renderer/src/store/terminalsSlice'
import type { SessionStatus } from '../../src/shared/types'

const { acknowledge } = vi.hoisted(() => ({ acknowledge: vi.fn() }))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { sessions: { acknowledge } }
}))

import { TerminalTabStrip } from '../../src/renderer/src/features/terminal/TerminalTabStrip'

const PROJECT_KEY = 'proj-1'

type StatusEntry = {
  status: SessionStatus
  waitingFor?: string
  dismissable: boolean
  sessionId: string
  statusUpdatedAt: number
}

function makeTerminal(overrides: Partial<TerminalMeta> = {}): TerminalMeta {
  return {
    ptyId: 'pty-1',
    projectKey: PROJECT_KEY,
    title: 'My Terminal',
    status: 'running',
    sessionId: 'sess-1',
    ...overrides
  }
}

describe('TerminalTabStrip', () => {
  afterEach(() => {
    cleanup()
    acknowledge.mockClear()
  })

  it('renders the unlinked placeholder dot when there is no statusByPtyId entry, and it is not clickable', () => {
    const terminal = makeTerminal({ ptyId: 'pty-unlinked' })
    const { container } = render(
      <TerminalTabStrip
        terminals={[terminal]}
        activePtyId={undefined}
        statusByPtyId={{}}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onReload={vi.fn()}
      />
    )

    const dot = container.querySelector('.terminal-tabs__status-dot--unlinked')
    expect(dot).not.toBeNull()
    expect(dot?.getAttribute('role')).toBeNull()

    fireEvent.click(dot as Element)

    expect(acknowledge).not.toHaveBeenCalled()
  })

  it('renders the interactive attention/dismissable dot for a linked dismissable session and acknowledges on click without selecting the tab', () => {
    const terminal = makeTerminal({ ptyId: 'pty-linked' })
    const statusByPtyId: Record<string, StatusEntry> = {
      'pty-linked': {
        status: 'idle',
        dismissable: true,
        sessionId: 'sess-1',
        statusUpdatedAt: 12345
      }
    }
    const onSelect = vi.fn()
    const { container } = render(
      <TerminalTabStrip
        terminals={[terminal]}
        activePtyId={undefined}
        statusByPtyId={statusByPtyId}
        onSelect={onSelect}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onReload={vi.fn()}
      />
    )

    const dot = container.querySelector('.terminal-tabs__status-dot--attention')
    expect(dot).not.toBeNull()
    expect(dot?.className).toContain('terminal-tabs__status-dot--dismissable')
    expect(dot?.getAttribute('role')).toBe('button')

    fireEvent.click(dot as Element)

    expect(acknowledge).toHaveBeenCalledWith('sess-1', 12345)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders a non-interactive busy dot for a linked non-dismissable session', () => {
    const terminal = makeTerminal({ ptyId: 'pty-busy' })
    const statusByPtyId: Record<string, StatusEntry> = {
      'pty-busy': {
        status: 'busy',
        dismissable: false,
        sessionId: 'sess-2',
        statusUpdatedAt: 999
      }
    }
    const { container } = render(
      <TerminalTabStrip
        terminals={[terminal]}
        activePtyId={undefined}
        statusByPtyId={statusByPtyId}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onReload={vi.fn()}
      />
    )

    const dot = container.querySelector('.terminal-tabs__status-dot--busy')
    expect(dot).not.toBeNull()
    expect(dot?.getAttribute('role')).toBeNull()
  })
})

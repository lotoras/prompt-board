// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TerminalMeta } from '../../src/renderer/src/store/terminalsSlice'
import { TerminalReloadMenu } from '../../src/renderer/src/features/terminal/TerminalReloadMenu'

const PROJECT_KEY = 'proj-1'

function makeTerminal(overrides: Partial<TerminalMeta> = {}): TerminalMeta {
  return {
    ptyId: 'pty-1',
    projectKey: PROJECT_KEY,
    title: 'My Terminal',
    status: 'exited',
    sessionId: 'sess-1',
    ...overrides
  }
}

describe('TerminalReloadMenu', () => {
  afterEach(() => {
    cleanup()
  })

  it('disables the Resume previous session button when there is no sessionId', () => {
    const terminal = makeTerminal({ sessionId: undefined })
    render(<TerminalReloadMenu terminal={terminal} x={0} y={0} onPick={vi.fn()} onClose={vi.fn()} />)

    const button = screen.getByText('Resume previous session').closest('button')
    expect(button?.disabled).toBe(true)
  })

  it('enables the Resume previous session button when there is a sessionId', () => {
    const terminal = makeTerminal({ sessionId: 'sess-1' })
    render(<TerminalReloadMenu terminal={terminal} x={0} y={0} onPick={vi.fn()} onClose={vi.fn()} />)

    const button = screen.getByText('Resume previous session').closest('button')
    expect(button?.disabled).toBe(false)
  })

  it('calls onPick immediately for an exited terminal, with no confirm step', () => {
    const onPick = vi.fn()
    const terminal = makeTerminal({ status: 'exited' })
    render(<TerminalReloadMenu terminal={terminal} x={0} y={0} onPick={onPick} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('Start fresh'))

    expect(onPick).toHaveBeenCalledWith('fresh')
    expect(screen.queryByText('Reload')).toBeNull()
  })

  it('shows a confirm step for a running terminal and does not call onPick yet', () => {
    const onPick = vi.fn()
    const terminal = makeTerminal({ status: 'running' })
    render(<TerminalReloadMenu terminal={terminal} x={0} y={0} onPick={onPick} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('Resume previous session'))

    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByText('Reload')).not.toBeNull()
  })

  it('calls onPick with the pending mode once the confirm is clicked', () => {
    const onPick = vi.fn()
    const terminal = makeTerminal({ status: 'running' })
    render(<TerminalReloadMenu terminal={terminal} x={0} y={0} onPick={onPick} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('Resume previous session'))
    fireEvent.click(screen.getByText('Reload'))

    expect(onPick).toHaveBeenCalledWith('resume')
  })
})

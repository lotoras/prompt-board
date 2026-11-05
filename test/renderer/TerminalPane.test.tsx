// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { sessions: { acknowledge: vi.fn(), unacknowledge: vi.fn() }, pty: { spawn } }
}))
vi.mock('../../src/renderer/src/features/terminal/XtermView', () => ({
  XtermView: () => null
}))

import { useStore } from '../../src/renderer/src/store'
import { TerminalPane } from '../../src/renderer/src/features/terminal/TerminalPane'

describe('TerminalPane', () => {
  afterEach(() => cleanup())

  it('links a terminal to a session grouped under a different project', () => {
    useStore.setState({
      terminals: {
        'pty-1': {
          ptyId: 'pty-1',
          projectKey: 'A',
          title: 't',
          status: 'running',
          sessionId: 'sess-b'
        }
      },
      activeTabByProject: { A: 'pty-1' },
      snapshot: {
        projects: [
          { projectKey: 'A', name: 'A', source: 'manual', needsAttention: false, sessions: [] },
          {
            projectKey: 'B',
            name: 'B',
            source: 'auto',
            needsAttention: true,
            sessions: [
              {
                pid: 1,
                sessionId: 'sess-b',
                cwd: 'C:\\b',
                status: 'waiting',
                startedAt: 1,
                updatedAt: 1,
                statusUpdatedAt: 9,
                acknowledged: false
              }
            ]
          }
        ]
      }
    })

    const { container } = render(<TerminalPane projectKey="A" />)

    expect(container.querySelector('.terminal-tabs__status-dot--unlinked')).toBeNull()
    const dot = container.querySelector('.terminal-tabs__status-dot--attention')
    expect(dot).not.toBeNull()
    expect(dot?.getAttribute('role')).toBe('button')
  })

  describe('new terminal account menu', () => {
    beforeEach(() => {
      spawn.mockReset()
      spawn.mockResolvedValue({ ptyId: 'new-pty' })
      useStore.setState({ terminals: {}, activeTabByProject: {} })
    })

    it('shows Claude 1 and Claude 2 options after clicking "+ New terminal"', () => {
      render(<TerminalPane projectKey="A" />)
      expect(screen.queryByRole('button', { name: 'Claude 2' })).toBeNull()

      fireEvent.click(screen.getByText('+ New terminal'))

      expect(screen.getByRole('button', { name: 'Claude 1' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Claude 2' })).toBeTruthy()
      expect(spawn).not.toHaveBeenCalled()
    })

    it('spawns with account 2, stores it on the terminal, and closes the menu', async () => {
      render(<TerminalPane projectKey="A" />)
      fireEvent.click(screen.getByText('+ New terminal'))
      fireEvent.click(screen.getByRole('button', { name: 'Claude 2' }))

      await waitFor(() => expect(useStore.getState().terminals['new-pty']).toBeDefined())
      expect(spawn).toHaveBeenCalledWith({ projectKey: 'A', account: 2 })
      expect(useStore.getState().terminals['new-pty'].account).toBe(2)
      expect(screen.queryByRole('button', { name: 'Claude 2' })).toBeNull()
    })

    it('spawns with account 1 when Claude 1 is picked', async () => {
      render(<TerminalPane projectKey="A" />)
      fireEvent.click(screen.getByText('+ New terminal'))
      fireEvent.click(screen.getByRole('button', { name: 'Claude 1' }))

      await waitFor(() => expect(spawn).toHaveBeenCalled())
      expect(spawn).toHaveBeenCalledWith({ projectKey: 'A', account: 1 })
    })
  })
})

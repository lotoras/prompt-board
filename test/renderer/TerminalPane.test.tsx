// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { sessions: { acknowledge: vi.fn(), unacknowledge: vi.fn() }, pty: { spawn: vi.fn() } }
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
})

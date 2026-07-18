import { describe, expect, it } from 'vitest'
import { buildPersistedSnapshot } from '../../src/renderer/src/features/terminal/persistedSnapshot'
import type { TerminalMeta } from '../../src/renderer/src/store/terminalsSlice'

function makeTerminal(overrides: Partial<TerminalMeta> = {}): TerminalMeta {
  return {
    ptyId: 'pty-1',
    projectKey: 'proj-1',
    title: 'Terminal',
    status: 'running',
    sessionId: 'sid-1',
    ...overrides
  }
}

describe('buildPersistedSnapshot', () => {
  describe('happy path', () => {
    it('preserves tab (insertion) order of surviving terminals', () => {
      const terminals: Record<string, TerminalMeta> = {
        'pty-2': makeTerminal({ ptyId: 'pty-2', sessionId: 'sid-2', title: 'Second' }),
        'pty-1': makeTerminal({ ptyId: 'pty-1', sessionId: 'sid-1', title: 'First' })
      }

      const result = buildPersistedSnapshot(terminals, {})
      expect(result.terminals).toEqual([
        { projectKey: 'proj-1', sessionId: 'sid-2', title: 'Second' },
        { projectKey: 'proj-1', sessionId: 'sid-1', title: 'First' }
      ])
    })

    it('maps the active ptyId per project to the surviving terminal sessionId', () => {
      const terminals: Record<string, TerminalMeta> = {
        'pty-1': makeTerminal({ ptyId: 'pty-1', projectKey: 'proj-1', sessionId: 'sid-1' }),
        'pty-2': makeTerminal({ ptyId: 'pty-2', projectKey: 'proj-2', sessionId: 'sid-2' })
      }

      const result = buildPersistedSnapshot(terminals, {
        'proj-1': 'pty-1',
        'proj-2': 'pty-2'
      })

      expect(result.activeSessionByProject).toEqual({
        'proj-1': 'sid-1',
        'proj-2': 'sid-2'
      })
    })
  })

  describe('edge cases / failure', () => {
    it('filters out exited terminals and ones without a sessionId', () => {
      const terminals: Record<string, TerminalMeta> = {
        'pty-1': makeTerminal({ ptyId: 'pty-1', status: 'exited', sessionId: 'sid-1' }),
        'pty-2': makeTerminal({ ptyId: 'pty-2', status: 'running', sessionId: undefined }),
        'pty-3': makeTerminal({ ptyId: 'pty-3', status: 'running', sessionId: 'sid-3' })
      }

      const result = buildPersistedSnapshot(terminals, {})
      expect(result.terminals).toEqual([
        { projectKey: 'proj-1', sessionId: 'sid-3', title: 'Terminal' }
      ])
    })

    it('omits a project from activeSessionByProject when its active terminal did not survive', () => {
      const terminals: Record<string, TerminalMeta> = {
        'pty-1': makeTerminal({ ptyId: 'pty-1', projectKey: 'proj-1', status: 'exited' })
      }

      const result = buildPersistedSnapshot(terminals, { 'proj-1': 'pty-1' })
      expect(result.activeSessionByProject).toEqual({})
    })
  })
})

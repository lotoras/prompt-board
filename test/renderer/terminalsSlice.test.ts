// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/renderer/src/lib/api', () => ({ api: { sessions: {} } }))

import { useStore } from '../../src/renderer/src/store'

describe('terminalsSlice setSession buffering', () => {
  beforeEach(() => {
    useStore.setState({ terminals: {}, activeTabByProject: {} })
  })

  it('applies a setSession received before addTerminal', () => {
    useStore.getState().setSession('pty-early', 'sess-early')
    expect(useStore.getState().terminals['pty-early']).toBeUndefined()

    useStore
      .getState()
      .addTerminal({ ptyId: 'pty-early', projectKey: 'p', title: '', status: 'running' })

    expect(useStore.getState().terminals['pty-early'].sessionId).toBe('sess-early')
  })

  it('does not override a sessionId already set on the meta', () => {
    useStore.getState().setSession('pty-x', 'buffered')
    useStore.getState().addTerminal({
      ptyId: 'pty-x',
      projectKey: 'p',
      title: '',
      status: 'running',
      sessionId: 'explicit'
    })
    expect(useStore.getState().terminals['pty-x'].sessionId).toBe('explicit')
  })
})

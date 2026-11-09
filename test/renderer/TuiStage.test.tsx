// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeChat } from './chatFixtures'

const { chat, pty } = vi.hoisted(() => ({
  chat: { openInTui: vi.fn(), setActive: vi.fn(), update: vi.fn() },
  pty: { kill: vi.fn(), onExit: vi.fn() }
}))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { chat, pty, git: { branches: vi.fn().mockResolvedValue(['main']) } }
}))
vi.mock('../../src/renderer/src/features/terminal/XtermView', () => ({
  XtermView: ({ ptyId }: { ptyId: string }) => <div data-testid={`xterm-${ptyId}`} />
}))

import { TuiStage } from '../../src/renderer/src/features/terminal/TuiStage'
import { WorkspaceBar } from '../../src/renderer/src/features/chat/WorkspaceBar'
import { useStore } from '../../src/renderer/src/store'
import type { ChatMeta } from '../../src/shared/types'

function seed(c: ChatMeta, ptyId: string | null = 'pty-1'): void {
  useStore.setState({
    view: { kind: 'project', projectKey: c.projectKey },
    chats: [c],
    items: {},
    activeByProject: { [c.projectKey]: c.chatId },
    tuiPtyByChat: ptyId ? { [c.chatId]: ptyId } : {},
    drafts: {}
  } as never)
}

beforeEach(() => {
  chat.openInTui.mockResolvedValue({ ptyId: 'pty-1' })
  chat.setActive.mockResolvedValue(undefined)
  pty.kill.mockResolvedValue(undefined)
  pty.onExit.mockReturnValue(() => {})
})

afterEach(() => {
  cleanup()
  Object.values(chat).forEach((f) => f.mockReset())
  Object.values(pty).forEach((f) => f.mockReset())
})

describe('TuiStage', () => {
  it('shows Back to chat for a chat in TUI mode', () => {
    seed(makeChat({ mode: 'tui' }))
    render(<TuiStage />)
    expect(screen.getByRole('button', { name: 'Back to chat' })).toBeTruthy()
  })

  it('shows no Back to chat when no chat is in TUI mode', () => {
    seed(makeChat({ mode: 'sdk' }), null)
    render(<TuiStage />)
    expect(screen.queryByRole('button', { name: 'Back to chat' })).toBeNull()
  })

  it('Back to chat kills the pty when the chat is not busy', async () => {
    seed(makeChat({ mode: 'tui', status: 'idle' }))
    render(<TuiStage />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }))
    await waitFor(() => expect(pty.kill).toHaveBeenCalledWith('pty-1'))
    expect(useStore.getState().tuiPtyByChat['chat-1']).toBeUndefined()
  })

  it('asks first when busy and kills only after Stop and go back', async () => {
    seed(makeChat({ mode: 'tui', status: 'busy' }))
    render(<TuiStage />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }))
    expect(screen.getByText('Claude is working. Stop and go back?')).toBeTruthy()
    expect(pty.kill).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop and go back' }))
    await waitFor(() => expect(pty.kill).toHaveBeenCalledWith('pty-1'))
  })
})

describe('store: TUI actions', () => {
  it('openInTui records the pty and does not open the drawer', async () => {
    seed(makeChat(), null)
    useStore.setState({ drawerOpen: false })
    await useStore.getState().openInTui('chat-1')
    expect(useStore.getState().tuiPtyByChat['chat-1']).toBe('pty-1')
    expect(useStore.getState().drawerOpen).toBe(false)
  })

  it('backToChat kills the pty and removes the entry', async () => {
    seed(makeChat({ mode: 'tui' }))
    await useStore.getState().backToChat('chat-1')
    expect(pty.kill).toHaveBeenCalledWith('pty-1')
    expect(useStore.getState().tuiPtyByChat['chat-1']).toBeUndefined()
  })
})

describe('WorkspaceBar Terminal button', () => {
  it('calls openInTui for an sdk chat', async () => {
    const c = makeChat({ mode: 'sdk' })
    seed(c, null)
    render(<WorkspaceBar chat={c} />)
    fireEvent.click(screen.getByRole('button', { name: /Terminal/ }))
    await waitFor(() => expect(chat.openInTui).toHaveBeenCalledWith('chat-1'))
  })

  it('is absent for an external chat', () => {
    const c = makeChat({ mode: 'external' })
    seed(c, null)
    render(<WorkspaceBar chat={c} />)
    expect(screen.queryByRole('button', { name: /Terminal/ })).toBeNull()
  })
})

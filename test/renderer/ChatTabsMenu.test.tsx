// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeChat, user } from './chatFixtures'

const { chat, sessions } = vi.hoisted(() => ({
  chat: {
    close: vi.fn(),
    create: vi.fn(),
    setActive: vi.fn(),
    history: vi.fn(),
    restart: vi.fn(),
    openInTui: vi.fn(),
    listSessions: vi.fn()
  },
  sessions: { acknowledge: vi.fn(), unacknowledge: vi.fn() }
}))

vi.mock('../../src/renderer/src/lib/api', () => ({ api: { chat, sessions } }))

import { ChatTabs } from '../../src/renderer/src/features/chat/ChatTabs'
import { useStore } from '../../src/renderer/src/store'
import type { ChatMeta } from '../../src/shared/types'

function seed(chats: ChatMeta[]): void {
  useStore.setState({
    chats,
    items: { c1: [user('u1')] },
    drafts: {
      c1: {
        text: 'half typed',
        attachments: [],
        workspace: { newWorktree: false, newBranch: false },
        branchTouched: false,
        nameTouched: false
      }
    },
    activeByProject: {}
  })
}

const openMenu = (title: string): void => {
  fireEvent.contextMenu(screen.getByText(title))
}
const item = (name: string): HTMLElement => screen.getByRole('menuitem', { name })

beforeEach(() => {
  chat.close.mockResolvedValue(undefined)
  chat.setActive.mockResolvedValue(undefined)
  chat.history.mockResolvedValue([])
  chat.restart.mockResolvedValue(undefined)
  chat.openInTui.mockResolvedValue({ ptyId: 'pty-1' })
  chat.listSessions.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  Object.values(chat).forEach((f) => f.mockReset())
  Object.values(sessions).forEach((f) => f.mockReset())
})

describe('ChatTabs context menu', () => {
  it('right-click opens a menu with the four entries', () => {
    seed([makeChat({ chatId: 'c1', title: 'First' })])
    render(<ChatTabs projectKey="proj-1" />)
    openMenu('First')
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual([
      'Reload session',
      'Start fresh in this tab',
      'Open in TUI',
      'Close tab'
    ])
  })

  it('Reload session restarts with resume', () => {
    seed([makeChat({ chatId: 'c1', title: 'First' })])
    render(<ChatTabs projectKey="proj-1" />)
    openMenu('First')
    fireEvent.click(item('Reload session'))
    expect(chat.restart).toHaveBeenCalledWith('c1', 'resume')
  })

  it('Start fresh restarts fresh and clears the items and draft in the store', async () => {
    seed([makeChat({ chatId: 'c1', title: 'First' })])
    render(<ChatTabs projectKey="proj-1" />)
    openMenu('First')
    fireEvent.click(item('Start fresh in this tab'))
    expect(chat.restart).toHaveBeenCalledWith('c1', 'fresh')
    await waitFor(() => expect(useStore.getState().items['c1'] ?? []).toEqual([]))
    expect(useStore.getState().drafts['c1']?.text ?? '').toBe('')
  })

  it('Open in TUI calls openInTui', async () => {
    seed([makeChat({ chatId: 'c1', title: 'First' })])
    render(<ChatTabs projectKey="proj-1" />)
    openMenu('First')
    fireEvent.click(item('Open in TUI'))
    await waitFor(() => expect(chat.openInTui).toHaveBeenCalledWith('c1'))
  })

  it('Close tab closes the chat', () => {
    seed([makeChat({ chatId: 'c1', title: 'First' })])
    render(<ChatTabs projectKey="proj-1" />)
    openMenu('First')
    fireEvent.click(item('Close tab'))
    expect(chat.close).toHaveBeenCalledWith('c1')
  })

  it('an external tab menu offers only Close tab', () => {
    seed([makeChat({ chatId: 'c1', title: 'Outside', mode: 'external' })])
    render(<ChatTabs projectKey="proj-1" />)
    openMenu('Outside')
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual(['Close tab'])
  })
})

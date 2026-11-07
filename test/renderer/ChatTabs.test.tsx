// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeChat } from './chatFixtures'

const { chat, sessions } = vi.hoisted(() => ({
  chat: {
    close: vi.fn(),
    create: vi.fn(),
    setActive: vi.fn(),
    history: vi.fn()
  },
  sessions: { acknowledge: vi.fn(), unacknowledge: vi.fn() }
}))

vi.mock('../../src/renderer/src/lib/api', () => ({ api: { chat, sessions } }))

import { ChatTabs } from '../../src/renderer/src/features/chat/ChatTabs'
import { useStore } from '../../src/renderer/src/store'
import type { ChatMeta } from '../../src/shared/types'

function seed(chats: ChatMeta[], active?: string): void {
  useStore.setState({
    chats,
    items: {},
    drafts: {},
    activeByProject: active ? { 'proj-1': active } : {}
  })
}

beforeEach(() => {
  chat.close.mockResolvedValue(undefined)
  chat.setActive.mockResolvedValue(undefined)
  chat.history.mockResolvedValue([])
  chat.create.mockResolvedValue({ chat: makeChat({ chatId: 'new-1', title: 'New chat' }) })
  sessions.acknowledge.mockResolvedValue(undefined)
  sessions.unacknowledge.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  Object.values(chat).forEach((f) => f.mockReset())
  Object.values(sessions).forEach((f) => f.mockReset())
})

describe('ChatTabs', () => {
  it('renders the pinned Board tab and one tab per chat of the project', () => {
    seed([
      makeChat({ chatId: 'c1', title: 'First' }),
      makeChat({ chatId: 'c2', title: 'Second' }),
      makeChat({ chatId: 'c3', title: 'Other project', projectKey: 'proj-2' })
    ])
    render(<ChatTabs projectKey="proj-1" />)
    expect(screen.getByText('Board')).toBeTruthy()
    expect(screen.getByText('First')).toBeTruthy()
    expect(screen.getByText('Second')).toBeTruthy()
    expect(screen.queryByText('Other project')).toBeNull()
  })

  it('selecting the Board tab activates it', () => {
    seed([makeChat({ chatId: 'c1', title: 'First' })], 'c1')
    render(<ChatTabs projectKey="proj-1" />)
    fireEvent.click(screen.getByText('Board'))
    expect(chat.setActive).toHaveBeenCalledWith('proj-1', 'board')
  })

  it('selecting a chat tab activates it', () => {
    seed([makeChat({ chatId: 'c1', title: 'First' })], 'board')
    render(<ChatTabs projectKey="proj-1" />)
    fireEvent.click(screen.getByText('First'))
    expect(chat.setActive).toHaveBeenCalledWith('proj-1', 'c1')
  })

  it('the close button closes that chat', () => {
    seed([
      makeChat({ chatId: 'c1', title: 'First' }),
      makeChat({ chatId: 'c2', title: 'Second' })
    ])
    render(<ChatTabs projectKey="proj-1" />)
    fireEvent.click(screen.getAllByLabelText('Close chat')[1])
    expect(chat.close).toHaveBeenCalledWith('c2')
  })

  it('the + button creates a chat for the project', async () => {
    seed([])
    render(<ChatTabs projectKey="proj-1" />)
    fireEvent.click(screen.getByLabelText('New chat'))
    await waitFor(() => expect(chat.create).toHaveBeenCalledTimes(1))
    expect(chat.create).toHaveBeenCalledWith({ projectKey: 'proj-1' })
  })

  it('maps chat status to the dot tone', () => {
    seed([
      makeChat({ chatId: 'c1', title: 'Busy', status: 'busy' }),
      makeChat({ chatId: 'c2', title: 'Waiting', status: 'waiting', acknowledged: false }),
      makeChat({ chatId: 'c3', title: 'Idle', status: 'idle', acknowledged: true })
    ])
    const { container } = render(<ChatTabs projectKey="proj-1" />)
    expect(container.querySelectorAll('.dot.busy')).toHaveLength(1)
    expect(container.querySelectorAll('.dot.attention')).toHaveLength(1)
    expect(container.querySelectorAll('.dot.idle')).toHaveLength(1)
  })

  it('clicking the dot of a waiting chat acknowledges its session', () => {
    seed([
      makeChat({
        chatId: 'c1',
        sessionId: 'sess-w',
        status: 'waiting',
        acknowledged: false,
        statusUpdatedAt: 4242
      })
    ])
    const { container } = render(<ChatTabs projectKey="proj-1" />)
    fireEvent.click(container.querySelector('.dot.attention') as Element)
    expect(sessions.acknowledge).toHaveBeenCalledWith('sess-w', 4242)
  })

  it('clicking the dot of an acknowledged chat un-acknowledges it', () => {
    seed([
      makeChat({
        chatId: 'c1',
        sessionId: 'sess-a',
        status: 'idle',
        acknowledged: true,
        statusUpdatedAt: 1
      })
    ])
    const { container } = render(<ChatTabs projectKey="proj-1" />)
    fireEvent.click(container.querySelector('.dot.idle') as Element)
    expect(sessions.unacknowledge).toHaveBeenCalledWith('sess-a')
  })

  it('clicking the dot does not switch tabs', () => {
    seed(
      [makeChat({ chatId: 'c1', status: 'waiting', acknowledged: false, statusUpdatedAt: 1 })],
      'board'
    )
    const { container } = render(<ChatTabs projectKey="proj-1" />)
    fireEvent.click(container.querySelector('.dot.attention') as Element)
    expect(chat.setActive).not.toHaveBeenCalled()
  })

  it('lists external chats as tabs', () => {
    seed([makeChat({ chatId: 'ext:s9', sessionId: 's9', mode: 'external', title: 'Outside' })])
    render(<ChatTabs projectKey="proj-1" />)
    expect(screen.getByText('Outside')).toBeTruthy()
  })
})

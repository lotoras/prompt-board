// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeChat } from './chatFixtures'

const { chat, sessions } = vi.hoisted(() => ({
  chat: {
    close: vi.fn(),
    create: vi.fn(),
    setActive: vi.fn(),
    history: vi.fn(),
    listSessions: vi.fn()
  },
  sessions: { acknowledge: vi.fn(), unacknowledge: vi.fn() }
}))

vi.mock('../../src/renderer/src/lib/api', () => ({ api: { chat, sessions } }))

import { ChatTabs } from '../../src/renderer/src/features/chat/ChatTabs'
import { useStore } from '../../src/renderer/src/store'
import type { PastSession } from '../../src/shared/types'

const session = (extra: Partial<PastSession>): PastSession => ({
  sessionId: 's-1',
  title: 'Fix the login bug',
  firstPrompt: 'the login form throws on submit',
  lastActivity: Date.now() - 3600_000,
  cwd: 'C:\\work\\proj-1',
  model: 'claude-opus-4-8',
  ...extra
})

const SESSIONS: PastSession[] = [
  session({ sessionId: 's-1' }),
  session({
    sessionId: 's-2',
    title: 'Refactor store',
    firstPrompt: 'split the kanban slice',
    worktreeRel: '.claude/worktrees/refactor',
    openChatId: 'c1'
  })
]

const realCreate = useStore.getState().createChat
let createSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  createSpy = vi.fn().mockResolvedValue(undefined)
  useStore.setState({
    chats: [makeChat({ chatId: 'c1', title: 'Open one' })],
    items: {},
    drafts: {},
    activeByProject: {},
    createChat: createSpy
  } as never)
  chat.setActive.mockResolvedValue(undefined)
  chat.history.mockResolvedValue([])
  chat.listSessions.mockResolvedValue(SESSIONS)
})

afterEach(() => {
  cleanup()
  useStore.setState({ createChat: realCreate } as never)
  Object.values(chat).forEach((f) => f.mockReset())
  Object.values(sessions).forEach((f) => f.mockReset())
})

const openPicker = async (): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name: 'Resume a session' }))
  await screen.findByText('Fix the login bug')
}

describe('Resume picker', () => {
  it('loads the project sessions when opened and shows title, first prompt and badges', async () => {
    render(<ChatTabs projectKey="proj-1" />)
    expect(chat.listSessions).not.toHaveBeenCalled()
    await openPicker()
    expect(chat.listSessions).toHaveBeenCalledWith('proj-1')
    expect(screen.getByText('the login form throws on submit')).toBeTruthy()
    expect(screen.getByText('Refactor store')).toBeTruthy()
    expect(screen.getByText('open')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search sessions')).toBeTruthy()
  })

  it('search filters by title', async () => {
    render(<ChatTabs projectKey="proj-1" />)
    await openPicker()
    fireEvent.change(screen.getByPlaceholderText('Search sessions'), { target: { value: 'REFACTOR' } })
    expect(screen.queryByText('Fix the login bug')).toBeNull()
    expect(screen.getByText('Refactor store')).toBeTruthy()
  })

  it('search filters by first prompt', async () => {
    render(<ChatTabs projectKey="proj-1" />)
    await openPicker()
    fireEvent.change(screen.getByPlaceholderText('Search sessions'), { target: { value: 'kanban' } })
    expect(screen.queryByText('Fix the login bug')).toBeNull()
    expect(screen.getByText('Refactor store')).toBeTruthy()
  })

  it('clicking a session creates a chat that resumes it', async () => {
    render(<ChatTabs projectKey="proj-1" />)
    await openPicker()
    fireEvent.click(screen.getByText('Fix the login bug'))
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
    expect(createSpy).toHaveBeenCalledWith({
      projectKey: 'proj-1',
      resumeSessionId: 's-1',
      title: 'Fix the login bug'
    })
  })

  it('shows the empty state when there are no past sessions', async () => {
    chat.listSessions.mockResolvedValue([])
    render(<ChatTabs projectKey="proj-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume a session' }))
    expect(await screen.findByText('No past sessions for this project yet.')).toBeTruthy()
  })
})

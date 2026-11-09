// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeChat } from './chatFixtures'

const { chat, branches } = vi.hoisted(() => ({
  chat: { setActive: vi.fn(), update: vi.fn(), close: vi.fn(), create: vi.fn(), history: vi.fn() },
  branches: vi.fn()
}))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { git: { branches }, chat, pty: {}, sessions: { acknowledge: vi.fn(), unacknowledge: vi.fn() } }
}))

import { WorkspaceBar } from '../../src/renderer/src/features/chat/WorkspaceBar'
import { ChatTabs } from '../../src/renderer/src/features/chat/ChatTabs'
import { RateMeters } from '../../src/renderer/src/features/projects/RateMeters'
import { useStore } from '../../src/renderer/src/store'
import type { AccountInfo, ChatMeta } from '../../src/shared/types'

const BOTH: AccountInfo[] = [
  { id: 1, label: 'Claude 1', available: true },
  { id: 2, label: 'Claude 2', available: true }
]
const ONLY_ONE: AccountInfo[] = [
  { id: 1, label: 'Claude 1', available: true },
  { id: 2, label: 'Claude 2', available: false }
]

function seed(c: ChatMeta, accounts: AccountInfo[] = BOTH): void {
  useStore.setState({
    chats: [c],
    items: {},
    accounts,
    activeByProject: {},
    drafts: {
      [c.chatId]: {
        text: '',
        attachments: [],
        workspace: { newWorktree: false, newBranch: false },
        branchTouched: false,
        nameTouched: false
      }
    }
  } as never)
}

beforeEach(() => {
  branches.mockResolvedValue(['main'])
  chat.update.mockImplementation(async () => makeChat({ started: false, account: 2 }))
  chat.setActive.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  branches.mockReset()
  Object.values(chat).forEach((f) => f.mockReset())
})

describe('Claude account picker', () => {
  it('chooses the account of a draft', async () => {
    const c = makeChat({ started: false, branch: 'main' })
    seed(c)
    render(<WorkspaceBar chat={c} />)
    fireEvent.click(screen.getByRole('button', { name: /Claude account/ }))
    fireEvent.click(screen.getByText('Claude 2'))
    await waitFor(() => expect(chat.update).toHaveBeenCalledWith(c.chatId, { account: 2 }))
  })

  it('greys out an account that is not set up on this device', () => {
    const c = makeChat({ started: false, branch: 'main' })
    seed(c, ONLY_ONE)
    render(<WorkspaceBar chat={c} />)
    fireEvent.click(screen.getByRole('button', { name: /Claude account/ }))
    expect(screen.getByText(/not set up on this device/i)).toBeTruthy()
    fireEvent.click(screen.getByText('Claude 2'))
    expect(chat.update).not.toHaveBeenCalled()
  })

  it('has no picker once the chat has started, and names Claude 2', () => {
    const c = makeChat({ started: true, branch: 'main', account: 2 })
    seed(c)
    render(<WorkspaceBar chat={c} />)
    expect(screen.queryByRole('button', { name: /Claude account/ })).toBeNull()
    expect(screen.getByText('Claude 2')).toBeTruthy()
  })

  it('does not label a started Claude 1 chat', () => {
    const c = makeChat({ started: true, branch: 'main', account: 1 })
    seed(c)
    render(<WorkspaceBar chat={c} />)
    expect(screen.queryByText('Claude 1')).toBeNull()
  })

  it('marks Claude 2 chats on their tab', () => {
    seed(makeChat({ chatId: 'c2', title: 'Second', account: 2 }))
    render(<ChatTabs projectKey="proj-1" />)
    expect(screen.getByTitle('Claude 2')).toBeTruthy()
  })

  it('shows the rate limits of both accounts', () => {
    useStore.setState({
      rateLimits: {
        available: true,
        updatedAt: 1,
        windows: [{ id: 'seven_day', pct: 30 }],
        second: { available: true, updatedAt: 1, windows: [{ id: 'seven_day', pct: 80 }] }
      }
    } as never)
    render(<RateMeters />)
    expect(screen.getByRole('meter', { name: '7d usage' }).getAttribute('aria-valuenow')).toBe('30')
    expect(screen.getByRole('meter', { name: 'Claude 2 7d usage' }).getAttribute('aria-valuenow')).toBe('80')
  })
})

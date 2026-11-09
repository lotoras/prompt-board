// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeChat } from './chatFixtures'

const { chat, sessions } = vi.hoisted(() => ({
  chat: { close: vi.fn(), create: vi.fn(), setActive: vi.fn(), history: vi.fn(), listSessions: vi.fn() },
  sessions: { acknowledge: vi.fn(), unacknowledge: vi.fn() }
}))

vi.mock('../../src/renderer/src/lib/api', () => ({ api: { chat, sessions } }))

import { ChatTabs } from '../../src/renderer/src/features/chat/ChatTabs'
import { useStore } from '../../src/renderer/src/store'
import type { PastSession } from '../../src/shared/types'

const page = (from: number, count: number): PastSession[] =>
  Array.from({ length: count }, (_, i) => ({
    sessionId: `s-${from + i}`,
    title: `Session ${from + i}`,
    firstPrompt: `prompt ${from + i}`,
    lastActivity: 1,
    cwd: 'C:\\work\\p1'
  }))

/** Pretend the list is scrolled to its end, then fire the scroll event. */
function scrollToEnd(): void {
  const list = document.querySelector('.resume-list') as HTMLElement
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 400 })
  Object.defineProperty(list, 'scrollTop', { configurable: true, value: 600 })
  fireEvent.scroll(list)
}

const items = (): number => document.querySelectorAll('.resume-list .pop-item').length

beforeEach(() => {
  useStore.setState({ chats: [makeChat({ chatId: 'c1' })], items: {}, drafts: {}, activeByProject: {} } as never)
  chat.setActive.mockResolvedValue(undefined)
  chat.history.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  Object.values(chat).forEach((f) => f.mockReset())
})

async function open(): Promise<void> {
  render(<ChatTabs projectKey="proj-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Resume a session' }))
  await screen.findByText('Session 0')
}

describe('Resume picker paging', () => {
  it('loads the next page when the list is scrolled to its end', async () => {
    chat.listSessions.mockResolvedValueOnce(page(0, 50)).mockResolvedValueOnce(page(50, 7))
    await open()
    expect(items()).toBe(50)
    scrollToEnd()
    await screen.findByText('Session 56')
    expect(chat.listSessions).toHaveBeenLastCalledWith('proj-1', { offset: 50 })
    expect(items()).toBe(57)
  })

  it('stops asking after a short page', async () => {
    chat.listSessions.mockResolvedValueOnce(page(0, 12))
    await open()
    scrollToEnd()
    await new Promise((r) => setTimeout(r, 20))
    expect(chat.listSessions).toHaveBeenCalledTimes(1)
  })

  it('does not list a session twice when pages overlap', async () => {
    chat.listSessions.mockResolvedValueOnce(page(0, 50)).mockResolvedValueOnce(page(49, 3))
    await open()
    scrollToEnd()
    await screen.findByText('Session 51')
    expect(items()).toBe(52)
  })

  it('a search also finds sessions that were not loaded yet', async () => {
    chat.listSessions.mockResolvedValueOnce(page(0, 50)).mockResolvedValueOnce(page(50, 5))
    await open()
    fireEvent.change(screen.getByPlaceholderText('Search sessions'), { target: { value: 'Session 53' } })
    await screen.findByText('Session 53')
    await waitFor(() => expect(items()).toBe(1))
  })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeChat } from './chatFixtures'

const { chat } = vi.hoisted(() => ({
  chat: { takeOver: vi.fn(), setActive: vi.fn(), history: vi.fn() }
}))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { chat, attachments: {}, pty: {}, git: { branches: vi.fn().mockResolvedValue(['main']) } }
}))

import { Composer } from '../../src/renderer/src/features/chat/Composer'
import { useStore } from '../../src/renderer/src/store'
import type { ChatMeta } from '../../src/shared/types'

function seed(c: ChatMeta): void {
  useStore.setState({ chats: [c], items: {}, drafts: {}, activeByProject: {} })
}

const EXTERNAL = { chatId: 'ext:s9', sessionId: 's9', mode: 'external' as const }

beforeEach(() => {
  chat.takeOver.mockResolvedValue(makeChat({ chatId: 'c-new', projectKey: 'p1', sessionId: 's9', mode: 'sdk' }))
  chat.setActive.mockResolvedValue(undefined)
  chat.history.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  Object.values(chat).forEach((f) => f.mockReset())
})

describe('Composer: continue a session that runs elsewhere', () => {
  it('takes over an idle session with one click and activates the new chat', async () => {
    const c = makeChat({ ...EXTERNAL, status: 'idle', projectKey: 'p1' })
    seed(c)
    render(<Composer chat={c} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue here' }))
    await waitFor(() => expect(chat.takeOver).toHaveBeenCalledWith('ext:s9'))
    await waitFor(() => expect(useStore.getState().activeByProject['p1']).toBe('c-new'))
  })

  it('asks for a second click while Claude is working there', () => {
    const c = makeChat({ ...EXTERNAL, status: 'busy' })
    seed(c)
    render(<Composer chat={c} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue here' }))
    expect(chat.takeOver).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop it and continue here' }))
    expect(chat.takeOver).toHaveBeenCalledWith('ext:s9')
  })

  it('shows the error and lets the user retry when stopping fails', async () => {
    chat.takeOver.mockRejectedValueOnce(new Error('Could not stop the other session'))
    const c = makeChat({ ...EXTERNAL, status: 'idle' })
    seed(c)
    render(<Composer chat={c} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue here' }))
    await screen.findByText(/could not stop the other session/i)
    expect((screen.getByRole('button', { name: 'Continue here' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('offers no takeover for a chat that runs in the terminal drawer', () => {
    const c = makeChat({ chatId: 'c1', mode: 'tui' })
    seed(c)
    render(<Composer chat={c} />)
    expect(screen.queryByRole('button', { name: 'Continue here' })).toBeNull()
  })
})

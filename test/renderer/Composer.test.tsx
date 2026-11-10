// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeAttachment, makeChat } from './chatFixtures'

const { chat, attachments, pty } = vi.hoisted(() => ({
  chat: {
    update: vi.fn(),
    send: vi.fn(),
    interrupt: vi.fn(),
    setActive: vi.fn()
  },
  attachments: { pick: vi.fn(), describe: vi.fn(), saveImage: vi.fn() },
  pty: { getPathForFile: vi.fn() }
}))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { chat, attachments, pty, git: { branches: vi.fn().mockResolvedValue(['main']) } }
}))

import { Composer } from '../../src/renderer/src/features/chat/Composer'
import { useStore } from '../../src/renderer/src/store'
import type { ChatMeta } from '../../src/shared/types'

const WORKSPACE = { newWorktree: false, newBranch: false }

function seed(c: ChatMeta, draft: { text?: string; attachments?: ReturnType<typeof makeAttachment>[] } = {}): void {
  useStore.setState({
    chats: [c],
    items: {},
    drafts: {
      [c.chatId]: {
        text: draft.text ?? '',
        attachments: draft.attachments ?? [],
        workspace: WORKSPACE,
        branchTouched: false,
        nameTouched: false
      }
    }
  })
}

beforeEach(() => {
  chat.update.mockImplementation(async () => makeChat())
  chat.send.mockResolvedValue(undefined)
  chat.interrupt.mockResolvedValue(undefined)
  chat.setActive.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  Object.values(chat).forEach((f) => f.mockReset())
  Object.values(attachments).forEach((f) => f.mockReset())
  pty.getPathForFile.mockReset()
})

describe('Composer', () => {
  it('shows the model label and updates the chat when a model is chosen', () => {
    const c = makeChat({ model: 'opus' })
    seed(c)
    render(<Composer chat={c} />)
    fireEvent.click(screen.getByRole('button', { name: /Opus 5\.5/ }))
    fireEvent.click(screen.getByText('Sonnet 5.5'))
    expect(chat.update).toHaveBeenCalledWith('chat-1', expect.objectContaining({ model: 'sonnet' }))
  })

  it('selecting a Codex radio updates the toggles', () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    expect(screen.getByRole('radiogroup')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Tests' }))
    expect(chat.update).toHaveBeenCalledWith('chat-1', {
      toggles: { codex: 'tests', fanOut: false, think: false }
    })
  })

  it('the Fan-out switch reflects state and changes only Fan-out', () => {
    const c = makeChat({ toggles: { codex: 'full', fanOut: false, think: false } })
    seed(c)
    render(<Composer chat={c} />)
    const sw = screen.getByRole('switch', { name: /fan-out/i })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    expect(chat.update).toHaveBeenCalledWith('chat-1', {
      toggles: { codex: 'full', fanOut: true, think: false }
    })
  })

  it('the Think harder switch reflects state and changes only Think harder', () => {
    const c = makeChat({ toggles: { codex: 'full', fanOut: false, think: true } })
    seed(c)
    render(<Composer chat={c} />)
    const sw = screen.getByRole('switch', { name: /think harder/i })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw)
    expect(chat.update).toHaveBeenCalledWith('chat-1', {
      toggles: { codex: 'full', fanOut: false, think: false }
    })
  })

  it('has no combined Ultra switch', () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    expect(screen.queryByRole('switch', { name: /ultra/i })).toBeNull()
  })

  it('Enter sends a started chat without a workspace', async () => {
    const c = makeChat({ started: true, toggles: { codex: 'tests', fanOut: true, think: true } })
    seed(c, { text: 'fix it' })
    render(<Composer chat={c} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1))
    expect(chat.send).toHaveBeenCalledWith({
      chatId: 'chat-1',
      text: 'fix it',
      attachments: [],
      toggles: { codex: 'tests', fanOut: true, think: true },
      workspace: undefined
    })
  })

  it('Enter sends a draft chat with its workspace plan and attachments', async () => {
    const c = makeChat({ started: false })
    const att = makeAttachment()
    seed(c, { text: 'go', attachments: [att] })
    render(<Composer chat={c} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1))
    expect(chat.send).toHaveBeenCalledWith({
      chatId: 'chat-1',
      text: 'go',
      attachments: [att],
      toggles: { codex: 'off', fanOut: false, think: false },
      workspace: WORKSPACE
    })
  })

  it('Shift+Enter does not send', () => {
    const c = makeChat()
    seed(c, { text: 'fix it' })
    render(<Composer chat={c} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true })
    expect(chat.send).not.toHaveBeenCalled()
  })

  it('the Send button is disabled with no text and no attachments', () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('the Send button is enabled once there is text and sends on click', async () => {
    const c = makeChat()
    seed(c, { text: 'hello' })
    render(<Composer chat={c} />)
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1))
  })

  it('shows Stop when busy with an empty draft and interrupts on click', () => {
    const c = makeChat({ status: 'busy' })
    seed(c)
    render(<Composer chat={c} />)
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(chat.interrupt).toHaveBeenCalledWith('chat-1')
  })

  it('shows the queue placeholder while busy', () => {
    const c = makeChat({ status: 'busy' })
    seed(c)
    render(<Composer chat={c} />)
    expect(
      screen.getByPlaceholderText('Queue a follow-up for when Claude finishes')
    ).toBeTruthy()
  })

  it('shows the default placeholder when idle', () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    expect(screen.getByPlaceholderText('Ask Claude to build, fix or explain something')).toBeTruthy()
  })

  it('the attach button opens the picker and shows chips for the picked files', async () => {
    const c = makeChat()
    seed(c)
    attachments.pick.mockResolvedValue([makeAttachment({ name: 'notes.md', path: 'C:\\n\\notes.md' })])
    render(<Composer chat={c} />)
    fireEvent.click(screen.getByLabelText('Attach files'))
    expect(attachments.pick).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('notes.md')).toBeTruthy()
  })

  it('removing a chip drops the attachment', () => {
    const c = makeChat()
    seed(c, { attachments: [makeAttachment({ name: 'a.ts' })] })
    render(<Composer chat={c} />)
    expect(screen.getByText('a.ts')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Remove a.ts'))
    expect(screen.queryByText('a.ts')).toBeNull()
    expect(useStore.getState().drafts['chat-1'].attachments).toEqual([])
  })

  it('shows the context percentage from contextTokens and contextWindow', () => {
    const c = makeChat({ contextTokens: 250_000, contextWindow: 1_000_000 })
    seed(c)
    render(<Composer chat={c} />)
    expect(screen.getByText('25%')).toBeTruthy()
  })

  it('falls back to the model context window when contextWindow is unknown', () => {
    const c = makeChat({ model: 'claude-opus-4-8', contextTokens: 100_000 })
    seed(c)
    render(<Composer chat={c} />)
    expect(screen.getByText('50%')).toBeTruthy()
  })

  it('shows 0% when the context is unknown', () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    expect(screen.getByText('0%')).toBeTruthy()
  })

  it('an external chat shows the read-only note and no textbox', () => {
    const c = makeChat({ chatId: 'ext:s9', mode: 'external' })
    seed(c)
    const { container } = render(<Composer chat={c} />)
    expect(container.querySelector('.readonly-note')).not.toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('typing updates the draft text in the store', () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    act(() => {
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } })
    })
    expect(useStore.getState().drafts['chat-1'].text).toBe('abc')
  })
})

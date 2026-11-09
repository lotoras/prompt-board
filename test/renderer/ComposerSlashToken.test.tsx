// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeChat } from './chatFixtures'

const { chat, attachments, pty } = vi.hoisted(() => ({
  chat: {
    update: vi.fn(),
    send: vi.fn(),
    interrupt: vi.fn(),
    setActive: vi.fn(),
    listCommands: vi.fn()
  },
  attachments: { pick: vi.fn(), describe: vi.fn(), saveImage: vi.fn() },
  pty: { getPathForFile: vi.fn() }
}))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { chat, attachments, pty, git: { branches: vi.fn().mockResolvedValue(['main']) } }
}))

import { Composer } from '../../src/renderer/src/features/chat/Composer'
import { useStore } from '../../src/renderer/src/store'
import type { ChatMeta, SlashCommandInfo } from '../../src/shared/types'

const COMMANDS: SlashCommandInfo[] = [
  { name: 'ai-brain:cc-enhance', description: 'Enhance a request', argumentHint: '<request>' },
  { name: 'compact', description: 'Compact the context', argumentHint: '', builtin: true }
]

function seed(c: ChatMeta, text = ''): void {
  useStore.setState({
    chats: [c],
    items: {},
    slashCommands: {},
    drafts: {
      [c.chatId]: {
        text,
        attachments: [],
        workspace: { newWorktree: false, newBranch: false },
        branchTouched: false,
        nameTouched: false
      }
    }
  })
}

const box = (): HTMLTextAreaElement => screen.getByRole('textbox') as HTMLTextAreaElement
const type = (value: string): void => {
  fireEvent.change(box(), { target: { value } })
}

beforeEach(() => {
  chat.update.mockResolvedValue(makeChat())
  chat.send.mockResolvedValue(undefined)
  chat.setActive.mockResolvedValue(undefined)
  chat.listCommands.mockResolvedValue(COMMANDS)
})

afterEach(() => {
  cleanup()
  Object.values(chat).forEach((f) => f.mockReset())
  Object.values(attachments).forEach((f) => f.mockReset())
  pty.getPathForFile.mockReset()
})

describe('Composer slash token after text', () => {
  it('typing "fix it /" opens the Commands list and loads the commands', async () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('fix it /')
    expect(await screen.findByRole('listbox', { name: 'Commands' })).toBeTruthy()
    expect(chat.listCommands).toHaveBeenCalledWith('chat-1')
  })

  it('choosing an item replaces only the token and keeps the text before it', async () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('fix it /cc-enh')
    fireEvent.click(await screen.findByRole('option'))
    expect(useStore.getState().drafts['chat-1'].text).toBe('fix it /ai-brain:cc-enhance ')
  })

  it('opens at the start of the draft', async () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('/')
    expect(await screen.findByRole('listbox', { name: 'Commands' })).toBeTruthy()
  })

  it('opens nothing for a path like /usr/bin', () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('/usr/bin')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('opens nothing for src/foo', () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('see src/foo')
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

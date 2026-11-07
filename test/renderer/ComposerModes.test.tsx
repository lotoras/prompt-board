// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  { name: 'compact', description: 'Compact the context', argumentHint: '', builtin: true },
  { name: 'clear', description: 'Clear the chat', argumentHint: '', builtin: true }
]

function seed(c: ChatMeta, text = ''): void {
  useStore.setState({
    chats: [c],
    items: {},
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
  chat.interrupt.mockResolvedValue(undefined)
  chat.setActive.mockResolvedValue(undefined)
  chat.listCommands.mockResolvedValue(COMMANDS)
})

afterEach(() => {
  cleanup()
  Object.values(chat).forEach((f) => f.mockReset())
  Object.values(attachments).forEach((f) => f.mockReset())
  pty.getPathForFile.mockReset()
})

describe('Composer permission mode', () => {
  it('shows the mode label on the Permission mode button', () => {
    const c = makeChat({ permissionMode: 'plan' })
    seed(c)
    render(<Composer chat={c} />)
    expect(screen.getByRole('button', { name: 'Permission mode' }).textContent).toContain('Plan')
  })

  it('defaults to Full access for bypassPermissions', () => {
    const c = makeChat({ permissionMode: 'bypassPermissions' })
    seed(c)
    render(<Composer chat={c} />)
    expect(screen.getByRole('button', { name: 'Permission mode' }).textContent).toContain('Full access')
  })

  it('choosing a mode in the popover updates the chat', () => {
    const c = makeChat({ permissionMode: 'bypassPermissions' })
    seed(c)
    render(<Composer chat={c} />)
    fireEvent.click(screen.getByRole('button', { name: 'Permission mode' }))
    fireEvent.click(screen.getByText('Accept edits'))
    expect(chat.update).toHaveBeenCalledWith('chat-1', { permissionMode: 'acceptEdits' })
  })

  it('Shift+Tab cycles to the next mode', () => {
    const c = makeChat({ permissionMode: 'default' })
    seed(c)
    render(<Composer chat={c} />)
    fireEvent.keyDown(box(), { key: 'Tab', shiftKey: true })
    expect(chat.update).toHaveBeenCalledWith('chat-1', { permissionMode: 'acceptEdits' })
  })

  it('Shift+Tab wraps from Full access to Ask', () => {
    const c = makeChat({ permissionMode: 'bypassPermissions' })
    seed(c)
    render(<Composer chat={c} />)
    fireEvent.keyDown(box(), { key: 'Tab', shiftKey: true })
    expect(chat.update).toHaveBeenCalledWith('chat-1', { permissionMode: 'default' })
  })
})

describe('Composer stop and send', () => {
  it('shows Send and Stop and send when busy with a draft', () => {
    const c = makeChat({ status: 'busy' })
    seed(c, 'next thing')
    render(<Composer chat={c} />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop and send' })).toBeTruthy()
  })

  it('has no Stop and send when idle or with an empty draft', () => {
    const idle = makeChat({ status: 'idle' })
    seed(idle, 'x')
    const { unmount } = render(<Composer chat={idle} />)
    expect(screen.queryByRole('button', { name: 'Stop and send' })).toBeNull()
    unmount()
    const busy = makeChat({ status: 'busy' })
    seed(busy, '')
    render(<Composer chat={busy} />)
    expect(screen.queryByRole('button', { name: 'Stop and send' })).toBeNull()
  })

  it('clicking Stop and send sends with interrupt', async () => {
    const c = makeChat({ status: 'busy' })
    seed(c, 'change course')
    render(<Composer chat={c} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop and send' }))
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1))
    expect(chat.send).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1', text: 'change course', interrupt: true })
    )
  })

  it('Ctrl+Enter sends with interrupt', async () => {
    const c = makeChat({ status: 'busy' })
    seed(c, 'change course')
    render(<Composer chat={c} />)
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1))
    expect(chat.send).toHaveBeenCalledWith(expect.objectContaining({ interrupt: true }))
  })

  it('plain Enter while busy queues without interrupt', async () => {
    const c = makeChat({ status: 'busy' })
    seed(c, 'queue me')
    render(<Composer chat={c} />)
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1))
    expect(chat.send.mock.calls[0][0].interrupt).toBeFalsy()
  })

  it('the Send button while busy does not interrupt', async () => {
    const c = makeChat({ status: 'busy' })
    seed(c, 'queue me')
    render(<Composer chat={c} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1))
    expect(chat.send.mock.calls[0][0].interrupt).toBeFalsy()
  })
})

describe('Composer slash suggestions', () => {
  it('typing /cc-enh loads commands once and lists the matching option', async () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('/c')
    type('/cc')
    type('/cc-enh')
    const list = await screen.findByRole('listbox')
    expect(list).toBeTruthy()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toContain('/ai-brain:cc-enhance')
    expect(options[0].textContent).toContain('<request>')
    expect(options[0].textContent).toContain('Enhance a request')
    expect(chat.listCommands).toHaveBeenCalledTimes(1)
    expect(chat.listCommands).toHaveBeenCalledWith('chat-1')
  })

  it('does not load commands for ordinary text', () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('hello')
    expect(chat.listCommands).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Enter inserts the selected command with a trailing space and does not send', async () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('/cc-enh')
    await screen.findByRole('listbox')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(useStore.getState().drafts['chat-1'].text).toBe('/ai-brain:cc-enhance ')
    expect(chat.send).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })

  it('Tab inserts the selected command', async () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('/cc-enh')
    await screen.findByRole('listbox')
    fireEvent.keyDown(box(), { key: 'Tab' })
    expect(useStore.getState().drafts['chat-1'].text).toBe('/ai-brain:cc-enhance ')
    expect(chat.send).not.toHaveBeenCalled()
  })

  it('ArrowDown moves the selection before Enter inserts', async () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('/c')
    await screen.findByRole('listbox')
    const names = screen.getAllByRole('option').map((o) => o.textContent ?? '')
    expect(names.length).toBeGreaterThan(1)
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    fireEvent.keyDown(box(), { key: 'Enter' })
    const inserted = useStore.getState().drafts['chat-1'].text
    expect(inserted.endsWith(' ')).toBe(true)
    expect(names[1]).toContain(`/${inserted.trim().slice(1)}`)
  })

  it('clicking an option inserts it', async () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('/cc-enh')
    fireEvent.click(await screen.findByRole('option'))
    expect(useStore.getState().drafts['chat-1'].text).toBe('/ai-brain:cc-enhance ')
  })

  it('Escape closes the list', async () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('/cc-enh')
    await screen.findByRole('listbox')
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('shows no list once a space is typed', async () => {
    const c = makeChat()
    seed(c)
    render(<Composer chat={c} />)
    type('/cc-enh')
    await screen.findByRole('listbox')
    type('/cc-enhance fix the bug')
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

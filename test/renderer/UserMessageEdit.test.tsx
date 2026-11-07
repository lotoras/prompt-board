// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeChat } from './chatFixtures'

const { chat } = vi.hoisted(() => ({ chat: { rewind: vi.fn() } }))
vi.mock('../../src/renderer/src/lib/api', () => ({ api: { chat } }))

import { UserMessage } from '../../src/renderer/src/features/chat/items/UserMessage'
import { useStore } from '../../src/renderer/src/store'
import type { ChatItem, ChatMeta } from '../../src/shared/types'

type UserItem = Extract<ChatItem, { kind: 'user' }>

const makeItem = (extra: Partial<UserItem> = {}): UserItem => ({
  kind: 'user',
  id: 'u-2',
  text: 'original text',
  directives: { codex: 'off', ultra: false },
  attachments: [],
  parentUuid: 'a-1',
  ...extra
})

function renderMsg(item: UserItem, c: ChatMeta = makeChat()): void {
  useStore.setState({ chats: [c] })
  render(<UserMessage chatId={c.chatId} item={item} />)
}

beforeEach(() => chat.rewind.mockResolvedValue(undefined))
afterEach(() => {
  cleanup()
  chat.rewind.mockReset()
})

describe('UserMessage edit', () => {
  it('shows the Edit message button for an own idle chat', () => {
    renderMsg(makeItem())
    expect(screen.getByRole('button', { name: 'Edit message' })).toBeTruthy()
  })

  it('also shows it for the first message (parentUuid null)', () => {
    renderMsg(makeItem({ parentUuid: null }))
    expect(screen.getByRole('button', { name: 'Edit message' })).toBeTruthy()
  })

  it('hides it when parentUuid is undefined', () => {
    renderMsg(makeItem({ parentUuid: undefined }))
    expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull()
  })

  it('hides it while the chat is busy', () => {
    renderMsg(makeItem(), makeChat({ status: 'busy' }))
    expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull()
  })

  it('hides it for external chats', () => {
    renderMsg(makeItem(), makeChat({ chatId: 'ext:s9', mode: 'external' }))
    expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull()
  })

  it('opens an inline editor prefilled with the text', () => {
    renderMsg(makeItem())
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    expect((screen.getByLabelText('Edit message text') as HTMLTextAreaElement).value).toBe(
      'original text'
    )
    expect((screen.getByLabelText('Also restore files') as HTMLInputElement).checked).toBe(false)
  })

  it('Send edit rewinds with the edited text and no file restore by default', () => {
    const c = makeChat({ toggles: { codex: 'tests', ultra: true } })
    renderMsg(makeItem(), c)
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    fireEvent.change(screen.getByLabelText('Edit message text'), { target: { value: 'better text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send edit' }))
    expect(chat.rewind).toHaveBeenCalledWith({
      chatId: 'chat-1',
      userItemId: 'u-2',
      text: 'better text',
      attachments: [],
      toggles: { codex: 'tests', ultra: true },
      revertFiles: false
    })
  })

  it('passes revertFiles when the checkbox is ticked', () => {
    renderMsg(makeItem())
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    fireEvent.click(screen.getByLabelText('Also restore files'))
    fireEvent.click(screen.getByRole('button', { name: 'Send edit' }))
    expect(chat.rewind).toHaveBeenCalledWith(expect.objectContaining({ revertFiles: true }))
  })

  it('Cancel restores the bubble without rewinding', () => {
    renderMsg(makeItem())
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    fireEvent.change(screen.getByLabelText('Edit message text'), { target: { value: 'changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Edit message text')).toBeNull()
    expect(screen.getByText('original text')).toBeTruthy()
    expect(chat.rewind).not.toHaveBeenCalled()
  })
})

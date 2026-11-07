// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { chat } = vi.hoisted(() => ({ chat: { decidePermission: vi.fn() } }))
vi.mock('../../src/renderer/src/lib/api', () => ({ api: { chat } }))

import { PermissionCard } from '../../src/renderer/src/features/chat/items/PermissionCard'
import type { ChatItem } from '../../src/shared/types'

type PermItem = Extract<ChatItem, { kind: 'permission' }>

const makeItem = (extra: Partial<PermItem> = {}): PermItem => ({
  kind: 'permission',
  id: 'tool-1',
  toolName: 'Bash',
  title: 'Claude wants to run npm test',
  description: 'Runs the test suite',
  summary: 'npm test',
  canAlwaysAllow: true,
  state: 'pending',
  ...extra
})

beforeEach(() => chat.decidePermission.mockResolvedValue(undefined))
afterEach(() => {
  cleanup()
  chat.decidePermission.mockReset()
})

describe('PermissionCard', () => {
  it('shows title, description and summary while pending', () => {
    render(<PermissionCard chatId="chat-1" item={makeItem()} />)
    expect(screen.getByText('Claude wants to run npm test')).toBeTruthy()
    expect(screen.getByText('Runs the test suite')).toBeTruthy()
    expect(screen.getByText('npm test')).toBeTruthy()
  })

  it('Allow sends a plain allow decision', () => {
    render(<PermissionCard chatId="chat-1" item={makeItem()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(chat.decidePermission).toHaveBeenCalledWith('chat-1', 'tool-1', { allow: true })
  })

  it('Allow for this chat sends allow with always', () => {
    render(<PermissionCard chatId="chat-1" item={makeItem()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow for this chat' }))
    expect(chat.decidePermission).toHaveBeenCalledWith('chat-1', 'tool-1', {
      allow: true,
      always: true
    })
  })

  it('Deny sends a deny decision', () => {
    render(<PermissionCard chatId="chat-1" item={makeItem()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(chat.decidePermission).toHaveBeenCalledWith('chat-1', 'tool-1', { allow: false })
  })

  it('hides Allow for this chat unless canAlwaysAllow', () => {
    render(<PermissionCard chatId="chat-1" item={makeItem({ canAlwaysAllow: false })} />)
    expect(screen.queryByRole('button', { name: 'Allow for this chat' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy()
  })

  it.each(['allowed', 'denied'] as const)('shows a compact answered line when %s', (state) => {
    const { container } = render(<PermissionCard chatId="chat-1" item={makeItem({ state })} />)
    expect(container.querySelector('.answered')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull()
  })
})

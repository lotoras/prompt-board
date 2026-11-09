// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeChat } from './chatFixtures'

const { chat } = vi.hoisted(() => ({ chat: { interrupt: vi.fn() } }))
vi.mock('../../src/renderer/src/lib/api', () => ({ api: { chat } }))

import { QueuedMessages } from '../../src/renderer/src/features/chat/items/QueuedMessages'

const q = (id: string, text: string) => ({ id, text, attachments: [] })

beforeEach(() => {
  chat.interrupt.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  chat.interrupt.mockReset()
})

describe('QueuedMessages', () => {
  it('renders nothing for an empty or missing queue', () => {
    const { container, rerender } = render(<QueuedMessages chat={makeChat({ queued: [] })} />)
    expect(container.firstChild).toBeNull()
    rerender(<QueuedMessages chat={makeChat()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders each queued text in a gray bubble with the waiting label', () => {
    const { container } = render(
      <QueuedMessages chat={makeChat({ queued: [q('a', 'first one'), q('b', 'second one')] })} />
    )
    const bubbles = Array.from(container.querySelectorAll('.bubble.queued'))
    expect(bubbles).toHaveLength(2)
    expect(bubbles[0].textContent).toContain('first one')
    expect(bubbles[1].textContent).toContain('second one')
    expect(screen.getAllByText('Waiting for Claude').length).toBeGreaterThan(0)
  })

  it('has exactly one Stop and send now button', () => {
    render(<QueuedMessages chat={makeChat({ queued: [q('a', 'x'), q('b', 'y')] })} />)
    expect(screen.getAllByRole('button', { name: 'Stop and send now' })).toHaveLength(1)
  })

  it('clicking interrupts the chat once and disables the button', () => {
    render(<QueuedMessages chat={makeChat({ queued: [q('a', 'x')] })} />)
    const btn = screen.getByRole('button', { name: 'Stop and send now' }) as HTMLButtonElement
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(chat.interrupt).toHaveBeenCalledTimes(1)
    expect(chat.interrupt).toHaveBeenCalledWith('chat-1')
    expect(btn.disabled).toBe(true)
  })
})

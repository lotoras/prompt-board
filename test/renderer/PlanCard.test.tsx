// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { chat } = vi.hoisted(() => ({ chat: { decidePlan: vi.fn() } }))
vi.mock('../../src/renderer/src/lib/api', () => ({ api: { chat } }))

import { PlanCard } from '../../src/renderer/src/features/chat/items/PlanCard'
import type { ChatItem } from '../../src/shared/types'

type PlanItem = Extract<ChatItem, { kind: 'plan' }>

const makeItem = (state: PlanItem['state'] = 'pending'): PlanItem => ({
  kind: 'plan',
  id: 'tool-p1',
  plan: 'Step one\nStep two',
  state
})

beforeEach(() => chat.decidePlan.mockResolvedValue(undefined))
afterEach(() => {
  cleanup()
  chat.decidePlan.mockReset()
})

describe('PlanCard', () => {
  it('Approve plan sends an approve decision', () => {
    render(<PlanCard chatId="chat-1" item={makeItem()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }))
    expect(chat.decidePlan).toHaveBeenCalledWith('chat-1', 'tool-p1', { approve: true })
  })

  it('Keep planning reveals a feedback textarea', () => {
    render(<PlanCard chatId="chat-1" item={makeItem()} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Keep planning' }))
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('Send feedback rejects the plan with the typed feedback', () => {
    render(<PlanCard chatId="chat-1" item={makeItem()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Keep planning' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cover the edge cases' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(chat.decidePlan).toHaveBeenCalledWith('chat-1', 'tool-p1', {
      approve: false,
      feedback: 'Cover the edge cases'
    })
  })

  it('an approved plan renders as .plan.done without the decision buttons', () => {
    const { container } = render(<PlanCard chatId="chat-1" item={makeItem('approved')} />)
    expect(container.querySelector('.plan.done')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Keep planning' })).toBeNull()
  })

  it('a pending plan is not marked done', () => {
    const { container } = render(<PlanCard chatId="chat-1" item={makeItem()} />)
    expect(container.querySelector('.plan.done')).toBeNull()
  })
})

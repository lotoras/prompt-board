// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { chat } = vi.hoisted(() => ({ chat: { answer: vi.fn() } }))
vi.mock('../../src/renderer/src/lib/api', () => ({ api: { chat } }))

import { QuestionCard } from '../../src/renderer/src/features/chat/items/QuestionCard'
import type { ChatItem } from '../../src/shared/types'

type QuestionItem = Extract<ChatItem, { kind: 'question' }>

function makeItem(overrides: Partial<QuestionItem> = {}): QuestionItem {
  return {
    kind: 'question',
    id: 'tool-q1',
    state: 'pending',
    questions: [
      {
        question: 'Which database?',
        header: 'DB',
        multiSelect: false,
        options: [
          { label: 'Postgres', description: 'Relational' },
          { label: 'SQLite', description: 'Embedded' }
        ]
      }
    ],
    ...overrides
  }
}

beforeEach(() => chat.answer.mockResolvedValue(undefined))
afterEach(() => {
  cleanup()
  chat.answer.mockReset()
})

describe('QuestionCard', () => {
  it('shows the question and its options as buttons', () => {
    render(<QuestionCard chatId="chat-1" item={makeItem()} />)
    expect(screen.getByText('Which database?')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Postgres/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /SQLite/ })).toBeTruthy()
  })

  it('Send answer sends the picked option label keyed by the question', () => {
    render(<QuestionCard chatId="chat-1" item={makeItem()} />)
    fireEvent.click(screen.getByRole('button', { name: /SQLite/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }))
    expect(chat.answer).toHaveBeenCalledWith('chat-1', 'tool-q1', { 'Which database?': 'SQLite' })
  })

  it('sends a typed other answer instead of an option', () => {
    render(<QuestionCard chatId="chat-1" item={makeItem()} />)
    fireEvent.click(screen.getByRole('button', { name: /other/i }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DuckDB' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }))
    expect(chat.answer).toHaveBeenCalledWith('chat-1', 'tool-q1', { 'Which database?': 'DuckDB' })
  })

  it('answers every question of the card', () => {
    const item = makeItem({
      questions: [
        makeItem().questions[0],
        {
          question: 'Which ORM?',
          header: 'ORM',
          multiSelect: false,
          options: [
            { label: 'Drizzle', description: '' },
            { label: 'Prisma', description: '' }
          ]
        }
      ]
    })
    render(<QuestionCard chatId="chat-1" item={item} />)
    fireEvent.click(screen.getByRole('button', { name: /Postgres/ }))
    fireEvent.click(screen.getByRole('button', { name: /Prisma/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }))
    expect(chat.answer).toHaveBeenCalledWith('chat-1', 'tool-q1', {
      'Which database?': 'Postgres',
      'Which ORM?': 'Prisma'
    })
  })

  it('Skip answers with null', () => {
    render(<QuestionCard chatId="chat-1" item={makeItem()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(chat.answer).toHaveBeenCalledWith('chat-1', 'tool-q1', null)
  })

  it('an answered question collapses to a compact .answered line without buttons', () => {
    const { container } = render(
      <QuestionCard
        chatId="chat-1"
        item={makeItem({ state: 'answered', answers: { 'Which database?': 'Postgres' } })}
      />
    )
    expect(container.querySelector('.answered')).not.toBeNull()
    expect(screen.getByText(/Postgres/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send answer' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
  })

  it('a skipped question collapses to a compact .answered line', () => {
    const { container } = render(<QuestionCard chatId="chat-1" item={makeItem({ state: 'skipped' })} />)
    expect(container.querySelector('.answered')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Send answer' })).toBeNull()
  })
})

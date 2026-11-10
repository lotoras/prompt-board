// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeChat, tool } from './chatFixtures'

const { chat, changes } = vi.hoisted(() => ({
  chat: { update: vi.fn(), listCommands: vi.fn(), setActive: vi.fn() },
  changes: vi.fn()
}))
vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { chat, git: { branches: vi.fn().mockResolvedValue(['main']), changes } }
}))

import { ChangesPanel, editedDirs } from '../../src/renderer/src/features/chat/ChangesPanel'
import { ChatView } from '../../src/renderer/src/features/chat/ChatView'
import { useStore } from '../../src/renderer/src/store'
import type { ChatItem } from '../../src/shared/types'

const edit = (id: string, file: string, text: string, added = 1, removed = 0): ChatItem =>
  tool(id, {
    name: 'Edit',
    diff: { file, added, removed, lines: [{ type: 'add', newNo: 1, text }] }
  })

const c = makeChat()
const seed = (items: ChatItem[], changesOpen = true): void => {
  useStore.setState({ chats: [c], items: { [c.chatId]: items }, changesOpen, drafts: {} } as never)
}

beforeEach(() => {
  chat.update.mockResolvedValue(c)
})

afterEach(cleanup)

describe('ChangesPanel', () => {
  it('renders nothing while closed', () => {
    seed([edit('e1', 'src/a.ts', 'one')], false)
    const { container } = render(<ChangesPanel chat={c} />)
    expect(container.firstChild).toBeNull()
  })

  it('tells when no file was edited yet', () => {
    seed([])
    render(<ChangesPanel chat={c} />)
    expect(screen.getByText('No files edited in this chat yet.')).toBeTruthy()
  })

  it('lists each file once with its totals and shows the first file', () => {
    seed([edit('e1', 'src/b.ts', 'bee', 2, 1), edit('e2', 'src/a.ts', 'ay', 3), edit('e3', 'src/b.ts', 'bee2', 4, 2)])
    render(<ChangesPanel chat={c} />)
    const rows = screen.getAllByRole('option')
    expect(rows.map((r) => r.getAttribute('title'))).toEqual(['src/a.ts', 'src/b.ts'])
    expect(rows[1].textContent).toContain('+6')
    expect(rows[1].textContent).toContain('−3')
    expect(rows[0].getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('ay')).toBeTruthy()
    expect(screen.queryByText('bee')).toBeNull()
    expect(screen.getByText('2 changed files')).toBeTruthy()
  })

  it('switches the diff when another file is clicked', () => {
    seed([edit('e1', 'src/a.ts', 'ay'), edit('e2', 'src/b.ts', 'bee')])
    render(<ChangesPanel chat={c} />)
    fireEvent.click(screen.getByRole('option', { name: /b\.ts/ }))
    expect(screen.getByText('bee')).toBeTruthy()
    expect(screen.queryByText('ay')).toBeNull()
  })

  it('shows several edits of one file in order', () => {
    seed([edit('e1', 'src/a.ts', 'first'), edit('e2', 'src/a.ts', 'second')])
    render(<ChangesPanel chat={c} />)
    expect(screen.getByText('Edit 1 of 2')).toBeTruthy()
    expect(screen.getByText('Edit 2 of 2')).toBeTruthy()
    const order = screen.getByRole('region', { name: 'Diff' }).textContent ?? ''
    expect(order.indexOf('first')).toBeLessThan(order.indexOf('second'))
  })

  it('adds a new edit while it is open', () => {
    seed([edit('e1', 'src/a.ts', 'ay')])
    render(<ChangesPanel chat={c} />)
    act(() => seed([edit('e1', 'src/a.ts', 'ay'), edit('e2', 'src/new.ts', 'fresh')]))
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('closes from its own button', () => {
    seed([edit('e1', 'src/a.ts', 'ay')])
    render(<ChangesPanel chat={c} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close changes' }))
    expect(useStore.getState().changesOpen).toBe(false)
  })
})

describe('ChatView Changes toggle', () => {
  it('shows the count and toggles the panel state', () => {
    seed([edit('e1', 'src/a.ts', 'ay'), edit('e2', 'src/b.ts', 'bee')], false)
    render(<ChatView chat={c} />)
    const button = screen.getByRole('button', { name: 'Changes' })
    expect(button.textContent).toContain('2')
    fireEvent.click(button)
    expect(useStore.getState().changesOpen).toBe(true)
    fireEvent.click(button)
    expect(useStore.getState().changesOpen).toBe(false)
  })
})

describe('ChangesPanel git source', () => {
  const gitFile = (
    path: string,
    text: string,
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    path,
    status: 'modified',
    added: 2,
    removed: 1,
    diff: { file: path, added: 2, removed: 1, lines: [{ type: 'add', newNo: 1, text }] },
    ...extra
  })

  it('lists the git files with totals, the first diff and a tag for new files', async () => {
    changes.mockResolvedValue({
      isRepo: true,
      baseLabel: 'main',
      files: [
        gitFile('src/a.ts', 'git-line-a'),
        gitFile('src/fresh.ts', 'git-line-fresh', { status: 'added', added: 5, removed: 0 })
      ]
    })
    seed([edit('e1', 'tool/only.ts', 'tool-line')])
    render(<ChangesPanel chat={c} />)
    expect(await screen.findByText('git-line-a')).toBeTruthy()
    expect(changes).toHaveBeenCalledWith(c.cwd, [])
    const rows = screen.getAllByRole('option')
    expect(rows.map((r) => r.getAttribute('title'))).toEqual(['src/a.ts', 'src/fresh.ts'])
    expect(rows[0].textContent).toContain('+2')
    expect(rows[0].textContent).toContain('−1')
    expect(rows[1].textContent).toContain('+5')
    expect(rows[1].textContent).toContain('new')
    expect(screen.queryByText('tool-line')).toBeNull()
  })

  it('notes a binary file instead of showing lines', async () => {
    changes.mockResolvedValue({
      isRepo: true,
      baseLabel: 'main',
      files: [
        {
          path: 'img/logo.png',
          status: 'modified',
          added: 0,
          removed: 0,
          binary: true,
          diff: { file: 'img/logo.png', added: 0, removed: 0, lines: [] }
        }
      ]
    })
    seed([])
    render(<ChangesPanel chat={c} />)
    expect(await screen.findByText(/Binary file/)).toBeTruthy()
  })

  it('tells when the repo has no changes', async () => {
    changes.mockResolvedValue({ isRepo: true, files: [] })
    seed([edit('e1', 'src/a.ts', 'tool-line')])
    render(<ChangesPanel chat={c} />)
    expect(await screen.findByText('No changes in this folder yet.')).toBeTruthy()
  })

  it('falls back to the tool list when the git call rejects', async () => {
    changes.mockRejectedValue(new Error('boom'))
    seed([edit('e1', 'src/a.ts', 'tool-line')])
    render(<ChangesPanel chat={c} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('tool-line')).toBeTruthy()
    expect(screen.getByText('1 changed file')).toBeTruthy()
  })
})

describe('editedDirs', () => {
  it('lists the folders of absolute paths outside the chat folder, once each', () => {
    const items = [
      edit('e1', String.raw`C:\www\beam\lib\a.ex`, 'a'),
      edit('e2', String.raw`C:\www\beam\lib\b.ex`, 'b'),
      edit('e3', String.raw`C:\www\tasks\notes.md`, 'n'),
      edit('e4', 'src/rel.ts', 'r')
    ]
    expect(editedDirs(items, String.raw`C:\www\tasks`)).toBe(String.raw`C:\www\beam\lib`)
  })
})

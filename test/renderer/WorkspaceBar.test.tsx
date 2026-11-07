// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeChat } from './chatFixtures'

const { branches } = vi.hoisted(() => ({ branches: vi.fn() }))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { git: { branches }, chat: { setActive: vi.fn(), update: vi.fn() }, pty: {} }
}))

import { WorkspaceBar } from '../../src/renderer/src/features/chat/WorkspaceBar'
import { useStore } from '../../src/renderer/src/store'
import type { ChatMeta } from '../../src/shared/types'

function seedDraft(c: ChatMeta, text = ''): void {
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

const draftChat = (): ChatMeta => makeChat({ started: false, branch: 'main' })
const sw = (name: RegExp): HTMLElement => screen.getByRole('switch', { name })
const checked = (el: HTMLElement): string | null => el.getAttribute('aria-checked')

beforeEach(() => {
  branches.mockResolvedValue(['main', 'dev'])
})

afterEach(() => {
  cleanup()
  branches.mockReset()
})

describe('WorkspaceBar (draft)', () => {
  it('loads the branches of the project', async () => {
    seedDraft(draftChat())
    render(<WorkspaceBar chat={draftChat()} />)
    await waitFor(() => expect(branches).toHaveBeenCalledWith('proj-1'))
  })

  it('starts with both switches off and no branch-name input', () => {
    seedDraft(draftChat())
    render(<WorkspaceBar chat={draftChat()} />)
    expect(checked(sw(/new worktree/i))).toBe('false')
    expect(checked(sw(/new branch/i))).toBe('false')
    expect(screen.queryByLabelText('Branch name')).toBeNull()
  })

  it('turning New worktree on also turns New branch on', () => {
    seedDraft(draftChat())
    render(<WorkspaceBar chat={draftChat()} />)
    fireEvent.click(sw(/new worktree/i))
    expect(checked(sw(/new worktree/i))).toBe('true')
    expect(checked(sw(/new branch/i))).toBe('true')
    expect(screen.getByLabelText('Branch name')).toBeTruthy()
  })

  it('does not turn New branch on when the user toggled New branch first', () => {
    seedDraft(draftChat())
    render(<WorkspaceBar chat={draftChat()} />)
    fireEvent.click(sw(/new branch/i))
    fireEvent.click(sw(/new branch/i))
    fireEvent.click(sw(/new worktree/i))
    expect(checked(sw(/new worktree/i))).toBe('true')
    expect(checked(sw(/new branch/i))).toBe('false')
  })

  it('defaults the branch name to the suggestion from the draft text', () => {
    seedDraft(draftChat(), 'Fix the chime\nmore')
    render(<WorkspaceBar chat={draftChat()} />)
    fireEvent.click(sw(/new branch/i))
    expect((screen.getByLabelText('Branch name') as HTMLInputElement).value).toBe('pb/fix-the-chime')
  })

  it('follows the draft text until the user edits the name', () => {
    seedDraft(draftChat(), 'first idea')
    render(<WorkspaceBar chat={draftChat()} />)
    fireEvent.click(sw(/new branch/i))
    const input = screen.getByLabelText('Branch name') as HTMLInputElement
    expect(input.value).toBe('pb/first-idea')

    act(() => useStore.getState().setDraftText('chat-1', 'second idea'))
    expect(input.value).toBe('pb/second-idea')

    fireEvent.change(input, { target: { value: 'pb/custom' } })
    act(() => useStore.getState().setDraftText('chat-1', 'third idea'))
    expect(input.value).toBe('pb/custom')
  })

  it('notes the main checkout and branch when no workspace switch is on', () => {
    seedDraft(draftChat())
    render(<WorkspaceBar chat={draftChat()} />)
    expect(screen.getByText(/Runs in the main checkout on main/)).toBeTruthy()
  })

  it('notes the worktree folder and branch when New worktree is on', () => {
    seedDraft(draftChat(), 'Fix the chime')
    render(<WorkspaceBar chat={draftChat()} />)
    fireEvent.click(sw(/new worktree/i))
    expect(
      screen.getByText(/Runs in \.claude\/worktrees\/fix-the-chime on pb\/fix-the-chime/)
    ).toBeTruthy()
  })
})

describe('WorkspaceBar (started chat)', () => {
  it('shows the branch and worktree read-only', () => {
    const c = makeChat({ started: true, branch: 'pb/x', worktreePath: '.claude/worktrees/x' })
    seedDraft(c)
    render(<WorkspaceBar chat={c} />)
    expect(screen.getByText(/pb\/x/)).toBeTruthy()
    expect(screen.getByText(/\.claude\/worktrees\/x/)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByLabelText('Branch name')).toBeNull()
  })

  it('says the chat runs in the main checkout without a worktree', () => {
    const c = makeChat({ started: true, branch: 'main', worktreePath: undefined })
    seedDraft(c)
    render(<WorkspaceBar chat={c} />)
    expect(screen.getByText(/in the main checkout/i)).toBeTruthy()
  })
})

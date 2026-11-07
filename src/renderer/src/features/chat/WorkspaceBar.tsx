import { useEffect, useState } from 'react'
import { ChevronDown, FolderGit2, GitBranch, GitBranchPlus, Terminal } from 'lucide-react'
import { worktreeSlug } from '../../../../shared/chat'
import type { ChatMeta } from '../../../../shared/types'
import { api } from '../../lib/api'
import { EMPTY_DRAFT, effectiveBranchName } from '../../store/chatsSlice'
import { useStore } from '../../store'
import { BasePopover } from './popovers/pickers'

function TerminalButton(): React.JSX.Element {
  const toggleDrawer = useStore((s) => s.toggleDrawer)
  return (
    <>
      <span className="grow" />
      <button
        type="button"
        className="ws-pick"
        title="Toggle terminal (Ctrl+`)"
        onClick={() => toggleDrawer()}
      >
        <Terminal className="i sm" strokeWidth={1.8} />
        <span>Terminal</span>
      </button>
    </>
  )
}

export function WorkspaceBar({ chat }: { chat: ChatMeta }): React.JSX.Element {
  const { chatId } = chat
  const draft = useStore((s) => s.drafts[chatId] ?? EMPTY_DRAFT)
  const popover = useStore((s) => s.popover)
  const setPopover = useStore((s) => s.setPopover)
  const setWorkspace = useStore((s) => s.setWorkspace)
  const [branches, setBranches] = useState<string[]>([])
  const [baseEl, setBaseEl] = useState<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (chat.started) return
    let active = true
    Promise.resolve(api.git.branches(chat.projectKey))
      .then((list) => {
        if (active) setBranches(list ?? [])
      })
      .catch((e) => console.error(e))
    return () => {
      active = false
    }
  }, [chat.projectKey, chat.started])

  if (chat.started) {
    return (
      <div className="wsbar">
        {chat.branch && (
          <span className="ws-live">
            <GitBranch className="i sm" strokeWidth={1.8} />
            <span className="mono">{chat.branch}</span>
          </span>
        )}
        {chat.worktreePath ? (
          <span className="ws-live">
            <FolderGit2 className="i sm" strokeWidth={1.8} />
            <span className="mono">{chat.worktreePath}</span>
          </span>
        ) : (
          <span className="ws-note">in the main checkout</span>
        )}
        <TerminalButton />
      </div>
    )
  }

  const ws = draft.workspace
  const base = ws.baseBranch ?? chat.branch ?? branches[0] ?? 'main'
  const branchName = effectiveBranchName(draft)
  const where = ws.newWorktree
    ? `.claude/worktrees/${worktreeSlug(branchName)}`
    : 'the main checkout'
  const onBranch = ws.newBranch
    ? branchName
    : ws.newWorktree
      ? `a detached copy of ${base}`
      : base

  const toggleWorktree = (): void => {
    const next = !ws.newWorktree
    setWorkspace(chatId, {
      newWorktree: next,
      ...(next && !draft.branchTouched ? { newBranch: true } : {})
    })
  }

  const toggleBranch = (): void => {
    setWorkspace(chatId, { newBranch: !ws.newBranch, branchTouched: true })
  }

  return (
    <div className="wsbar">
      <button
        ref={setBaseEl}
        type="button"
        className="ws-pick"
        title="Branch to start from"
        onClick={() => setPopover(popover === 'base' ? null : 'base')}
      >
        <span className="lbl">From</span>
        <GitBranch className="i sm" strokeWidth={1.8} />
        <span className="mono">{base}</span>
        <ChevronDown className="i sm" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={ws.newWorktree}
        className={`pt${ws.newWorktree ? ' on' : ''}`}
        onClick={toggleWorktree}
      >
        <FolderGit2 className="i sm" strokeWidth={1.8} />
        <span>New worktree</span>
        <span className="sw" />
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={ws.newBranch}
        className={`pt${ws.newBranch ? ' on' : ''}`}
        onClick={toggleBranch}
      >
        <GitBranchPlus className="i sm" strokeWidth={1.8} />
        <span>New branch</span>
        <span className="sw" />
      </button>
      {ws.newBranch && (
        <input
          className="br-input"
          aria-label="Branch name"
          spellCheck={false}
          value={branchName}
          onChange={(e) => setWorkspace(chatId, { branchName: e.target.value, nameTouched: true })}
        />
      )}
      <span className="ws-note">{`Runs in ${where} on ${onBranch}`}</span>
      <TerminalButton />
      {popover === 'base' && (
        <BasePopover
          anchor={baseEl}
          branches={branches.length ? branches : [base]}
          current={base}
          onClose={() => setPopover(null)}
          onPick={(branch) => {
            setWorkspace(chatId, { baseBranch: branch })
            setPopover(null)
          }}
        />
      )}
    </div>
  )
}

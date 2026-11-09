import { useEffect, useState } from 'react'
import { ChevronDown, FolderGit2, GitBranch, GitBranchPlus, Terminal, UserRound } from 'lucide-react'
import { worktreeSlug } from '../../../../shared/chat'
import { CLAUDE_ACCOUNTS, type ChatMeta } from '../../../../shared/types'
import { api } from '../../lib/api'
import { EMPTY_DRAFT, effectiveBranchName } from '../../store/chatsSlice'
import { useStore } from '../../store'
import { AccountPopover, BasePopover } from './popovers/pickers'

function TerminalButton({ chat }: { chat: ChatMeta }): React.JSX.Element | null {
  const openInTui = useStore((s) => s.openInTui)
  if (chat.mode === 'external') return null
  return (
    <>
      <span className="grow" />
      <button
        type="button"
        className="ws-pick"
        title="Continue this chat in the full-screen Claude terminal"
        onClick={() => void openInTui(chat.chatId).catch((e) => console.error(e))}
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
  const updateChat = useStore((s) => s.updateChat)
  const accounts = useStore((s) => s.accounts)
  const [branches, setBranches] = useState<string[]>([])
  const [baseEl, setBaseEl] = useState<HTMLButtonElement | null>(null)
  const [accountEl, setAccountEl] = useState<HTMLButtonElement | null>(null)

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
        {chat.account === 2 && (
          <span className="ws-live">
            <UserRound className="i sm" strokeWidth={1.8} />
            <span>Claude 2</span>
          </span>
        )}
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
        <TerminalButton chat={chat} />
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

  const note = `Runs in ${where} on ${onBranch}`

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

  const accountLabel = CLAUDE_ACCOUNTS.find((a) => a.id === chat.account)?.label ?? 'Claude 1'

  return (
    <div className="wsbar">
      <button
        ref={setAccountEl}
        type="button"
        className="ws-pick"
        aria-label={`Claude account: ${accountLabel}`}
        title="Claude account for this chat"
        onClick={() => setPopover(popover === 'account' ? null : 'account')}
      >
        <UserRound className="i sm" strokeWidth={1.8} />
        <span>{accountLabel}</span>
        <ChevronDown className="i sm" strokeWidth={1.8} />
      </button>
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
      <span className="ws-note" title={note}>{note}</span>
      <TerminalButton chat={chat} />
      {popover === 'account' && (
        <AccountPopover
          anchor={accountEl}
          accounts={accounts}
          current={chat.account}
          onClose={() => setPopover(null)}
          onPick={(account) => {
            updateChat(chatId, { account })
            setPopover(null)
          }}
        />
      )}
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

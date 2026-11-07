import { useEffect, useMemo, useRef } from 'react'
import { Monitor, SquareKanban, Terminal } from 'lucide-react'
import { statusTone } from '../../../../shared/types'
import type { ChatItem, ChatMeta } from '../../../../shared/types'
import { formatRelativeTime, formatTokens } from '../../lib/format'
import { useStore } from '../../store'
import { Composer } from './Composer'
import { WorkspaceBar } from './WorkspaceBar'
import { groupItems } from './groupItems'
import type { RenderBlock } from './groupItems'
import { AgentCard } from './items/AgentCard'
import { AssistantText } from './items/AssistantText'
import { CommandChip } from './items/CommandChip'
import { EditDiff } from './items/EditDiff'
import { PermissionCard } from './items/PermissionCard'
import { PlanCard } from './items/PlanCard'
import { QuestionCard } from './items/QuestionCard'
import { SystemNote } from './items/SystemNote'
import { UserMessage } from './items/UserMessage'
import { WorkLog } from './items/WorkLog'

const NO_ITEMS: ChatItem[] = []

const STATUS_LABEL: Record<string, string> = {
  busy: 'Working',
  waiting: 'Needs you',
  attention: 'Needs you',
  idle: 'Idle'
}

function Block({ block, chatId }: { block: RenderBlock; chatId: string }): React.JSX.Element {
  switch (block.type) {
    case 'user':
      return <UserMessage chatId={chatId} item={block.item} />
    case 'worklog':
      return (
        <WorkLog
          key={block.id}
          steps={block.steps}
          durationMs={block.durationMs}
          live={block.live}
        />
      )
    case 'assistant':
      return <AssistantText item={block.item} />
    case 'diff':
      return <EditDiff item={block.item} />
    case 'agent':
      return <AgentCard item={block.item} />
    case 'question':
      return <QuestionCard chatId={chatId} item={block.item} />
    case 'plan':
      return <PlanCard chatId={chatId} item={block.item} />
    case 'permission':
      return <PermissionCard chatId={chatId} item={block.item} />
    case 'system':
      return <SystemNote item={block.item} />
    case 'command':
      return <CommandChip item={block.item} />
  }
}

function blockKey(block: RenderBlock, index: number): string {
  return block.type === 'worklog' ? block.id : 'item' in block ? `${block.type}:${block.item.id}` : String(index)
}

export function ChatView({ chat }: { chat: ChatMeta }): React.JSX.Element {
  const items = useStore((s) => s.items[chat.chatId] ?? NO_ITEMS)
  const projectName = useStore(
    (s) =>
      s.projects.find((p) => p.projectKey === chat.projectKey)?.name ??
      s.projectView(chat.projectKey)?.name ??
      chat.projectKey
  )
  const projectPath = useStore(
    (s) => s.projects.find((p) => p.projectKey === chat.projectKey)?.basePath ?? chat.cwd
  )
  const card = useStore((s) => s.boards.cards.find((c) => c.id === chat.cardId))
  const setEditingCardId = useStore((s) => s.setEditingCardId)
  const openInTui = useStore((s) => s.openInTui)

  const blocks = useMemo(() => groupItems(items), [items])
  const messagesRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  const last = items[items.length - 1]
  const tail = last && (last.kind === 'assistant' ? last.markdown.length : last.id)

  useEffect(() => {
    stickRef.current = true
  }, [chat.chatId])

  useEffect(() => {
    const el = messagesRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [chat.chatId, blocks.length, tail])

  const tone = statusTone(chat)
  const external = chat.mode === 'external'
  const inTui = chat.mode === 'tui'
  const draft = !chat.started && items.length === 0

  return (
    <>
      {draft ? (
        <div className="chat-head">
          <span className="chat-title">New chat</span>
          <span className="pill">Draft</span>
          <span className="head-spacer" />
          <span className="head-meta">{projectName}</span>
        </div>
      ) : (
        <div className="chat-head">
          <span className="chat-title">{chat.title}</span>
          <span className={`pill ${tone}`}>
            {external ? (
              <Monitor className="i sm" strokeWidth={1.8} />
            ) : (
              <span className={`dot ${tone}`} />
            )}
            {external ? 'Running elsewhere' : inTui ? 'Running in TUI' : (STATUS_LABEL[tone] ?? tone)}
          </span>
          <span className="head-spacer" />
          {card && (
            <button
              type="button"
              className="head-chip"
              title="Open the linked card"
              onClick={() => setEditingCardId(card.id)}
            >
              <SquareKanban className="i sm" strokeWidth={1.8} />
              <span>{card.title}</span>
            </button>
          )}
          {chat.contextTokens ? (
            <span className="head-meta num" title="Tokens in the current context window">
              {formatTokens(chat.contextTokens)} tokens
            </span>
          ) : null}
          <span className="head-meta when">{formatRelativeTime(chat.updatedAt)}</span>
          {!external && !inTui && (
            <button
              type="button"
              className="ghost-btn"
              title="Continue this chat in the Claude Code terminal"
              onClick={() => void openInTui(chat.chatId).catch((e) => console.error(e))}
            >
              <Terminal className="i sm" strokeWidth={1.8} />
              <span className="lbl">Open in TUI</span>
            </button>
          )}
        </div>
      )}
      {draft ? (
        <div className="empty">
          <div>
            <h1>{`What should Claude work on in ${projectName}?`}</h1>
            <p>
              New chats run in <span className="path">{projectPath}</span> on its current branch, unless
              you turn on a new worktree or branch below.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="messages"
          ref={messagesRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
          }}
        >
          <div className="stream">
            {blocks.map((block, i) => (
              <Block key={blockKey(block, i)} block={block} chatId={chat.chatId} />
            ))}
          </div>
        </div>
      )}
      <div className="dock">
        <Composer chat={chat} />
        <WorkspaceBar chat={chat} />
      </div>
    </>
  )
}

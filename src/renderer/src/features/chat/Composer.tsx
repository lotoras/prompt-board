import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  ChevronDown,
  File as FileIcon,
  FilePen,
  FlaskConical,
  Hand,
  Image as ImageIcon,
  ListChecks,
  Monitor,
  Terminal,
  Paperclip,
  ShieldOff,
  Sparkles,
  Square,
  X
} from 'lucide-react'
import {
  PERMISSION_MODES,
  contextWindowFor,
  modelLabel,
  nextPermissionMode,
  permissionModeLabel
} from '../../../../shared/chat'
import type {
  ChatAttachment,
  ChatMeta,
  CodexLevel,
  PermissionModeId,
  SlashCommandInfo
} from '../../../../shared/types'
import { api } from '../../lib/api'
import { formatFileSize, formatTokens } from '../../lib/format'
import { EMPTY_DRAFT } from '../../store/chatsSlice'
import { useStore } from '../../store'
import { EffortPopover, EffortTicks, ModelPopover } from './popovers/pickers'
import { modelColor } from './popovers/pickerData'
import { Popover } from './popovers/Popover'
import { matchSlashCommands } from './slashMatch'

const NO_COMMANDS: SlashCommandInfo[] = []

const MODE_ICONS: Record<PermissionModeId, typeof Hand> = {
  default: Hand,
  acceptEdits: FilePen,
  plan: ListChecks,
  bypassPermissions: ShieldOff
}

const CODEX_LEVELS: { id: CodexLevel; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Claude does everything' },
  { id: 'tests', label: 'Tests', hint: 'Codex writes the failing tests first' },
  { id: 'full', label: 'Full', hint: 'Codex writes the tests and reviews the result' }
]

function Ring({ pct }: { pct: number }): React.JSX.Element {
  const r = 7
  const c = 2 * Math.PI * r
  const color = pct >= 85 ? 'var(--err)' : pct >= 60 ? 'var(--attention)' : 'var(--text-2)'
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <circle className="trk" cx="9" cy="9" r={r} fill="none" strokeWidth="2.2" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`}
      />
    </svg>
  )
}

export function AttachmentChip({
  attachment,
  onRemove
}: {
  attachment: Pick<ChatAttachment, 'name' | 'kind' | 'thumbDataUrl'> & { size?: number }
  onRemove?: () => void
}): React.JSX.Element {
  const Icon = attachment.kind === 'image' ? ImageIcon : FileIcon
  return (
    <span className="a-chip">
      <span
        className="thumb"
        style={attachment.thumbDataUrl ? { backgroundImage: `url(${attachment.thumbDataUrl})` } : undefined}
      >
        {!attachment.thumbDataUrl && <Icon className="i sm" strokeWidth={1.8} />}
      </span>
      {attachment.name}
      {attachment.size !== undefined && <span className="size">{formatFileSize(attachment.size)}</span>}
      {onRemove && (
        <button type="button" className="rm" aria-label={`Remove ${attachment.name}`} onClick={onRemove}>
          <X className="i sm" strokeWidth={1.8} />
        </button>
      )}
    </span>
  )
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function Composer({ chat }: { chat: ChatMeta }): React.JSX.Element {
  const { chatId } = chat
  const draft = useStore((s) => s.drafts[chatId] ?? EMPTY_DRAFT)
  const popover = useStore((s) => s.popover)
  const setPopover = useStore((s) => s.setPopover)
  const setDraftText = useStore((s) => s.setDraftText)
  const addAttachments = useStore((s) => s.addAttachments)
  const removeAttachment = useStore((s) => s.removeAttachment)
  const sendChat = useStore((s) => s.sendChat)
  const updateChat = useStore((s) => s.updateChat)
  const showToast = useStore((s) => s.showToast)
  const commands = useStore((s) => s.slashCommands[chatId] ?? NO_COMMANDS)
  const loadSlashCommands = useStore((s) => s.loadSlashCommands)

  const textRef = useRef<HTMLTextAreaElement>(null)
  // Popover anchors live in state (callback refs) so render never reads ref.current.
  const [modelEl, setModelEl] = useState<HTMLButtonElement | null>(null)
  const [effortEl, setEffortEl] = useState<HTMLButtonElement | null>(null)
  const [modeEl, setModeEl] = useState<HTMLButtonElement | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashClosed, setSlashClosed] = useState(false)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [sweep, setSweep] = useState(false)

  const external = chat.mode === 'external'
  const busy = chat.status === 'busy'
  const empty = !draft.text.trim() && draft.attachments.length === 0
  const slashMatch = /^\/(\S*)$/.exec(draft.text)
  const slashItems = slashMatch && !slashClosed ? matchSlashCommands(slashMatch[1], commands) : NO_COMMANDS
  const slashOpen = slashItems.length > 0
  const slashActive = Math.min(slashIndex, Math.max(0, slashItems.length - 1))

  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [draft.text, chat.mode])

  useEffect(() => () => setPopover(null), [chatId, setPopover])

  useEffect(() => {
    if (!sweep) return
    const t = setTimeout(() => setSweep(false), 950)
    return () => clearTimeout(t)
  }, [sweep])

  if (external || chat.mode === 'tui') {
    return (
      <div className="composer">
        <div className="readonly-note">
          {external ? (
            <Monitor className="i" strokeWidth={1.8} />
          ) : (
            <Terminal className="i" strokeWidth={1.8} />
          )}
          {external ? (
            <span>
              <b>This session runs in another terminal.</b> It updates here live, and you can
              continue it here once it ends.
            </span>
          ) : (
            <span>
              <b>This chat continues in the terminal below.</b> It updates here live and comes back
              to this composer when you exit the TUI.
            </span>
          )}
        </div>
      </div>
    )
  }

  const attach = (list: ChatAttachment[]): void => {
    if (list.length === 0) return
    addAttachments(chatId, list)
    showToast(`${list.length} ${list.length === 1 ? 'file' : 'files'} attached`)
  }

  const onPick = (): void => {
    void api.attachments.pick().then(attach).catch((e) => console.error(e))
  }

  const onPaste = (e: React.ClipboardEvent): void => {
    const images = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    e.preventDefault()
    void Promise.all(
      images.map(async (file) => api.attachments.saveImage(await readAsDataUrl(file), file.name))
    )
      .then(attach)
      .catch((err) => console.error(err))
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const paths = Array.from(e.dataTransfer?.files ?? [])
      .map((f) => api.pty.getPathForFile(f))
      .filter((p) => p)
    if (paths.length === 0) return
    void api.attachments.describe(paths).then(attach).catch((err) => console.error(err))
  }

  const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')

  const send = (interrupt = false): void => {
    if (!empty) void sendChat(chatId, interrupt ? { interrupt: true } : undefined)
  }

  const insertCommand = (name: string): void => {
    setDraftText(chatId, `/${name} `)
    textRef.current?.focus()
  }

  const cycleMode = (): void => updateChat(chatId, { permissionMode: nextPermissionMode(chat.permissionMode) })
  const ModeIcon = MODE_ICONS[chat.permissionMode] ?? ShieldOff

  const window_ = chat.contextWindow ?? contextWindowFor(chat.model)
  const pct = chat.contextTokens
    ? Math.min(100, Math.round((chat.contextTokens / window_) * 100))
    : 0
  const started = chat.started

  return (
    <div
      className={`composer${chat.toggles.ultra ? ' ultra' : ''}${sweep ? ' sweep' : ''}${dragging ? ' drag' : ''}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault()
      }}
      onDragLeave={() => {
        dragDepth.current -= 1
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragging(false)
        }
      }}
      onDrop={onDrop}
    >
      <div className="drop-hint">Drop files to attach them</div>
      <div className="att-row">
        {draft.attachments.map((a) => (
          <AttachmentChip key={a.path} attachment={a} onRemove={() => removeAttachment(chatId, a.path)} />
        ))}
      </div>
      <textarea
        ref={textRef}
        rows={1}
        value={draft.text}
        placeholder={
          busy ? 'Queue a follow-up for when Claude finishes' : 'Ask Claude to build, fix or explain something'
        }
        onChange={(e) => {
          const value = e.target.value
          setDraftText(chatId, value)
          setSlashIndex(0)
          setSlashClosed(false)
          if (value.startsWith('/')) void loadSlashCommands(chatId)
        }}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (slashOpen) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const step = e.key === 'ArrowDown' ? 1 : -1
              setSlashIndex((slashActive + step + slashItems.length) % slashItems.length)
              return
            }
            if ((e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey)) {
              e.preventDefault()
              insertCommand(slashItems[slashActive].name)
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setSlashClosed(true)
              return
            }
          }
          if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault()
            cycleMode()
            return
          }
          if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault()
            send(busy)
            return
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      {slashOpen && (
        <div className="slash-list" role="listbox" aria-label="Commands">
          {slashItems.map((c, i) => (
            <button
              key={c.name}
              type="button"
              role="option"
              aria-selected={i === slashActive}
              className={`pop-item${i === slashActive ? ' kb' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertCommand(c.name)}
            >
              <span className="pi-main">
                <div>
                  <span className="sl-name">{`/${c.name}`}</span>
                  {c.argumentHint && <span className="sl-hint">{c.argumentHint}</span>}
                </div>
                {c.description && <div className="pi-desc">{c.description}</div>}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="controls">
        <button
          type="button"
          className="ctl icon"
          title="Attach files (or drop / paste them)"
          aria-label="Attach files"
          onClick={onPick}
        >
          <Paperclip className="i" strokeWidth={1.8} />
        </button>
        <span className="sep" />
        <button
          ref={setModeEl}
          type="button"
          className={`ctl${chat.permissionMode === 'plan' ? ' mode-plan' : ''}`}
          title="Permission mode (Shift+Tab)"
          aria-label="Permission mode"
          onClick={() => setPopover(popover === 'mode' ? null : 'mode')}
        >
          <ModeIcon className="i sm" strokeWidth={1.8} />
          <span>{permissionModeLabel(chat.permissionMode)}</span>
          <ChevronDown className="i sm" strokeWidth={1.8} />
        </button>
        <button
          ref={setModelEl}
          type="button"
          className="ctl"
          title="Model (Ctrl+Shift+M)"
          onClick={() => setPopover(popover === 'model' ? null : 'model')}
        >
          <span className="mdot" style={{ background: modelColor(chat.model) }} />
          {modelLabel(chat.model)}
          <ChevronDown className="i sm" strokeWidth={1.8} />
        </button>
        <button
          ref={setEffortEl}
          type="button"
          className="ctl"
          title="Effort (Ctrl+Shift+E)"
          onClick={() => setPopover(popover === 'effort' ? null : 'effort')}
        >
          <EffortTicks effort={chat.effort} />
          <span>{chat.effort}</span>
          <ChevronDown className="i sm" strokeWidth={1.8} />
        </button>
        <span className="sep" />
        <span className="seg-wrap" title="Codex: Off, Tests (Codex writes the failing tests first) or Full (tests plus a Codex review)">
          <FlaskConical className="i sm" strokeWidth={1.8} />
          <span className="seg-lbl">Codex</span>
          <span
            className={`seg${chat.toggles.codex !== 'off' ? ' lit' : ''}`}
            role="radiogroup"
            aria-label="Codex"
          >
            {CODEX_LEVELS.map((lv) => (
              <button
                key={lv.id}
                type="button"
                role="radio"
                aria-checked={chat.toggles.codex === lv.id}
                className={chat.toggles.codex === lv.id ? 'on' : ''}
                title={lv.hint}
                onClick={() => updateChat(chatId, { toggles: { ...chat.toggles, codex: lv.id } })}
              >
                {lv.label}
              </button>
            ))}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={chat.toggles.ultra}
          className={`ctl${chat.toggles.ultra ? ' ultra-on on' : ''}`}
          title="Ultra: think harder and split the work across subagents"
          onClick={() => {
            const ultra = !chat.toggles.ultra
            if (ultra) setSweep(true)
            updateChat(chatId, { toggles: { ...chat.toggles, ultra } })
          }}
        >
          <Sparkles className="i sm" strokeWidth={1.8} />
          <span>Ultra</span>
          <span className="sw" />
        </button>
        <span className="grow" />
        <span
          className="ctx"
          title={`${formatTokens(chat.contextTokens)} of ${formatTokens(window_)} context tokens used`}
        >
          <Ring pct={pct} />
          <span className="num">{pct}%</span>
        </span>
        {busy && !empty && (
          <button
            type="button"
            className="send stop"
            title="Stop and send (Ctrl+Enter)"
            aria-label="Stop and send"
            onClick={() => send(true)}
          >
            <Square className="i sm" strokeWidth={1.8} style={{ fill: 'currentColor' }} />
          </button>
        )}
        {busy && empty ? (
          <button
            type="button"
            className="send stop"
            title="Stop (Esc)"
            aria-label="Stop"
            onClick={() => void api.chat.interrupt(chatId)}
          >
            <Square className="i sm" strokeWidth={1.8} style={{ fill: 'currentColor' }} />
          </button>
        ) : (
          <button
            type="button"
            className="send"
            title="Send (Enter)"
            aria-label="Send"
            disabled={empty}
            onClick={() => send()}
          >
            <ArrowUp className="i sm" strokeWidth={1.8} />
          </button>
        )}
      </div>
      {popover === 'mode' && (
        <Popover anchor={modeEl} onClose={() => setPopover(null)}>
          {PERMISSION_MODES.map((m) => {
            const Icon = MODE_ICONS[m.id]
            return (
              <button
                key={m.id}
                type="button"
                role="menuitem"
                className={`pop-item${chat.permissionMode === m.id ? ' sel' : ''}`}
                onClick={() => {
                  updateChat(chatId, { permissionMode: m.id })
                  setPopover(null)
                  showToast(`${m.label}${started ? ' from the next message' : ''}`)
                }}
              >
                <Icon className="i sm" strokeWidth={1.8} />
                <span className="pi-main">
                  <div>{m.label}</div>
                  <div className="pi-desc">{m.description}</div>
                </span>
                <span className="check">
                  <Check className="i sm" strokeWidth={1.8} />
                </span>
              </button>
            )
          })}
          <div className="pop-foot">Shift+Tab cycles the mode.</div>
        </Popover>
      )}
      {popover === 'model' && (
        <ModelPopover
          anchor={modelEl}
          started={started}
          current={chat.model}
          onClose={() => setPopover(null)}
          onPick={(model) => {
            updateChat(chatId, { model })
            setPopover(null)
            showToast(`${modelLabel(model)}${started ? ' from the next message' : ''}`)
          }}
        />
      )}
      {popover === 'effort' && (
        <EffortPopover
          anchor={effortEl}
          started={started}
          current={chat.effort}
          onClose={() => setPopover(null)}
          onPick={(effort) => {
            updateChat(chatId, { effort })
            setPopover(null)
            showToast(`Effort ${effort}${started ? ' from the next message' : ''}`)
          }}
        />
      )}
    </div>
  )
}

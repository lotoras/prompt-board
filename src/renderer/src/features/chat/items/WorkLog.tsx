import { useState } from 'react'
import {
  Bot,
  ChevronRight,
  File as FileIcon,
  ListChecks,
  Pencil,
  Search,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Terminal
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { formatDuration } from '../../../lib/format'
import type { StepItem } from '../groupItems'

const TOOL_META: Record<string, { icon: LucideIcon; verb: string }> = {
  Read: { icon: FileIcon, verb: 'Read' },
  Grep: { icon: Search, verb: 'Searched' },
  Glob: { icon: Search, verb: 'Searched' },
  WebSearch: { icon: Search, verb: 'Searched' },
  WebFetch: { icon: Search, verb: 'Fetched' },
  Bash: { icon: Terminal, verb: 'Ran' },
  PowerShell: { icon: Terminal, verb: 'Ran' },
  Edit: { icon: Pencil, verb: 'Edited' },
  MultiEdit: { icon: Pencil, verb: 'Edited' },
  NotebookEdit: { icon: Pencil, verb: 'Edited' },
  Write: { icon: Pencil, verb: 'Wrote' },
  Skill: { icon: Sparkles, verb: 'Skill' },
  TodoWrite: { icon: ListChecks, verb: 'Planned' }
}

function Step({ step, fresh }: { step: StepItem; fresh: boolean }): React.JSX.Element {
  let Icon: LucideIcon
  let verb: string
  let target: string
  let meta: React.ReactNode = null
  let metaClass = ''

  if (step.kind === 'agent') {
    Icon = Bot
    verb = 'Agent'
    target = `${step.agentType}: ${step.description}`
    const text = step.toolCount !== undefined ? `${step.toolCount} tools` : (step.result ?? '')
    meta = text || null
  } else if (step.kind === 'thinking') {
    Icon = Sparkles
    verb = 'Thought'
    target = step.text.trim().split('\n')[0].slice(0, 100)
  } else {
    const known = TOOL_META[step.name]
    Icon = known?.icon ?? Terminal
    verb = known?.verb ?? step.name
    target = step.summary
    if (step.diff) {
      meta = (
        <>
          <span className="add">+{step.diff.added}</span>{' '}
          <span className="del">−{step.diff.removed}</span>
        </>
      )
    } else if (step.result) {
      meta = step.result
      metaClass = step.status === 'error' ? ' err' : step.status === 'ok' ? ' ok' : ''
    }
  }

  return (
    <div className={`wl-step${fresh ? ' fresh' : ''}`}>
      <Icon className="i sm" strokeWidth={1.8} />
      <span className="verb">{verb}</span>
      <span className="target">{target}</span>
      {step.kind === 'tool' && step.approval && <ApprovalMark approval={step.approval} />}
      {meta && <span className={`meta${metaClass}`}>{meta}</span>}
    </div>
  )
}

/** Shield next to a tool step that went through a permission card. */
function ApprovalMark({ approval }: { approval: 'allowed' | 'always' | 'denied' }): React.JSX.Element {
  const denied = approval === 'denied'
  const label = denied ? 'You denied this' : approval === 'always' ? 'Allowed for this chat' : 'You allowed this'
  const Mark = denied ? ShieldX : ShieldCheck
  return (
    <span className={`approval${denied ? ' denied' : ''}`} title={label} aria-label={label}>
      <Mark className="i sm" strokeWidth={1.8} />
    </span>
  )
}

interface WorkLogProps {
  steps: StepItem[]
  durationMs?: number
  live: boolean
}

export function WorkLog({ steps, durationMs, live }: WorkLogProps): React.JSX.Element {
  const [open, setOpen] = useState(live)
  const count = steps.length
  return (
    <div className={`worklog${open ? ' open' : ''}`}>
      <button type="button" className="wl-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {live ? (
          <>
            <span className="spin" />
            <span>Working</span>
            <span className="steps num">{count} steps so far</span>
          </>
        ) : (
          <>
            <ChevronRight className="i sm chev" strokeWidth={1.8} />
            <span>
              {durationMs !== undefined ? `Worked for ${formatDuration(durationMs)}` : 'Worked'}
            </span>
            <span className="steps num">
              {count} {count === 1 ? 'step' : 'steps'}
            </span>
          </>
        )}
      </button>
      <div className="wl-list">
        {steps.map((step) => (
          <Step key={step.id} step={step} fresh={live} />
        ))}
      </div>
    </div>
  )
}

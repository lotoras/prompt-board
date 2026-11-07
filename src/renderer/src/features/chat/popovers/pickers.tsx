import { Check, GitBranch } from 'lucide-react'
import { EFFORT_LEVELS, MODEL_OPTIONS } from '../../../../../shared/chat'
import type { EffortLevel } from '../../../../../shared/types'
import { Popover } from './Popover'
import { EFFORT_DESCRIPTIONS, modelColor } from './pickerData'

export function EffortTicks({ effort }: { effort: EffortLevel }): React.JSX.Element {
  const idx = EFFORT_LEVELS.indexOf(effort)
  return (
    <span className="ticks" aria-hidden="true" style={{ color: `var(--e-${effort})` }}>
      {EFFORT_LEVELS.map((level, i) => (
        <i key={level} className={i <= idx ? '' : 'off'} />
      ))}
    </span>
  )
}

interface PickerProps {
  anchor: HTMLElement | null
  started: boolean
  onClose: () => void
}

const foot = (started: boolean): string =>
  started ? 'Applies from your next message.' : 'Used when the chat starts.'

export function ModelPopover({
  anchor,
  started,
  current,
  onPick,
  onClose
}: PickerProps & { current: string; onPick: (id: string) => void }): React.JSX.Element {
  return (
    <Popover anchor={anchor} onClose={onClose}>
      {MODEL_OPTIONS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="menuitem"
          className={`pop-item${current === m.id ? ' sel' : ''}`}
          onClick={() => onPick(m.id)}
        >
          <span className="mdot" style={{ background: modelColor(m.id) }} />
          <span className="pi-main">
            <div>{m.name}</div>
            <div className="pi-desc">{m.description}</div>
          </span>
          <span className="check">
            <Check className="i sm" strokeWidth={1.8} />
          </span>
        </button>
      ))}
      <div className="pop-foot">{foot(started)}</div>
    </Popover>
  )
}

export function EffortPopover({
  anchor,
  started,
  current,
  onPick,
  onClose
}: PickerProps & { current: EffortLevel; onPick: (e: EffortLevel) => void }): React.JSX.Element {
  return (
    <Popover anchor={anchor} onClose={onClose}>
      {EFFORT_LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          role="menuitem"
          className={`pop-item${current === level ? ' sel' : ''}`}
          onClick={() => onPick(level)}
        >
          <EffortTicks effort={level} />
          <span className="pi-main">
            <div>{level}</div>
            <div className="pi-desc">{EFFORT_DESCRIPTIONS[level]}</div>
          </span>
          <span className="check">
            <Check className="i sm" strokeWidth={1.8} />
          </span>
        </button>
      ))}
      <div className="pop-foot">{foot(started)}</div>
    </Popover>
  )
}

export function BasePopover({
  anchor,
  branches,
  current,
  onPick,
  onClose
}: {
  anchor: HTMLElement | null
  branches: string[]
  current: string
  onPick: (branch: string) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <Popover anchor={anchor} onClose={onClose}>
      {branches.map((b, i) => (
        <button
          key={b}
          type="button"
          role="menuitem"
          className={`pop-item${current === b ? ' sel' : ''}`}
          onClick={() => onPick(b)}
        >
          <GitBranch className="i sm" strokeWidth={1.8} />
          <span className="pi-main mono" style={{ fontSize: 12 }}>
            {b}
          </span>
          {i === 0 && <span className="pi-desc">current</span>}
          <span className="check">
            <Check className="i sm" strokeWidth={1.8} />
          </span>
        </button>
      ))}
    </Popover>
  )
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface PopoverProps {
  anchor: HTMLElement | null
  onClose: () => void
  children: React.ReactNode
}

export function Popover({ anchor, onClose, children }: PopoverProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const pop = ref.current
    if (!pop || !anchor) return
    const r = anchor.getBoundingClientRect()
    const pr = pop.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - pr.width - 8))
    const top = r.top - pr.height - 6 > 8 ? r.top - pr.height - 6 : r.bottom + 6
    setPos({ left, top })
    pop.querySelector<HTMLElement>('.sel')?.focus()
  }, [anchor])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchor?.contains(target)) return
      onClose()
    }
    // Esc closes the popover (capture phase, so it wins over the global Esc handling).
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  return (
    <div
      ref={ref}
      className="pop"
      role="menu"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {children}
    </div>
  )
}

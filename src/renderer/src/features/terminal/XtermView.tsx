import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api } from '../../lib/api'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'

interface XtermViewProps {
  ptyId: string
  visible: boolean
}

const XTERM_THEME = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#58a6ff',
  selectionBackground: 'rgba(88, 166, 255, 0.3)'
}

export function XtermView({ ptyId, visible }: XtermViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wasVisibleRef = useRef(visible)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      scrollback: 5000,
      convertEol: true,
      theme: XTERM_THEME,
      fontSize: 13
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon

    const unsubData = api.pty.onData(({ ptyId: id, data }) => {
      if (id === ptyId) term.write(data)
    })
    const unsubExit = api.pty.onExit(({ ptyId: id, exitCode }) => {
      if (id !== ptyId) return
      term.write(`\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`)
    })

    const dataDisposable = term.onData((data) => {
      api.pty.write(ptyId, data)
    })

    let resizeTimeout: ReturnType<typeof setTimeout> | undefined
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        fitAddon.fit()
        api.pty.resize(ptyId, term.cols, term.rows)
      }, 100)
    })
    resizeObserver.observe(container)

    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeObserver.disconnect()
      dataDisposable.dispose()
      unsubData()
      unsubExit()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [ptyId])

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      fitRef.current?.fit()
      const term = termRef.current
      if (term) {
        api.pty.resize(ptyId, term.cols, term.rows)
      }
    }
    wasVisibleRef.current = visible
  }, [visible, ptyId])

  return (
    <div
      className="xterm-view"
      style={{ display: visible ? 'block' : 'none' }}
      ref={containerRef}
    />
  )
}

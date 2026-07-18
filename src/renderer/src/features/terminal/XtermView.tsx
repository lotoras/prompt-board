import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api } from '../../lib/api'
import { formatDroppedPaths } from './formatDroppedPaths'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'

interface XtermViewProps {
  ptyId: string
  visible: boolean
}

const XTERM_THEME = {
  background: '#0C0C0C',
  foreground: '#CCCCCC',
  cursor: '#FFFFFF',
  cursorAccent: '#0C0C0C',
  selectionBackground: 'rgba(255,255,255,0.28)',
  black: '#0C0C0C',
  red: '#C50F1F',
  green: '#13A10E',
  yellow: '#C19C00',
  blue: '#0037DA',
  magenta: '#881798',
  cyan: '#3A96DD',
  white: '#CCCCCC',
  brightBlack: '#767676',
  brightRed: '#E74856',
  brightGreen: '#16C60C',
  brightYellow: '#F9F1A5',
  brightBlue: '#3B78FF',
  brightMagenta: '#B4009E',
  brightCyan: '#61D6D6',
  brightWhite: '#F2F2F2'
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
      theme: XTERM_THEME,
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
      fontSize: 13,
      cursorStyle: 'bar',
      cursorBlink: true,
      scrollSensitivity: 1
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)

    let disposed = false
    let replayed = false

    const fitSafely = (): void => {
      if (container.clientWidth > 0 && container.clientHeight > 0) fitAddon.fit()
    }
    fitSafely()

    term.attachCustomWheelEventHandler((ev) => {
      if (ev.deltaY === 0) return true
      // Let the hosted app own scrolling when it runs a full-screen TUI (alternate
      // buffer) or has enabled mouse tracking (Claude Code does): forward the wheel
      // so it scrolls its transcript. Only for a bare shell (normal buffer, no mouse
      // tracking) do we scroll xterm's own scrollback.
      if (term.buffer.active.type === 'alternate' || term.modes.mouseTrackingMode !== 'none') {
        return true
      }
      const factor = ev.deltaMode === 1 ? 1 : 1 / 40
      const amount = Math.sign(ev.deltaY) * Math.max(1, Math.round(Math.abs(ev.deltaY) * factor))
      term.scrollLines(amount)
      return false
    })

    const onContextMenu = async (e: MouseEvent): Promise<void> => {
      e.preventDefault()
      if (term.hasSelection()) {
        await api.clipboard.writeText(term.getSelection())
        term.clearSelection()
      } else {
        const text = await api.clipboard.readText()
        if (text) {
          const normalized = text.replace(/\r\n/g, '\n')
          api.pty.write(ptyId, `\x1b[200~${normalized}\x1b[201~`)
        }
      }
    }
    container.addEventListener('contextmenu', onContextMenu)

    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      const paths = Array.from(files)
        .map((f) => api.pty.getPathForFile(f))
        .filter((p) => p.length > 0)
      if (paths.length === 0) return
      api.pty.write(ptyId, formatDroppedPaths(paths))
      term.focus()
    }
    container.addEventListener('dragover', onDragOver)
    container.addEventListener('drop', onDrop)

    termRef.current = term
    fitRef.current = fitAddon

    const unsubData = api.pty.onData(({ ptyId: id, data, replay }) => {
      if (id !== ptyId || disposed) return
      if (replay) {
        term.write(data)
        replayed = true
        return
      }
      if (!replayed) return
      term.write(data)
    })
    const unsubExit = api.pty.onExit(({ ptyId: id, exitCode }) => {
      if (id !== ptyId || disposed) return
      term.write(`\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`)
    })

    const dataDisposable = term.onData((data) => {
      api.pty.write(ptyId, data)
    })

    let resizeTimeout: ReturnType<typeof setTimeout> | undefined
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        fitSafely()
        api.pty.resize(ptyId, term.cols, term.rows)
      }, 100)
    })
    resizeObserver.observe(container)

    void api.pty.attach(ptyId)

    return () => {
      disposed = true
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeObserver.disconnect()
      dataDisposable.dispose()
      unsubData()
      unsubExit()
      container.removeEventListener('contextmenu', onContextMenu)
      container.removeEventListener('dragover', onDragOver)
      container.removeEventListener('drop', onDrop)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [ptyId])

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      const container = containerRef.current
      if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        fitRef.current?.fit()
      }
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

import { BrowserWindow, screen } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayGeom {
  winBounds: Rect
  displayBounds: Rect
  workArea: Rect
  maximized: boolean
  fullscreen: boolean
}

export function bottomInsetFor(g: DisplayGeom): number {
  const EPS = 4
  const AUTOHIDE_FALLBACK = 48
  if (!g.maximized && !g.fullscreen) return 0
  const displayBottom = g.displayBounds.y + g.displayBounds.height
  const workBottom = g.workArea.y + g.workArea.height
  const windowBottom = g.winBounds.y + g.winBounds.height
  if (windowBottom < displayBottom - EPS) return 0
  const visibleBottomTaskbar = displayBottom - workBottom
  if (visibleBottomTaskbar > EPS) return visibleBottomTaskbar
  const sideOrTopTaskbar =
    g.workArea.x > g.displayBounds.x + EPS ||
    g.workArea.y > g.displayBounds.y + EPS ||
    g.workArea.width < g.displayBounds.width - EPS
  if (sideOrTopTaskbar) return 0
  return AUTOHIDE_FALLBACK
}

export function computeBottomInset(win: BrowserWindow): number {
  const winBounds = win.getBounds()
  const display = screen.getDisplayMatching(winBounds)
  return bottomInsetFor({
    winBounds,
    displayBounds: display.bounds,
    workArea: display.workArea,
    maximized: win.isMaximized(),
    fullscreen: win.isFullScreen()
  })
}

export function attachWindowInset(win: BrowserWindow): void {
  let last = -1

  const emit = (): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    const inset = computeBottomInset(win)
    if (inset === last) return
    last = inset
    win.webContents.send(IPC_CHANNELS.window.insetChanged, inset)
  }

  let resizeTimeout: ReturnType<typeof setTimeout> | undefined
  win.on('resize', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout)
    resizeTimeout = setTimeout(emit, 100)
  })

  win.on('maximize', emit)
  win.on('unmaximize', emit)
  win.on('enter-full-screen', emit)
  win.on('leave-full-screen', emit)
  win.once('ready-to-show', emit)

  win.on('closed', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout)
    last = -1
  })
}

import { describe, expect, it } from 'vitest'
import { bottomInsetFor } from '../../src/main/window/inset'

const display = { x: 0, y: 0, width: 1920, height: 1080 }

describe('bottomInsetFor', () => {
  it('returns 0 when not maximized and not fullscreen', () => {
    const inset = bottomInsetFor({
      winBounds: { x: 0, y: 0, width: 800, height: 600 },
      displayBounds: display,
      workArea: display,
      maximized: false,
      fullscreen: false
    })
    expect(inset).toBe(0)
  })

  it('returns 0 when maximized window sits above the taskbar', () => {
    const inset = bottomInsetFor({
      winBounds: { x: 0, y: 0, width: 1920, height: 1040 },
      displayBounds: display,
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      maximized: true,
      fullscreen: false
    })
    expect(inset).toBe(0)
  })

  it('returns the taskbar height for a visible bottom taskbar', () => {
    const inset = bottomInsetFor({
      winBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      displayBounds: display,
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      maximized: true,
      fullscreen: false
    })
    expect(inset).toBe(40)
  })

  it('returns 48 for an auto-hide bottom taskbar', () => {
    const inset = bottomInsetFor({
      winBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      displayBounds: display,
      workArea: display,
      maximized: true,
      fullscreen: false
    })
    expect(inset).toBe(48)
  })

  it('returns 0 for a side taskbar', () => {
    const inset = bottomInsetFor({
      winBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      displayBounds: display,
      workArea: { x: 60, y: 0, width: 1860, height: 1080 },
      maximized: true,
      fullscreen: false
    })
    expect(inset).toBe(0)
  })

  it('returns 48 for fullscreen with an auto-hide bottom taskbar', () => {
    const inset = bottomInsetFor({
      winBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      displayBounds: display,
      workArea: display,
      maximized: false,
      fullscreen: true
    })
    expect(inset).toBe(48)
  })
})

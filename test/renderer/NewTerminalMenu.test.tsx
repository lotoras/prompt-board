// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NewTerminalMenu } from '../../src/renderer/src/features/terminal/NewTerminalMenu'

describe('NewTerminalMenu', () => {
  afterEach(() => cleanup())

  it('renders a button for each Claude account', () => {
    render(<NewTerminalMenu x={0} y={0} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Claude 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Claude 2' })).toBeTruthy()
  })

  it('calls onPick(2) when Claude 2 is clicked', () => {
    const onPick = vi.fn()
    render(<NewTerminalMenu x={0} y={0} onPick={onPick} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Claude 2' }))
    expect(onPick).toHaveBeenCalledWith(2)
  })

  it('calls onClose on backdrop click but not on menu click', () => {
    const onClose = vi.fn()
    const { container } = render(
      <NewTerminalMenu x={5} y={6} onPick={vi.fn()} onClose={onClose} />
    )
    fireEvent.click(container.querySelector('.terminal-reload-menu') as Element)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.terminal-reload-menu__backdrop') as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

import { Component } from 'react'
import type { ReactNode } from 'react'

interface TerminalErrorBoundaryProps {
  children: ReactNode
}

interface TerminalErrorBoundaryState {
  hasError: boolean
}

export class TerminalErrorBoundary extends Component<
  TerminalErrorBoundaryProps,
  TerminalErrorBoundaryState
> {
  state: TerminalErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): TerminalErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('Terminal view crashed:', error)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <div className="terminal-pane__empty">Terminal view crashed.</div>
    }
    return this.props.children
  }
}

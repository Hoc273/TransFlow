import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

/** Outer crash boundary for unexpected render errors (09b A.5.4). */
export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[GlobalErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-bg-app)] px-4 text-center">
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Something went wrong
          </h1>
          <p className="max-w-md text-sm text-[var(--color-text-secondary)]">
            An unexpected error occurred. Reload the page to continue.
          </p>
          <button
            type="button"
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

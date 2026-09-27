import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import i18n from '@/i18n'

type Props = {
  children: ReactNode
  /** Workspace home for recovery link. */
  workspaceId?: string
}

type State = { hasError: boolean }

/** Per-route boundary so one screen crash does not take down shell (09b A.5.4). */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[RouteErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      const home = this.props.workspaceId ? `/w/${this.props.workspaceId}` : '/'
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8 text-center">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            {i18n.t('common:errorBoundary.routeTitle')}
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {i18n.t('common:errorBoundary.routeDesc')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm"
              onClick={() => this.setState({ hasError: false })}
            >
              {i18n.t('common:errorBoundary.tryAgain')}
            </button>
            <Link
              to={home}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white no-underline"
              onClick={() => this.setState({ hasError: false })}
            >
              {i18n.t('common:errorBoundary.dashboard')}
            </Link>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

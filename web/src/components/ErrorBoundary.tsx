import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../i18n'

/** Last line of defence: an unexpected render error shows a recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Local console only: nothing is sent anywhere.
    console.error('Unexpected error', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main role="alert" className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">{t('Something went wrong')}</h1>
        <p className="text-sm text-neutral-400">{t('The app hit an unexpected error. Reloading usually fixes it; your session is kept.')}</p>
        <button type="button" className="btn-primary" onClick={() => location.reload()}>
          {t('Reload')}
        </button>
      </main>
    )
  }
}

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../i18n'

interface Props {
  children: ReactNode
  /** "app": the last line of defence, a whole screen. "page": inside the layout, so the rest of the app (and the music) keeps going. */
  scope?: 'app' | 'page'
  /** When this changes (the person went to another page), a page that had failed is tried again. */
  resetKey?: string
}

/** An unexpected render error shows a recovery message instead of a blank page. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Local console only: nothing is sent anywhere.
    console.error('Unexpected error', error, info.componentStack)
  }

  componentDidUpdate(before: Props) {
    if (this.state.failed && before.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    const page = this.props.scope === 'page'
    return (
      <div role="alert" className={`mx-auto flex max-w-md flex-col items-center justify-center gap-4 px-4 text-center ${page ? 'py-24' : 'min-h-screen'}`}>
        <h1 className="text-xl font-semibold">{t('Something went wrong')}</h1>
        <p className="text-sm text-neutral-400">{t('The app hit an unexpected error. Reloading usually fixes it; your session is kept.')}</p>
        <div className="flex gap-2">
          {page && (
            <button type="button" className="btn" onClick={() => this.setState({ failed: false })}>
              {t('Try again')}
            </button>
          )}
          <button type="button" className="btn-primary" onClick={() => location.reload()}>
            {t('Reload')}
          </button>
        </div>
      </div>
    )
  }
}

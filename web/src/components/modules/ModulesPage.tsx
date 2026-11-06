import { lazy, Suspense, useEffect } from 'react'
import type { Session } from '../../core'
import { t, tr } from '../../i18n'
import { StateMessage } from '../StateMessage'
import type { Navigate, ModuleKey, Route } from '../route'
import { useModules } from './ModulesProvider'

const ChannelsPage = lazy(() => import('./channels/ChannelsPage').then((m) => ({ default: m.ChannelsPage })))
const MatchPage = lazy(() => import('./match/MatchPage').then((m) => ({ default: m.MatchPage })))

const MODULE_TEXT: Record<ModuleKey, { title: string; description: string; action: string }> = {
  channels: {
    title: tr('Retro TV'),
    description: tr('Channels made from your own library, with a guide: a marathon of one anime, Saturdays of Marvel, horror at midnight. Tune in and it is already running, at the right minute.'),
    action: tr('Open the channels'),
  },
  match: {
    title: tr('Match'),
    description: tr('Swipe films with someone, each on your own phone, until you agree on one. Then press play.'),
    action: tr('Start a Match'),
  },
}

/**
 * The page of extra modules: what the modules container offers, as cards. Each module opens in its own page below it. This page only
 * exists when a modules container answered; without one the address leads back to the main page.
 */
export function ModulesPage({
  session,
  module,
  join,
  go,
  back,
  homeRoute,
}: {
  session: Session
  module?: ModuleKey
  /** The code in an invitation link: Match joins that room. */
  join?: string
  go: Navigate
  back: (fallback: Route) => void
  homeRoute: Route
}) {
  const { state } = useModules()

  if (state.status === 'checking') {
    return (
      <p role="status" className="py-24 text-center text-neutral-400">
        {t('Loading…')}
      </p>
    )
  }
  if (state.status === 'incompatible') {
    return (
      <StateMessage kind="error" message={t('The modules container (version {version}) and this app do not speak the same version. Update both to the latest release.', { version: state.version || '?' })}>
        <button type="button" className="btn" onClick={() => back(homeRoute)}>
          {t('Back')}
        </button>
      </StateMessage>
    )
  }
  if (state.status !== 'ready') return <Gone go={go} homeRoute={homeRoute} />

  const on = state.manifest.modules.filter((m) => m.id in MODULE_TEXT)

  if (module) {
    const info = on.find((m) => m.id === module)
    if (!info) {
      return (
        <StateMessage kind="empty" message={t('That module is not turned on in the modules container.')}>
          <button type="button" className="btn" onClick={() => go({ page: 'modules' })}>
            {t('Modules')}
          </button>
        </StateMessage>
      )
    }
    return (
      <div className="mx-auto max-w-6xl space-y-5 py-6">
        <div className="flex items-center gap-3">
          <button type="button" className="btn-ghost !px-3" onClick={() => go({ page: 'modules' })}>
            ← {t('Modules')}
          </button>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t(MODULE_TEXT[module].title)}</h1>
        </div>
        <Suspense fallback={<p role="status" className="py-16 text-center text-neutral-400">{t('Loading…')}</p>}>
          {module === 'channels' && <ChannelsPage session={session} go={go} />}
          {module === 'match' && <MatchPage session={session} go={go} join={join} />}
        </Suspense>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t('Modules')}</h1>
        <p className="mt-1 text-sm text-neutral-400">{t('Extras that run on your own modules container. Nothing here changes the rest of the app.')}</p>
      </header>
      {on.length === 0 ? (
        <StateMessage kind="empty" message={t('No module is turned on. Turn them on in the modules container (JELLYFLIX_MODULES).')} size="section" />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {on.map((m) => {
            const text = MODULE_TEXT[m.id as ModuleKey]
            return (
              <li key={m.id} className="glass flex flex-col gap-3 rounded-2xl p-5">
                <h2 className="text-lg font-semibold text-white">{t(text.title)}</h2>
                <p className="flex-1 text-sm leading-relaxed text-neutral-400">{t(text.description)}</p>
                {m.state !== 'ready' && <p className="text-xs text-amber-300">{m.detail ?? t('This module needs setup.')}</p>}
                <div>
                  <button type="button" className="btn-primary" onClick={() => go({ page: 'modules', module: m.id as ModuleKey })}>
                    {t(text.action)}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** The modules container is not there (any more): back to the main page. */
function Gone({ go, homeRoute }: { go: Navigate; homeRoute: Route }) {
  useEffect(() => {
    go(homeRoute, { replace: true })
  }, [go, homeRoute])
  return null
}

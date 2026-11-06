import { joinLink } from '../../../core/modules'
import { t } from '../../../i18n'
import { showToast } from '../../toast'
import { useModulesClient } from '../ModulesProvider'
import { QrCode } from './QrCode'

/**
 * How the other people get into the room: a QR code to read with a phone (it opens Jellyflix on the phone and joins by itself), the link
 * to send, and the code to type. Shown while somebody is yet to join, and on the screen that started the Match.
 */
export function InviteBox({ code, large = false }: { code: string; large?: boolean }) {
  const { client } = useModulesClient()
  const link = joinLink({ origin: window.location.origin, pathname: window.location.pathname }, client.baseUrl, code)
  const canShare = typeof navigator.share === 'function'

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      showToast({ message: t('Link copied.') })
    } catch {
      showToast({ message: link, duration: 12_000 })
    }
  }

  return (
    <section aria-label={t('Invite')} className="glass flex flex-col items-center gap-3 rounded-2xl p-5 text-center">
      <h2 className="text-base font-semibold text-white">{t('Scan with your phone to join')}</h2>
      <QrCode text={link} label={t('QR code to join this Match')} size={large ? 260 : 188} />
      <p className="text-sm text-neutral-400">
        {t('Or type the code')} <span className="ml-1 font-mono text-lg tracking-[.3em] text-white">{code}</span>
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="btn" onClick={() => void copy()}>
          {t('Copy link')}
        </button>
        {canShare && (
          <button type="button" className="btn" onClick={() => void navigator.share({ url: link, title: t('Join my Match') }).catch(() => undefined)}>
            {t('Share…')}
          </button>
        )}
      </div>
    </section>
  )
}

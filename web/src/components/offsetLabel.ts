import { t } from '../i18n'

/** "In sync", "+0.5 s (later)" or "−1.2 s (earlier)", in the language in use. */
export function offsetLabel(seconds: number): string {
  if (seconds === 0) return t('In sync')
  const amount = Math.abs(seconds).toFixed(1)
  return seconds > 0 ? t('+{amount} s (later)', { amount }) : t('−{amount} s (earlier)', { amount })
}

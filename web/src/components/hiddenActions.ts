import { episodeCode, hideFromNextUp, hideFromResume, isEpisode, restoreHidden, type Movie } from '../core'
import { t } from '../i18n'
import { updateHidden } from '../platform/web/hidden'
import { showToast } from './toast'

/** What a title is called in the list of hidden things: a movie by name, an episode as "Series · S1 E2". */
export function hiddenLabel(movie: Movie): string {
  return isEpisode(movie) ? [movie.seriesName, episodeCode(movie)].filter(Boolean).join(' · ') : movie.name
}

/**
 * "Hide from Continue watching": the title leaves that row. Its progress and its watched state stay as they were, it is still in the
 * library and in the search, and it comes back by itself if it is played again. The toast offers to undo it at once.
 */
export function hideFromContinue(movie: Movie): void {
  const name = hiddenLabel(movie)
  updateHidden((hidden) => hideFromResume(hidden, movie, name, Date.now()))
  showToast({
    message: t('{title} is hidden from Continue watching.', { title: name }),
    actionLabel: t('Undo'),
    onAction: () => updateHidden((hidden) => restoreHidden(hidden, 'resume', movie.id)),
  })
}

/** "Hide series from Next up": the whole series leaves that row until it is restored (Settings, Appearance, Hidden). */
export function hideSeriesFromNextUp(episode: Movie): void {
  if (!isEpisode(episode)) return
  const { seriesId, seriesName } = episode
  updateHidden((hidden) => hideFromNextUp(hidden, seriesId, seriesName, Date.now()))
  showToast({
    message: t('{title} is hidden from Next up.', { title: seriesName }),
    actionLabel: t('Undo'),
    onAction: () => updateHidden((hidden) => restoreHidden(hidden, 'nextUp', seriesId)),
  })
}

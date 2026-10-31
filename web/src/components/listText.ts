import { isWatchLater, type VideoPlaylist } from '../core'
import { t } from '../i18n'

/** "3 titles" for the line under a playlist. */
export const countText = (n: number | undefined) => (n == null ? '' : n === 1 ? t('1 title') : t('{count} titles', { count: n }))

/** A playlist's name as shown: the one that holds what you put aside has a name of its own. */
export const shownName = (list: Pick<VideoPlaylist, 'name'>) => (isWatchLater(list) ? t('Watch later') : list.name)

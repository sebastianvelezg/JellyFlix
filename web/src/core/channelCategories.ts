/** The kinds of channel the Live TV lists can show (the server's own filters). Apart from liveTv.ts so preferences can check one
 * without loading the Live TV client. */
export const CHANNEL_CATEGORIES = ['all', 'favorites', 'movies', 'series', 'sports', 'news', 'kids'] as const
export type ChannelCategory = (typeof CHANNEL_CATEGORIES)[number]

export const isChannelCategory = (value: unknown): value is ChannelCategory => CHANNEL_CATEGORIES.includes(value as ChannelCategory)

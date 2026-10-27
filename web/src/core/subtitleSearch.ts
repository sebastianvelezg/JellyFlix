import { getSubtitleApi } from '@jellyfin/sdk/lib/utils/api/subtitle-api'
import type { Session } from './jellyfin'

/**
 * Subtitles from the internet, through the server's subtitle plugin (Open Subtitles and the like). The plugin does the
 * searching and the downloading; the server saves the file next to the video (or in its metadata folder) and from then on
 * lists it as one more track of that video. Searching and saving need an account that may manage subtitles.
 */
export interface RemoteSubtitle {
  id: string
  name: string
  provider: string
  /** Three-letter code, like the tracks of a video use. */
  language: string
  format: string
  author: string
  comment: string
  downloads: number | null
  rating: number | null
  /** The plugin matched the video file itself (same release), so the timing is very likely right. */
  exactMatch: boolean
  hearingImpaired: boolean
  forced: boolean
  machineTranslated: boolean
}

/** The languages offered when searching (the server's own three-letter codes). */
export const SUBTITLE_SEARCH_LANGUAGES: ReadonlyArray<readonly [string, string]> = [
  ['eng', 'English'],
  ['spa', 'Spanish'],
  ['por', 'Portuguese'],
  ['fra', 'French'],
  ['deu', 'German'],
  ['ita', 'Italian'],
  ['nld', 'Dutch'],
  ['pol', 'Polish'],
  ['rus', 'Russian'],
  ['tur', 'Turkish'],
  ['ara', 'Arabic'],
  ['hin', 'Hindi'],
  ['jpn', 'Japanese'],
  ['kor', 'Korean'],
  ['zho', 'Chinese'],
]

/** Which language to search first: the one of the subtitles chosen last, else the viewer's own, else English. Pure. */
export function defaultSearchLanguage(remembered: string | null | undefined, interfaceLanguage: string): string {
  const known = (code: string | null | undefined) => SUBTITLE_SEARCH_LANGUAGES.some(([c]) => c === code)
  if (known(remembered)) return remembered as string
  return interfaceLanguage === 'es' ? 'spa' : 'eng'
}

/**
 * Best first: a match of the file itself, then the ones people rate and download most. Subtitles made by a machine come last
 * (a human version of the same language is nearly always better). Does not change the list it is given.
 */
export function sortRemoteSubtitles(found: readonly RemoteSubtitle[]): RemoteSubtitle[] {
  const score = (s: RemoteSubtitle) =>
    (s.exactMatch ? 1_000_000 : 0) + (s.machineTranslated ? -500_000 : 0) + (s.downloads ?? 0) + (s.rating ?? 0) * 100
  return [...found].sort((a, b) => score(b) - score(a))
}

/** What the server says about a problem with a subtitle search or save, as a short sentence. Pure. */
export function subtitleSearchProblem(error: unknown): string {
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  if (status === 403) return 'Your account may not search for or save subtitles on this server.'
  if (status === 404) return 'The server has no subtitle plugin for this title.'
  return 'Could not reach the subtitle search. Try again in a moment.'
}

/** Looks for subtitles of one video in one language. An empty list means nothing was found (or the plugin is not signed in). */
export async function searchRemoteSubtitles(
  session: Session,
  itemId: string,
  language: string,
  options: { exactOnly?: boolean } = {},
): Promise<RemoteSubtitle[]> {
  const { data } = await getSubtitleApi(session.api).searchRemoteSubtitles({
    itemId,
    language,
    isPerfectMatch: options.exactOnly === true ? true : undefined,
  })
  return sortRemoteSubtitles(
    data
      .filter((s) => s.Id)
      .map((s) => ({
        id: s.Id as string,
        name: s.Name ?? '',
        provider: s.ProviderName ?? '',
        language: s.ThreeLetterISOLanguageName ?? language,
        format: (s.Format ?? '').toLowerCase(),
        author: s.Author ?? '',
        comment: s.Comment ?? '',
        downloads: s.DownloadCount ?? null,
        rating: s.CommunityRating ?? null,
        exactMatch: s.IsHashMatch === true,
        hearingImpaired: s.HearingImpaired === true,
        forced: s.Forced === true,
        machineTranslated: s.MachineTranslated === true || s.AiTranslated === true,
      })),
  )
}

/** Saves one of the found subtitles on the server. The video then has one more subtitle track (ask for its playback again). */
export async function downloadRemoteSubtitle(session: Session, itemId: string, subtitleId: string): Promise<void> {
  await getSubtitleApi(session.api).downloadRemoteSubtitles({ itemId, subtitleId })
}

/** The first subtitle track in `after` that was not in `before`: the one a download just added. Pure. */
export function newSubtitleIndex(before: readonly number[], after: readonly number[]): number | null {
  return after.find((index) => !before.includes(index)) ?? null
}

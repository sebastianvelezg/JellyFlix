import { useCallback, useEffect, useRef } from 'react'
import { audiobookStart, audiobookTrack, getSeriesPlayTarget, type Collection, type Movie, type Session } from '../../core'
import type { PlayVideo } from '../cardActions'
import type { useMusic } from '../music/MusicProvider'
import { rememberPlayList } from '../playQueues'
import type { Navigate, PlayQueueRef } from '../route'

/** What a card, a button or a row can ask the app to do: open a title, a person or an album, or play something. */
export function useTitleActions({
  session,
  go,
  music,
  setOverrides,
}: {
  session: Session
  go: Navigate
  music: ReturnType<typeof useMusic>
  setOverrides: (update: (prev: Record<string, Movie>) => Record<string, Movie>) => void
}) {
  const openAlbum = (id: string) => go({ page: 'album', id })
  const openArtist = (id: string) => go({ page: 'artist', id })
  const openPlaylist = (id: string) => go({ page: 'playlist', id })
  const openCollection = (collection: Collection) => go({ page: 'collection', id: collection.id })
  const seeCollections = () => go({ page: 'collections' })
  const openMovie = (movie: Movie) => go({ page: 'movie', id: movie.id })
  const openShow = (show: Movie) => go({ page: 'show', id: show.id })
  const openSeries = (id: string) => go({ page: 'show', id })
  const openBook = (book: Movie) => go({ page: 'book', id: book.id })
  /** An audiobook goes to the music player (from where you stopped); the rest of the books open on their page. */
  const listen = (book: Movie, startSeconds: number) => music.play([audiobookTrack(book)], 0, { startSeconds })
  const playOrOpenBook = (book: Movie) => (book.book === 'audiobook' ? listen(book, audiobookStart(book)) : openBook(book))
  const play = (item: Movie, startOver = false) => go({ page: 'play', id: item.id, startOver })
  /** Plays a video as part of a folder, a library or a shuffled queue: the next one of it follows. */
  const playQueue = (first: Movie, queue: PlayQueueRef) => go({ page: 'play', id: first.id, startOver: false, ...queue })
  /** The play button of a music video's card: what follows is the folder it is in, or the row or grid it was played from. */
  const playVideoNow: PlayVideo = (video, from) => {
    if (from?.queue) playQueue(video, from.queue)
    else if (from?.list && from.list.length > 1) playQueue(video, { queueId: rememberPlayList(from.list) })
    else play(video)
  }
  // The cards get a function that never changes (the page re-renders often, and every card would re-render with it).
  const latestPlayVideo = useRef(playVideoNow)
  useEffect(() => {
    latestPlayVideo.current = playVideoNow
  })
  const playVideo = useCallback<PlayVideo>((video, from) => latestPlayVideo.current(video, from), [])
  /** The Play button of a series: its next (or first) episode. */
  const playShow = (show: Movie) => {
    getSeriesPlayTarget(session, show.id)
      .then((episode) => (episode ? play(episode) : openShow(show)))
      .catch(() => openShow(show))
  }
  const remember = (movie: Movie) => setOverrides((prev) => ({ ...prev, [movie.id]: movie }))

  return {
    openAlbum,
    openArtist,
    openPlaylist,
    openCollection,
    seeCollections,
    openMovie,
    openShow,
    openSeries,
    openBook,
    listen,
    playOrOpenBook,
    play,
    playQueue,
    playVideo,
    playShow,
    remember,
  }
}

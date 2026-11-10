import type { SeerrDetail, SeerrMe, SeerrMediaType, SeerrRequestInput, SeerrRequestResult, SeerrRequests, SeerrSearch, SeerrStatus } from './contract'
import type { ModulesClient } from './client'

export const seerrMe = (client: ModulesClient) => client.get<SeerrMe>('/v1/seerr/me')
export const seerrSearch = (client: ModulesClient, query: string, page = 1) => client.get<SeerrSearch>(`/v1/seerr/search?query=${encodeURIComponent(query)}&page=${page}`)
export const seerrTitle = (client: ModulesClient, type: SeerrMediaType, id: number) => client.get<SeerrDetail>(`/v1/seerr/title/${type}/${id}`)
export const seerrRequest = (client: ModulesClient, input: SeerrRequestInput) => client.post<SeerrRequestResult>('/v1/seerr/requests', input)
export const seerrMyRequests = (client: ModulesClient, page = 1) => client.get<SeerrRequests>(`/v1/seerr/requests?page=${page}`)

/** The address of a poster on TMDb's picture server, from the path the container sends (it only sends paths of the form "/name.jpg"). */
export function seerrPosterUrl(path: string | undefined): string | null {
  return path && /^\/[A-Za-z0-9._-]{1,120}$/.test(path) ? `https://image.tmdb.org/t/p/w342${path}` : null
}

/** Whether a title can still be asked for as a whole: nothing of it is in the library or on its way. */
export const canAskFor = (status: SeerrStatus): boolean => status === 'none'

/** A series with some seasons missing can be asked for again, for those seasons. */
export const canAskForMore = (status: SeerrStatus): boolean => status === 'none' || status === 'partial'

import type { IncomingMessage, ServerResponse } from 'node:http'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface AuthUser {
  id: string
  name: string
  isAdmin: boolean
  /** The token the person's app used, to call Jellyfin as them. */
  token: string
}

export interface Ctx {
  method: string
  path: string
  params: Record<string, string>
  query: URLSearchParams
  body: unknown
  user: AuthUser | undefined
}

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>
export type Access = 'public' | 'user' | 'admin'

interface Route {
  method: string
  pattern: RegExp
  names: string[]
  access: Access
  handler: Handler
}

export class Router {
  private routes: Route[] = []

  add(method: string, path: string, access: Access, handler: Handler): void {
    const names: string[] = []
    const source = path.replace(/:(\w+)/g, (_, name: string) => {
      names.push(name)
      return '([^/]+)'
    })
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), names, access, handler })
  }

  get = (path: string, access: Access, handler: Handler): void => this.add('GET', path, access, handler)
  post = (path: string, access: Access, handler: Handler): void => this.add('POST', path, access, handler)
  put = (path: string, access: Access, handler: Handler): void => this.add('PUT', path, access, handler)
  delete = (path: string, access: Access, handler: Handler): void => this.add('DELETE', path, access, handler)

  match(method: string, path: string): { route: Route; params: Record<string, string> } | 'wrong-method' | null {
    let pathMatched = false
    for (const route of this.routes) {
      const m = route.pattern.exec(path)
      if (!m) continue
      pathMatched = true
      if (route.method !== method) continue
      const params: Record<string, string> = {}
      route.names.forEach((name, i) => {
        try {
          params[name] = decodeURIComponent(m[i + 1] as string)
        } catch {
          throw new HttpError(400, 'The address is not valid.')
        }
      })
      return { route, params }
    }
    return pathMatched ? 'wrong-method' : null
  }
}

const MAX_BODY = 256 * 1024

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'The request is too big.')
    chunks.push(chunk as Buffer)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'The request is not valid JSON.')
  }
}

export function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (body === undefined) {
    res.writeHead(status, headers).end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }).end(text)
}

/** CORS: the app is another site than this API. The API uses a token in a header, not cookies, so it does not need to be stricter than the list it is given. */
export function corsHeaders(origin: string | undefined, allowed: string[]): Record<string, string> {
  const ok = allowed.includes('*') ? '*' : origin && allowed.includes(origin) ? origin : undefined
  if (!ok) return {}
  return {
    'access-control-allow-origin': ok,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-max-age': '600',
    ...(ok === '*' ? {} : { vary: 'Origin' }),
  }
}

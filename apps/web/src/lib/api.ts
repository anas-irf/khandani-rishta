import type { paths } from '@khandani/api-contract'
import createClient, { type Client, type Middleware } from 'openapi-fetch'
import type { ApiErrorBody, ApiErrorCode, ApiFieldError } from './api-types'

/** Base URL of the API. Set per environment at build time through `VITE_API_BASE_URL`. */
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

/**
 * An error response of the API (15 section 2), or a request that never reached it
 * (`code = 'network_error'`, `status = 0`).
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode | string
  readonly fields: ApiFieldError[]
  readonly details: Record<string, unknown>
  readonly requestId: string | null

  constructor(init: {
    status: number
    code: ApiErrorCode | string
    message: string
    fields?: ApiFieldError[]
    details?: Record<string, unknown>
    requestId?: string | null
  }) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.fields = init.fields ?? []
    this.details = init.details ?? {}
    this.requestId = init.requestId ?? null
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** Error codes that mean the gate may have changed (17 section 4.4). */
export const GATE_ERROR_CODES: ReadonlySet<string> = new Set([
  'account_banned',
  'account_suspended',
  'account_deletion_scheduled',
  'consent_required',
  'onboarding_required',
  'profile_not_active',
])

export function isGateError(error: unknown): boolean {
  return isApiError(error) && GATE_ERROR_CODES.has(error.code)
}

// ---------------------------------------------------------------------------
// Token wiring. The getter is registered once by the auth provider; tokens are never stored.
// ---------------------------------------------------------------------------

export type TokenGetter = (options?: { skipCache?: boolean }) => Promise<string | null>

let tokenGetter: TokenGetter | null = null
let unauthenticatedHandler: (() => void) | null = null

/** Registers how to get a fresh Clerk session token (17 section 6.1). */
export function setTokenGetter(getter: TokenGetter | null) {
  tokenGetter = getter
}

/** Registers what to do when the session is gone: sign out and go to sign-in (17 section 4.4). */
export function setUnauthenticatedHandler(handler: (() => void) | null) {
  unauthenticatedHandler = handler
}

/** Endpoints that are called without a token (17 section 6.1). */
function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith('/v1/reference/') ||
    pathname === '/v1/meta' ||
    pathname.startsWith('/v1/meta/') ||
    pathname === '/healthz' ||
    pathname === '/readyz'
  )
}

async function toApiError(response: Response): Promise<ApiError> {
  const requestId = response.headers.get('x-request-id')
  let body: ApiErrorBody | null = null
  try {
    body = (await response.clone().json()) as ApiErrorBody
  } catch {
    body = null
  }
  const error = body?.error
  return new ApiError({
    status: response.status,
    code: error?.code ?? (response.status >= 500 ? 'internal_error' : 'bad_request'),
    message: error?.message ?? response.statusText ?? 'Request failed',
    fields: error?.fields,
    details: error?.details,
    requestId: error?.request_id ?? requestId,
  })
}

const pendingRetries = new Map<string, Request>()

const authMiddleware: Middleware = {
  async onRequest({ request, id }) {
    const url = new URL(request.url)
    if (isPublicPath(url.pathname)) return request
    const token = tokenGetter ? await tokenGetter() : null
    if (!token) {
      unauthenticatedHandler?.()
      throw new ApiError({ status: 401, code: 'unauthenticated', message: 'Not signed in' })
    }
    request.headers.set('Authorization', `Bearer ${token}`)
    pendingRetries.set(id, request.clone())
    return request
  },

  async onResponse({ response, id }) {
    const retry = pendingRetries.get(id)
    pendingRetries.delete(id)

    let final = response
    // 401: retry once with a fresh token (06 section 3.3).
    if (final.status === 401 && retry && tokenGetter) {
      const fresh = await tokenGetter({ skipCache: true })
      if (fresh) {
        retry.headers.set('Authorization', `Bearer ${fresh}`)
        final = await fetch(retry)
      }
    }
    if (final.status === 401 && retry) {
      unauthenticatedHandler?.()
    }
    // 304 answers a conditional request (reference bootstrap); it is not an error and has no
    // body, which the Content-Length header tells the client not to read.
    if (final.status === 304) {
      const headers = new Headers(final.headers)
      headers.set('Content-Length', '0')
      return new Response(null, { status: 304, headers })
    }
    if (!final.ok) {
      throw await toApiError(final)
    }
    return final
  },

  onError({ error, id }) {
    pendingRetries.delete(id)
    if (error instanceof ApiError) return error
    return new ApiError({
      status: 0,
      code: 'network_error',
      message: error instanceof Error ? error.message : 'Network error',
    })
  },
}

/** Typed API client. Request and response types come from `packages/api-contract`. */
export const api = createClient<paths>({
  baseUrl: apiBaseUrl,
  // Resolved per call, so a fetch patched later (the mock API in tests) is used.
  fetch: (request) => globalThis.fetch(request),
})
api.use(authMiddleware)

// ---------------------------------------------------------------------------
// Untyped facade for routes that `openapi.json` does not describe yet. Response types come
// from `api-types.ts` (see its header). All calls still go through `api` and its middleware.
// ---------------------------------------------------------------------------

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export type RequestOptions = {
  query?: Record<string, string | number | boolean | undefined | null>
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

// biome-ignore lint/suspicious/noExplicitAny: the facade covers paths missing from `paths`.
const untyped = api as unknown as Client<any>

function cleanQuery(query: RequestOptions['query']) {
  if (!query) return undefined
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value
  }
  return out
}

/** Sends a request and returns the raw response too (for 304 and headers). */
export async function apiRequestRaw<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; response: Response }> {
  const init = {
    params: { query: cleanQuery(options.query) },
    body: options.body,
    headers: options.headers,
    signal: options.signal,
  }
  const result = await untyped.request(method, path, init)
  return { data: result.data as T, response: result.response }
}

export async function apiRequest<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { data } = await apiRequestRaw<T>(method, path, options)
  return data
}

/** Short helpers used by every feature's `queries.ts`. Paths are built with `encodeURIComponent`. */
export const http = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    apiRequest<T>('get', path, options),
  post: <T = void>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('post', path, { ...options, body }),
  put: <T = void>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('put', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('patch', path, { ...options, body }),
  delete: <T = void>(path: string, options?: RequestOptions) =>
    apiRequest<T>('delete', path, options),
}

/** Encodes one path segment. */
export function seg(value: string | number): string {
  return encodeURIComponent(String(value))
}

import type { paths } from '@khandani/api-contract'
import createClient, { type Middleware } from 'openapi-fetch'
import type { ApiErrorBody, ApiErrorCode, ApiFieldError } from './api-types'

/** Base URL of the API. Set per environment at build time through `VITE_API_BASE_URL`. */
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

/**
 * A field error as the client handles it. The API sends `FieldError`s; a screen may swap the
 * `code` for one of its own to pick another message (`serverFieldMessage`), and a newer API may
 * send a code this build does not know yet (15 section 1).
 */
export type ClientFieldError = Omit<ApiFieldError, 'code'> & { code: string }

/**
 * An error response of the API (15 section 2), or a request that never reached it
 * (`code = 'network_error'`, `status = 0`).
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode | string
  readonly fields: ClientFieldError[]
  readonly details: Record<string, unknown>
  readonly requestId: string | null

  constructor(init: {
    status: number
    code: ApiErrorCode | string
    message: string
    fields?: ClientFieldError[]
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
    fields: error?.fields ?? undefined,
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

// ---------------------------------------------------------------------------
// Transport. Every request goes through one openapi-fetch client and its middleware.
// ---------------------------------------------------------------------------

/** The methods openapi-fetch knows. */
type FetchMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'

/**
 * The client's own view of the API: any path, a JSON body and a JSON answer. Callers name
 * concrete paths (`/v1/admin/profiles/0192...`), which are not keys of the contract's `paths`, so
 * the checking against the contract happens in the signatures of `http` below instead.
 */
type TransportOperation = {
  parameters: { query?: Record<string, string | number | boolean> }
  requestBody?: { content: { 'application/json': unknown } }
  responses: { 200: { content: { 'application/json': unknown } } }
}
type TransportPaths = Record<string, Record<FetchMethod, TransportOperation>>

const transport = createClient<TransportPaths>({
  baseUrl: apiBaseUrl,
  // Resolved per call, so a fetch patched later (the mock API in tests) is used.
  fetch: (request) => globalThis.fetch(request),
})
transport.use(authMiddleware)

// ---------------------------------------------------------------------------
// Paths of the contract. A caller writes a path as a template literal with each parameter
// encoded by `seg()`, for example `/v1/admin/profiles/${seg(id)}`. TypeScript types that
// expression as `/v1/admin/profiles/${string}`, which is matched segment by segment against the
// contract's `/v1/admin/profiles/{profile_id}` to find the operation, and from it the query
// parameters, the request body and the answer.
// ---------------------------------------------------------------------------

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

type ContractPath = keyof paths

/** The operation behind `M` on contract path `K`, `never` when the path has no such method. */
type Operation<K extends ContractPath, M extends HttpMethod> = NonNullable<paths[K][M]>

/** The contract paths that answer `M`. */
type PathsWith<M extends HttpMethod> = {
  [K in ContractPath]: [Operation<K, M>] extends [never] ? never : K
}[ContractPath]

/** A contract path with every `{parameter}` written as any string: the shape of a caller's path. */
type Concrete<K extends string> = K extends `${infer Head}{${string}}${infer Tail}`
  ? `${Head}${string}${Concrete<Tail>}`
  : K

/** Whether one segment of a caller's path fits one segment of a contract path. */
type SegmentFits<K extends string, S extends string> = K extends `{${string}}`
  ? true
  : [S] extends [K]
    ? true
    : false

/** Whether caller path `S` fits contract path `K`; a `{parameter}` holds exactly one segment. */
type Fits<K extends string, S extends string> = K extends `${infer KHead}/${infer KTail}`
  ? S extends `${infer SHead}/${infer STail}`
    ? SegmentFits<KHead, SHead> extends true
      ? Fits<KTail, STail>
      : false
    : false
  : S extends `${string}/${string}`
    ? false
    : SegmentFits<K, S>

/** The contract path that caller path `S` stands for. */
type ContractPathOf<M extends HttpMethod, S extends string> = {
  [K in PathsWith<M>]: Fits<K, S> extends true ? K : never
}[PathsWith<M>]

/**
 * Contract paths of `M` that another path of `M` also fits, such as `/photos/uploads` next to
 * `/photos/{photo_id}`. A caller's path would then stand for two operations. `never` while every
 * path is unambiguous, which `api.test.ts` checks.
 */
export type OverlappingPaths<M extends HttpMethod> = {
  [K in PathsWith<M>]: [ContractPathOf<M, Concrete<K>>] extends [K] ? never : K
}[PathsWith<M>]

/** A path the API answers for `M`, as a caller writes it. */
export type ApiPath<M extends HttpMethod> = Concrete<PathsWith<M>>

type OperationOf<M extends HttpMethod, S extends string> = Operation<ContractPathOf<M, S>, M>

type JsonContent<R> = R extends { content: { 'application/json': infer Body } } ? Body : undefined

/** The JSON body of the success answer of `M` on `S`; `undefined` for `204 No Content`. */
export type ApiResponse<M extends HttpMethod, S extends string> =
  OperationOf<M, S> extends { responses: infer Responses }
    ? {
        [Code in keyof Responses]: Code extends 200 | 201 | 202 | 204
          ? JsonContent<Responses[Code]>
          : never
      }[keyof Responses]
    : never

/** The JSON request body of `M` on `S`; `undefined` when the operation takes none. */
type ApiBody<M extends HttpMethod, S extends string> = JsonContent<
  NonNullable<OperationOf<M, S>['requestBody']>
>

/** The contract's query parameters of `M` on `S`; none when the operation takes none. */
type QueryParams<M extends HttpMethod, S extends string> = [
  NonNullable<OperationOf<M, S>['parameters']['query']>,
] extends [never]
  ? Record<never, never>
  : NonNullable<OperationOf<M, S>['parameters']['query']>

/**
 * The query parameters of `M` on `S`, required where the contract requires them. An optional
 * parameter may also be `null` or `''`: such parameters are left out of the URL, so a filter
 * that is not set can be passed as it is.
 */
type ApiQuery<M extends HttpMethod, S extends string> = {
  [Name in keyof QueryParams<M, S>]: undefined extends QueryParams<M, S>[Name]
    ? QueryParams<M, S>[Name] | '' | null
    : QueryParams<M, S>[Name]
}

/** Whether `M` on `S` has a required query parameter. */
type QueryRequired<M extends HttpMethod, S extends string> =
  Record<never, never> extends ApiQuery<M, S> ? false : true

export type RequestOptions<M extends HttpMethod, S extends string> = (QueryRequired<
  M,
  S
> extends true
  ? { query: ApiQuery<M, S> }
  : { query?: ApiQuery<M, S> }) & {
  headers?: Record<string, string>
  signal?: AbortSignal
}

/** The options argument: required when the operation has a required query parameter. */
type OptionsArgs<M extends HttpMethod, S extends string> =
  QueryRequired<M, S> extends true
    ? [options: RequestOptions<M, S>]
    : [options?: RequestOptions<M, S>]

/** The arguments after the path of a method that sends a body. */
type BodyArgs<M extends HttpMethod, S extends string> = [ApiBody<M, S>] extends [undefined]
  ? QueryRequired<M, S> extends true
    ? [body: undefined, options: RequestOptions<M, S>]
    : [body?: undefined, options?: RequestOptions<M, S>]
  : QueryRequired<M, S> extends true
    ? [body: ApiBody<M, S>, options: RequestOptions<M, S>]
    : [body: ApiBody<M, S>, options?: RequestOptions<M, S>]

/** What every request carries once its types are checked. */
type RawOptions = {
  query?: object
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

/** The query without the parameters that are not set (`undefined`, `null` or `''`). */
function cleanQuery(query: RawOptions['query']) {
  if (!query) return undefined
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
    else if (typeof value === 'string' && value !== '') out[key] = value
  }
  return out
}

/**
 * Sends one request through the transport. `T` is the answer the contract gives for the path,
 * which the typed wrappers below work out; this is the one place where the API's JSON is taken
 * to be of that type.
 */
async function send<T>(
  method: HttpMethod,
  path: string,
  options: RawOptions,
): Promise<{ data: T; response: Response }> {
  const result = await transport.request(method, path, {
    params: { query: cleanQuery(options.query) },
    body: options.body,
    headers: options.headers,
    signal: options.signal,
  })
  return { data: result.data as T, response: result.response }
}

async function sendForData<T>(method: HttpMethod, path: string, options: RawOptions = {}) {
  const { data } = await send<T>(method, path, options)
  return data
}

/**
 * Sends a request and returns the raw response too (for `304` and headers). On a `304` the
 * data is `undefined`.
 */
export function apiRequestRaw<M extends HttpMethod, P extends ApiPath<M>>(
  method: M,
  path: P,
  ...[options]: OptionsArgs<M, P>
) {
  return send<ApiResponse<M, P>>(method, path, options ?? {})
}

/**
 * Short helpers used by every feature's `queries.ts`. Build paths as template literals with
 * `seg()` for each parameter: the path, the query, the body and the answer are all checked
 * against the contract.
 */
export const http = {
  get: <P extends ApiPath<'get'>>(path: P, ...[options]: OptionsArgs<'get', P>) =>
    sendForData<ApiResponse<'get', P>>('get', path, options),
  post: <P extends ApiPath<'post'>>(path: P, ...[body, options]: BodyArgs<'post', P>) =>
    sendForData<ApiResponse<'post', P>>('post', path, { ...options, body }),
  put: <P extends ApiPath<'put'>>(path: P, ...[body, options]: BodyArgs<'put', P>) =>
    sendForData<ApiResponse<'put', P>>('put', path, { ...options, body }),
  patch: <P extends ApiPath<'patch'>>(path: P, ...[body, options]: BodyArgs<'patch', P>) =>
    sendForData<ApiResponse<'patch', P>>('patch', path, { ...options, body }),
  delete: <P extends ApiPath<'delete'>>(path: P, ...[options]: OptionsArgs<'delete', P>) =>
    sendForData<ApiResponse<'delete', P>>('delete', path, options),
}

/** Encodes one path segment. */
export function seg(value: string | number): string {
  return encodeURIComponent(String(value))
}

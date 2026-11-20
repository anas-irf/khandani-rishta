import type { components } from '@khandani/api-contract'
import { HttpResponse, http as mswHttp } from 'msw'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { AdminProfile } from '~/features/admin/types'
import { apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import {
  ApiError,
  type ApiPath,
  type ApiResponse,
  apiRequestRaw,
  http,
  isGateError,
  type OverlappingPaths,
  setTokenGetter,
  setUnauthenticatedHandler,
} from './api'
import type { OwnProfile, ProfileDetail } from './api-types'

afterEach(() => {
  setTokenGetter(async () => 'test-token')
  setUnauthenticatedHandler(null)
})

describe('API client middleware (17 section 6.1)', () => {
  it('sends the session token as a Bearer header', async () => {
    let seen: string | null = null
    server.use(
      mswHttp.get(apiUrl('/v1/me'), ({ request }) => {
        seen = request.headers.get('Authorization')
        return HttpResponse.json({ ok: true })
      }),
    )
    setTokenGetter(async () => 'abc')
    await http.get('/v1/me')
    expect(seen).toBe('Bearer abc')
  })

  it('calls public endpoints without a token', async () => {
    let seen: string | null = 'unset'
    server.use(
      mswHttp.get(apiUrl('/v1/reference/regions'), ({ request }) => {
        seen = request.headers.get('Authorization')
        return HttpResponse.json({ items: [] })
      }),
    )
    const getter = vi.fn(async () => 'abc')
    setTokenGetter(getter)
    await http.get('/v1/reference/regions', { query: { country_code: 'PK' } })
    expect(seen).toBeNull()
    expect(getter).not.toHaveBeenCalled()
  })

  it('throws an ApiError with code, fields, details and request id', async () => {
    server.use(
      mswHttp.put(apiUrl('/v1/me/profile/sections/basics'), () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_failed',
              message: 'Some fields need your attention.',
              fields: [{ field: 'date_of_birth', code: 'too_young', message: 'Too young' }],
              details: {},
              request_id: 'req-1',
            },
          },
          { status: 400 },
        ),
      ),
    )
    const error = await http.put('/v1/me/profile/sections/basics', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(400)
    expect(apiError.code).toBe('validation_failed')
    expect(apiError.fields[0]).toEqual({
      field: 'date_of_birth',
      code: 'too_young',
      message: 'Too young',
    })
    expect(apiError.requestId).toBe('req-1')
  })

  it('falls back to the x-request-id header and a code by status for non-JSON errors', async () => {
    server.use(
      mswHttp.get(
        apiUrl('/v1/home'),
        () => new HttpResponse('oops', { status: 502, headers: { 'x-request-id': 'hdr-9' } }),
      ),
    )
    const error = (await http.get('/v1/home').catch((e: unknown) => e)) as ApiError
    expect(error.code).toBe('internal_error')
    expect(error.requestId).toBe('hdr-9')
  })

  it('retries a 401 once with a fresh token', async () => {
    const tokens: (string | null)[] = []
    server.use(
      mswHttp.get(apiUrl('/v1/me'), ({ request }) => {
        const auth = request.headers.get('Authorization')
        tokens.push(auth)
        if (auth === 'Bearer stale') {
          return HttpResponse.json(
            { error: { code: 'unauthenticated', message: 'x' } },
            { status: 401 },
          )
        }
        return HttpResponse.json({ ok: true })
      }),
    )
    setTokenGetter(async (options) => (options?.skipCache ? 'fresh' : 'stale'))
    const handler = vi.fn()
    setUnauthenticatedHandler(handler)
    await expect(http.get('/v1/me')).resolves.toEqual({ ok: true })
    expect(tokens).toEqual(['Bearer stale', 'Bearer fresh'])
    expect(handler).not.toHaveBeenCalled()
  })

  it('signs out when the retry is refused too', async () => {
    server.use(
      mswHttp.get(apiUrl('/v1/me'), () =>
        HttpResponse.json({ error: { code: 'unauthenticated', message: 'x' } }, { status: 401 }),
      ),
    )
    const handler = vi.fn()
    setUnauthenticatedHandler(handler)
    const error = (await http.get('/v1/me').catch((e: unknown) => e)) as ApiError
    expect(error.code).toBe('unauthenticated')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('refuses to send a protected request without a session', async () => {
    setTokenGetter(async () => null)
    const handler = vi.fn()
    setUnauthenticatedHandler(handler)
    const error = (await http.get('/v1/me').catch((e: unknown) => e)) as ApiError
    expect(error.code).toBe('unauthenticated')
    expect(handler).toHaveBeenCalled()
  })

  it('turns a network failure into network_error', async () => {
    server.use(mswHttp.get(apiUrl('/v1/me'), () => HttpResponse.error()))
    const error = (await http.get('/v1/me').catch((e: unknown) => e)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('network_error')
    expect(error.status).toBe(0)
  })

  it('passes a 304 through for conditional requests', async () => {
    // happy-dom emulates an HTTP cache for 304 answers; browsers hand them to the page for
    // conditional requests the page sets itself, so fetch is stubbed here.
    const fetchStub = vi.fn(async (request: Request) => {
      expect(request.headers.get('If-None-Match')).toBe('"v1"')
      return new Response(null, { status: 304 })
    })
    vi.stubGlobal('fetch', fetchStub)
    try {
      const { response } = await apiRequestRaw('get', '/v1/reference/bootstrap', {
        headers: { 'If-None-Match': '"v1"' },
      })
      expect(response.status).toBe(304)
      expect(fetchStub).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('drops empty query values', async () => {
    let url = ''
    server.use(
      mswHttp.get(apiUrl('/v1/interests'), ({ request }) => {
        url = request.url
        return HttpResponse.json({ items: [], next_cursor: null })
      }),
    )
    await http.get('/v1/interests', { query: { box: 'sent', cursor: undefined, status: '' } })
    expect(url).toContain('box=sent')
    expect(url).not.toContain('cursor')
    expect(url).not.toContain('status=')
  })

  it('returns undefined for 204 responses', async () => {
    server.use(mswHttp.post(apiUrl('/v1/events'), () => new HttpResponse(null, { status: 204 })))
    await expect(http.post('/v1/events', { events: [] })).resolves.toBeUndefined()
  })
})

describe('isGateError', () => {
  it.each([
    'account_banned',
    'account_suspended',
    'account_deletion_scheduled',
    'consent_required',
    'onboarding_required',
    'profile_not_active',
  ])('treats %s as a gate code', (code) => {
    expect(isGateError(new ApiError({ status: 403, code, message: '' }))).toBe(true)
  })

  it('ignores other codes and non-API errors', () => {
    expect(isGateError(new ApiError({ status: 403, code: 'forbidden', message: '' }))).toBe(false)
    expect(isGateError(new Error('x'))).toBe(false)
  })
})

// The checks below run in the compiler (`pnpm typecheck`); `expectTypeOf` does nothing at run
// time.
describe('http paths typed from the contract', () => {
  it('finds the operation of each path a caller writes', () => {
    expectTypeOf<ApiResponse<'get', '/v1/me/profile'>>().toEqualTypeOf<OwnProfile>()
    expectTypeOf<ApiResponse<'get', `/v1/profiles/${string}`>>().toEqualTypeOf<ProfileDetail>()
    expectTypeOf<ApiResponse<'get', `/v1/admin/profiles/${string}`>>().toEqualTypeOf<AdminProfile>()
    // Two handlers named `mark_read` once gave the notifications route the chat's body.
    expectTypeOf<Parameters<typeof http.post<'/v1/notifications/read'>>[1]>().toEqualTypeOf<
      components['schemas']['ReadBody']
    >()
    expectTypeOf<Parameters<typeof http.post<`/v1/connections/${string}/read`>>[1]>().toEqualTypeOf<
      components['schemas']['ChatReadBody']
    >()
  })

  it('accepts only paths of the contract', () => {
    expectTypeOf<Extract<'/v1/admin/nope', ApiPath<'get'>>>().toBeNever()
    expectTypeOf<Extract<'/v1/admin/overview', ApiPath<'post'>>>().toBeNever()
  })

  it('has no path that a second path of the same method also fits', () => {
    expectTypeOf<OverlappingPaths<'get'>>().toBeNever()
    expectTypeOf<OverlappingPaths<'post'>>().toBeNever()
    expectTypeOf<OverlappingPaths<'put'>>().toBeNever()
    expectTypeOf<OverlappingPaths<'patch'>>().toBeNever()
    expectTypeOf<OverlappingPaths<'delete'>>().toBeNever()
  })
})

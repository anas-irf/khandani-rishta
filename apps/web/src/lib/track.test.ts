import { HttpResponse, http as mswHttp } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { flush, pendingEvents, setTrackingSession, track } from './track'

afterEach(() => setTrackingSession(null))

describe('track (20 section 8.3)', () => {
  it('does nothing while signed out', () => {
    track('onboarding_step_viewed', { step: 'basics' })
    expect(pendingEvents()).toHaveLength(0)
  })

  it('drops names that break the naming rule', () => {
    setTrackingSession(async () => 'token')
    track('Bad-Name')
    track('ok')
    expect(pendingEvents()).toHaveLength(0)
  })

  it('keeps at most 10 properties of allowed types, strings cut to 100 characters', () => {
    setTrackingSession(async () => 'token')
    const properties: Record<string, unknown> = { long: 'x'.repeat(150), nested: { a: 1 } }
    for (let i = 0; i < 12; i += 1) properties[`k${i}`] = i
    track('onboarding_step_viewed', properties)
    const [event] = pendingEvents()
    expect(event?.properties?.long).toHaveLength(100)
    expect(event?.properties).not.toHaveProperty('nested')
    expect(Object.keys(event?.properties ?? {}).length).toBeLessThanOrEqual(10)
  })

  it('sends buffered events with the session token and empties the buffer', async () => {
    let body: unknown = null
    let auth: string | null = null
    server.use(
      mswHttp.post(apiUrl('/v1/events'), async ({ request }) => {
        auth = request.headers.get('Authorization')
        body = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    setTrackingSession(async () => 'token-1')
    track('onboarding_step_viewed', { step: 'basics' })
    await flush()
    expect(auth).toBe('Bearer token-1')
    expect(body).toMatchObject({
      events: [{ name: 'onboarding_step_viewed', properties: { step: 'basics' } }],
    })
    expect(pendingEvents()).toHaveLength(0)
  })

  it('drops events silently when sending fails', async () => {
    server.use(mswHttp.post(apiUrl('/v1/events'), () => HttpResponse.error()))
    setTrackingSession(async () => 'token-1')
    track('onboarding_step_viewed')
    await expect(flush()).resolves.toBeUndefined()
    expect(pendingEvents()).toHaveLength(0)
  })
})

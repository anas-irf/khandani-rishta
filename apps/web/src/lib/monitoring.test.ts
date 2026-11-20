import { describe, expect, it } from 'vitest'
import { scrubBreadcrumb, scrubEvent } from './monitoring'

describe('scrubEvent', () => {
  it('drops the body, query string, cookies and credentials but keeps harmless headers', () => {
    const event = scrubEvent({
      request: {
        url: 'https://khandanirishta.app/p/KR-1234?ref=share#top',
        data: { cnic: '35202-1234567-1' },
        query_string: 'ref=share',
        cookies: { __session: 'secret' },
        headers: {
          Authorization: 'Bearer token',
          cookie: '__session=secret',
          'x-clerk-auth-status': 'signed-in',
          'user-agent': 'Mozilla/5.0',
        },
      },
    })
    expect(event.request).toEqual({
      url: 'https://khandanirishta.app/p/KR-1234',
      data: undefined,
      query_string: undefined,
      cookies: undefined,
      headers: { 'user-agent': 'Mozilla/5.0' },
    })
  })

  it('leaves events without a request alone', () => {
    const event = {}
    expect(scrubEvent(event)).toBe(event)
    expect(event).toEqual({})
  })
})

describe('scrubBreadcrumb', () => {
  it('strips query strings from navigation and fetch URLs', () => {
    const breadcrumb = scrubBreadcrumb({
      data: {
        url: 'https://api.khandanirishta.app/v1/search?city=lahore',
        from: '/search?age=25',
        to: '/profiles/1?tab=photos',
        method: 'GET',
      },
    })
    expect(breadcrumb.data).toEqual({
      url: 'https://api.khandanirishta.app/v1/search',
      from: '/search',
      to: '/profiles/1',
      method: 'GET',
    })
  })
})

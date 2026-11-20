import { HttpResponse, http as mswHttp } from 'msw'
import { describe, expect, it } from 'vitest'
import { referenceBootstrap } from '~/mocks/fixtures/reference'
import { apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { fallbackLabel, fetchReferenceBootstrap, itemsOf, labelOf, optionsOf } from './reference'

describe('labelOf (17 section 8.4)', () => {
  it('labels option list codes', () => {
    expect(labelOf(referenceBootstrap, 'marital_status', 'never_married')).toBe('Never married')
  })

  it('labels lookup tables, including nested sects and sub-castes', () => {
    expect(labelOf(referenceBootstrap, 'religions', 'islam')).toBe('Islam')
    expect(labelOf(referenceBootstrap, 'sects', 'sunni')).toBe('Sunni')
    const caste = referenceBootstrap.castes.find((entry) => entry.sub_castes.length > 0)
    const sub = caste?.sub_castes[0]
    expect(sub).toBeDefined()
    if (sub) expect(labelOf(referenceBootstrap, 'sub_castes', sub.code)).toBe(sub.name)
  })

  it('shows unknown codes with spaces instead of underscores', () => {
    expect(labelOf(referenceBootstrap, 'marital_status', 'brand_new_value')).toBe('brand new value')
    expect(labelOf(referenceBootstrap, 'not_a_list', 'some_code')).toBe('some code')
    expect(fallbackLabel('a_b_c')).toBe('a b c')
  })

  it('returns an empty string for missing codes', () => {
    expect(labelOf(referenceBootstrap, 'marital_status', null)).toBe('')
  })

  it('uses the Urdu label when there is one, otherwise the English one', () => {
    const custom = {
      ...referenceBootstrap,
      options: { smoking: [{ code: 'no', label: 'No', label_ur: 'نہیں' }] },
    }
    expect(labelOf(custom, 'smoking', 'no', 'ur')).toBe('نہیں')
    expect(labelOf(referenceBootstrap, 'marital_status', 'never_married', 'ur')).toBe(
      'Never married',
    )
  })
})

describe('optionsOf and itemsOf', () => {
  it('lists options in API order as { code, label }', () => {
    const options = optionsOf(referenceBootstrap, 'marital_status')
    expect(options[0]).toEqual({ code: 'never_married', label: 'Never married' })
    expect(options.length).toBe(referenceBootstrap.options.marital_status?.length)
  })

  it('returns an empty list for an unknown list', () => {
    expect(itemsOf(referenceBootstrap, 'nope')).toEqual([])
  })
})

describe('fetchReferenceBootstrap (15 section 5)', () => {
  it('caches the bootstrap with its version and sends it as If-None-Match next time', async () => {
    const seen: (string | null)[] = []
    server.use(
      mswHttp.get(apiUrl('/v1/reference/bootstrap'), ({ request }) => {
        seen.push(request.headers.get('If-None-Match'))
        // no-store keeps happy-dom's own HTTP cache out of the way.
        return HttpResponse.json(referenceBootstrap, {
          headers: { ETag: '"etag-1"', 'Cache-Control': 'no-store' },
        })
      }),
    )
    const first = await fetchReferenceBootstrap()
    expect(first.version).toBe(referenceBootstrap.version)
    expect(JSON.parse(window.localStorage.getItem('kr.reference.bootstrap') ?? '{}').etag).toBe(
      '"etag-1"',
    )
    await fetchReferenceBootstrap()
    expect(seen).toEqual([null, '"etag-1"'])
  })
})

import { HttpResponse, http } from 'msw'
import { regionsByCountry, searchCities } from '../fixtures/geography'
import { referenceBootstrap } from '../fixtures/reference'
import { apiError, apiUrl } from '../http'

/** 15 section 5: meta and reference data. */
export const handlers = [
  http.get(apiUrl('/v1/meta'), () =>
    HttpResponse.json({ name: 'khandani-api', version: 'mock', environment: 'local' }),
  ),

  http.get(apiUrl('/v1/meta/app-release'), () =>
    HttpResponse.json({
      version_code: 12,
      version_name: '1.3.0',
      min_supported_version_code: 9,
      download_url: 'https://download.example.com/khandani-rishta-1.3.0.apk',
      release_notes: 'Faster chat and clearer photo requests.',
    }),
  ),

  http.get(apiUrl('/v1/reference/bootstrap'), ({ request }) => {
    const etag = `"${referenceBootstrap.version}"`
    if (request.headers.get('If-None-Match') === etag) {
      return new HttpResponse(null, { status: 304, headers: { ETag: etag } })
    }
    return HttpResponse.json(referenceBootstrap, { headers: { ETag: etag } })
  }),

  http.get(apiUrl('/v1/reference/regions'), ({ request }) => {
    const country = new URL(request.url).searchParams.get('country_code')
    if (!country) return apiError(400, 'validation_failed', 'country_code is required')
    return HttpResponse.json({ items: regionsByCountry[country] ?? [] })
  }),

  http.get(apiUrl('/v1/reference/cities'), ({ request }) => {
    const params = new URL(request.url).searchParams
    const country = params.get('country_code')
    if (!country) return apiError(400, 'validation_failed', 'country_code is required')
    const region = params.get('region_id')
    return HttpResponse.json({
      items: searchCities({
        country_code: country,
        region_id: region ? Number(region) : null,
        q: params.get('q'),
        limit: Number(params.get('limit') ?? 20),
      }),
    })
  }),
]

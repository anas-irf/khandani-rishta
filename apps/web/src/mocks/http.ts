import { HttpResponse } from 'msw'
import { apiBaseUrl } from '~/lib/api'
import type { ApiFieldError, Page } from '~/lib/api-types'

/** Absolute URL of an API path, as MSW matches it. Path params use MSW syntax (`:id`). */
export function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`
}

let requestCounter = 0

/** An error body exactly as 15 section 2 defines it. */
export function apiError(
  status: number,
  code: string,
  message: string,
  extra: { fields?: ApiFieldError[]; details?: Record<string, unknown> } = {},
) {
  requestCounter += 1
  const requestId = `mock-${requestCounter.toString().padStart(6, '0')}`
  return HttpResponse.json(
    {
      error: {
        code,
        message,
        ...(extra.fields ? { fields: extra.fields } : {}),
        details: extra.details ?? {},
        request_id: requestId,
      },
    },
    { status, headers: { 'x-request-id': requestId } },
  )
}

export function validationError(fields: ApiFieldError[]) {
  return apiError(400, 'validation_failed', 'Some fields need your attention.', { fields })
}

export function notFound() {
  return apiError(404, 'not_found', 'This is no longer available.')
}

export function noContent() {
  return new HttpResponse(null, { status: 204 })
}

/** Cursor pagination over an array: the cursor is the offset (15 section 1). */
export function paginate<T>(items: T[], request: Request, defaultLimit = 20): Page<T> {
  const url = new URL(request.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? defaultLimit) || defaultLimit, 50)
  const offset = Number(url.searchParams.get('cursor') ?? 0) || 0
  const slice = items.slice(offset, offset + limit)
  const next = offset + limit < items.length ? String(offset + limit) : null
  return { items: slice, next_cursor: next }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    return {} as T
  }
}

/** A UUID for records created by the mock API. */
export function newId(): string {
  return crypto.randomUUID()
}

export function nowIso(): string {
  return new Date().toISOString()
}

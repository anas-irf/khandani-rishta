import { http, isApiError } from '~/lib/api'
import type { AppRelease } from '~/lib/api-types'

/** What the download page can show (16 section 7.8). */
export type ReleaseResult =
  | { status: 'ready'; release: AppRelease }
  /** No release exists yet (`404`). */
  | { status: 'none' }
  /** The API could not be reached or failed. The page still renders. */
  | { status: 'error' }

const REQUEST_TIMEOUT_MS = 5000

/** A download link must be a web address; anything else (for example `javascript:`) is refused. */
export function isSafeDownloadUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * `GET /v1/meta/app-release?platform=android` (15 section 5). Runs in the route loader, so on
 * the Worker during server rendering. Never throws: a missing release and every failure become
 * a result the page can explain, so a broken API never breaks the page.
 */
export async function loadAndroidRelease(): Promise<ReleaseResult> {
  try {
    const release = await http.get<AppRelease>('/v1/meta/app-release', {
      query: { platform: 'android' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!release || !isSafeDownloadUrl(release.download_url) || !release.version_name) {
      return { status: 'none' }
    }
    return { status: 'ready', release }
  } catch (error) {
    if (isApiError(error) && error.status === 404) return { status: 'none' }
    return { status: 'error' }
  }
}

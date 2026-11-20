import { MutationCache, QueryCache, QueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { isApiError, isGateError } from './api'
import type { InterestBox, InterestListStatus, Me, SearchFilters, SearchSort } from './api-types'
import { showLimitDialog } from './dialogs'
import { formatDate } from './format'
import { i18n } from './i18n'
import { reportError } from './monitoring'

// ---------------------------------------------------------------------------
// Query keys (17 section 6.2). Never write key arrays inline: use these functions.
// ---------------------------------------------------------------------------

export const qk = {
  me: () => ['me'] as const,
  referenceBootstrap: () => ['reference', 'bootstrap'] as const,
  regions: (countryCode: string) => ['reference', 'regions', countryCode] as const,
  cities: (params: { country_code: string; region_id?: number | null; q?: string }) =>
    ['reference', 'cities', params] as const,
  appRelease: () => ['meta', 'app-release', 'android'] as const,

  ownProfile: () => ['me', 'profile'] as const,
  ownProfilePreview: (as: 'member' | 'connection') => ['me', 'profile', 'preview', as] as const,
  preferences: () => ['me', 'preferences'] as const,
  privacy: () => ['me', 'privacy'] as const,
  photos: () => ['me', 'photos'] as const,
  identity: () => ['me', 'identity'] as const,
  verifications: () => ['me', 'verifications'] as const,
  selfieChallenge: () => ['me', 'verifications', 'selfie-challenge'] as const,
  notificationPreferences: () => ['me', 'notification-preferences'] as const,
  dataExport: () => ['me', 'exports', 'latest'] as const,

  home: () => ['home'] as const,
  recommendations: () => ['recommendations'] as const,
  searchAll: () => ['search'] as const,
  search: (filters: SearchFilters, sort: SearchSort) => ['search', filters, sort] as const,
  savedSearches: () => ['saved-searches'] as const,
  profileAll: () => ['profile'] as const,
  profile: (profileId: string) => ['profile', profileId] as const,
  /** `GET /v1/profiles/by-code/{public_code}` for the `/p/$publicCode` link. */
  profileByCode: (publicCode: string) => ['profile-by-code', publicCode] as const,

  interestsAll: () => ['interests'] as const,
  interests: (box: InterestBox, status: InterestListStatus) => ['interests', box, status] as const,
  interestsSent: () => ['interests', 'sent'] as const,
  interest: (interestId: string) => ['interest', interestId] as const,
  connectionsAll: () => ['connections'] as const,
  connections: (filter: 'active' | 'archived' | 'ended') => ['connections', filter] as const,
  connection: (connectionId: string) => ['connection', connectionId] as const,
  messages: (connectionId: string) => ['messages', connectionId] as const,

  shortlist: () => ['shortlist'] as const,
  visitors: () => ['visitors'] as const,
  visited: () => ['visited'] as const,
  blocks: () => ['blocks'] as const,
  photoAccessAll: () => ['photo-access'] as const,
  photoAccess: (box: 'received' | 'sent', status: string) => ['photo-access', box, status] as const,
  notifications: () => ['notifications'] as const,
  /** SET-ACCOUNT: whether a connection reached `nikah_done` (08 section 7.4); not a list cache. */
  nikahCheck: () => ['nikah-check'] as const,

  admin: (...parts: unknown[]) => ['admin', ...parts] as const,
}

/** Stale times from 17 section 6.2, in milliseconds. */
export const STALE = {
  me: 60_000,
  reference: 24 * 60 * 60_000,
  cities: 10 * 60_000,
  none: 0,
  home: 5 * 60_000,
  list: 60_000,
  connection: 30_000,
  savedSearches: 5 * 60_000,
} as const

// ---------------------------------------------------------------------------
// Query and mutation metadata, read by the global error handler.
// ---------------------------------------------------------------------------

export type AppMutationMeta = {
  /** Error codes the mutation handles itself; the global handler stays silent for them. */
  handles?: readonly string[]
  /** i18n key of the text of the limit dialog for this action (16 gives one per action). */
  limitText?: string
}

export type AppQueryMeta = {
  /** Error codes the screen handles itself. */
  handles?: readonly string[]
}

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: AppQueryMeta
    mutationMeta: AppMutationMeta
  }
}

// ---------------------------------------------------------------------------
// Error handling (17 section 6.4)
// ---------------------------------------------------------------------------

let queryClientRef: QueryClient | null = null

/** Refetches `Me` only (not every key that starts with `me`). */
export function invalidateMe(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: qk.me(), exact: true })
}

/** Replaces the cached `Me` with one returned by an endpoint (16 section 3.3). */
export function setMe(queryClient: QueryClient, me: Me) {
  queryClient.setQueryData(qk.me(), me)
}

/** The translated text of an API error, by code, falling back to the API's English message. */
export function errorMessage(error: unknown): string {
  if (!isApiError(error)) return i18n.t('errors:generic.action')
  if (
    error.code === 'internal_error' ||
    error.code === 'service_unavailable' ||
    error.code === 'network_error' ||
    error.code === 'upgrade_required'
  ) {
    return i18n.t('errors:generic.action')
  }
  if (error.code === 'rate_limited') {
    return i18n.t('errors:code.rate_limited', {
      seconds: Number(error.details.retry_after_seconds ?? 30),
    })
  }
  if (error.code === 'cooldown_active') {
    const date = error.details.retry_after_date
    return i18n.t('errors:code.cooldown_active', {
      date: typeof date === 'string' ? formatDate(date) : '',
    })
  }
  return i18n.t(`errors:code.${error.code}`, { defaultValue: error.message })
}

function showErrorToast(error: unknown) {
  const requestId = isApiError(error) ? error.requestId : null
  toast.error(errorMessage(error), {
    description: requestId ? i18n.t('errors:reference', { id: requestId }) : undefined,
  })
}

export function handleApiError(
  error: unknown,
  context: { kind: 'query' | 'mutation'; handles?: readonly string[]; limitText?: string },
) {
  const code = isApiError(error) ? error.code : 'internal_error'

  if (isGateError(error)) {
    if (queryClientRef) void invalidateMe(queryClientRef)
    return
  }
  if (code === 'unauthenticated' || code === 'validation_failed') return
  if (context.handles?.includes(code)) return

  const unexpected =
    !isApiError(error) ||
    code === 'internal_error' ||
    code === 'service_unavailable' ||
    code === 'upgrade_required'
  if (unexpected) reportError(error)

  // Screen loads show their own error state (16 rule G3); only actions toast.
  if (context.kind === 'query') return

  if (code === 'limit_reached' && isApiError(error)) {
    showLimitDialog({ textKey: context.limitText ?? null, details: error.details })
    return
  }
  showErrorToast(error)
}

function shouldRetry(failureCount: number, error: unknown) {
  if (failureCount >= 2) return false
  if (!isApiError(error)) return true
  return error.code === 'network_error' || error.status >= 500
}

export function createQueryClient() {
  const client = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) =>
        handleApiError(error, { kind: 'query', handles: query.meta?.handles }),
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) =>
        handleApiError(error, {
          kind: 'mutation',
          handles: mutation.meta?.handles,
          limitText: mutation.meta?.limitText,
        }),
    }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        refetchOnWindowFocus: true,
        gcTime: 10 * 60_000,
        staleTime: 0,
      },
      mutations: { retry: false },
    },
  })
  queryClientRef = client
  return client
}

/** For infinite lists: the cursor of the next page, or undefined on the last page. */
export function nextCursor(page: { next_cursor: string | null }): string | undefined {
  return page.next_cursor ?? undefined
}

/** Removes an item from every cached page of the infinite queries under `key`. */
export function removeFromPages<T>(
  queryClient: QueryClient,
  key: QueryKey,
  predicate: (item: T) => boolean,
) {
  queryClient.setQueriesData<{ pages: { items: T[] }[]; pageParams: unknown[] }>(
    { queryKey: key },
    (data) => {
      if (!data?.pages) return data
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.filter((item) => !predicate(item)),
        })),
      }
    },
  )
}

/** Applies `update` to every item of every cached page of the infinite queries under `key`. */
export function updateInPages<T>(queryClient: QueryClient, key: QueryKey, update: (item: T) => T) {
  queryClient.setQueriesData<{ pages: { items: T[] }[]; pageParams: unknown[] }>(
    { queryKey: key },
    (data) => {
      if (!data?.pages) return data
      return {
        ...data,
        pages: data.pages.map((page) => ({ ...page, items: page.items.map(update) })),
      }
    },
  )
}

import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { http, isApiError } from '~/lib/api'
import type {
  BlockEntry,
  CloseReason,
  Connection,
  DataExport,
  DeletionBody,
  Locale,
  Me,
  NotificationPreferences,
  Page,
  Privacy,
} from '~/lib/api-types'
import { setLanguage } from '~/lib/i18n'
import { invalidateMe, nextCursor, qk, STALE, setMe } from '~/lib/query'
import { SAVE_FAILURE_CODES } from './save-errors'

/**
 * Settings and account (15 sections 6, 7 and 13). Cache effects follow 17 section 6.3:
 * `PATCH /v1/me/privacy` sets `['me', 'privacy']`; pause, resume, close, reopen and deletion set
 * `['me']` from the response.
 */

// ---------------------------------------------------------------------------
// Privacy (SET-PRIVACY)
// ---------------------------------------------------------------------------

/** `GET /v1/me/privacy`. */
export function usePrivacy() {
  return useQuery({
    queryKey: qk.privacy(),
    queryFn: ({ signal }) => http.get<Privacy>('/v1/me/privacy', { signal }),
    staleTime: STALE.none,
    refetchOnMount: 'always',
  })
}

/**
 * `PATCH /v1/me/privacy` with only the changed keys. Not optimistic (16 rule G7): the cache gets
 * the returned `Privacy`. The screen shows its own text when the save fails.
 */
export function useUpdatePrivacy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (change: Partial<Privacy>) => http.patch<Privacy>('/v1/me/privacy', change),
    meta: { handles: SAVE_FAILURE_CODES },
    onSuccess: (privacy) => queryClient.setQueryData(qk.privacy(), privacy),
  })
}

// ---------------------------------------------------------------------------
// Notification preferences (SET-NOTIFS)
// ---------------------------------------------------------------------------

/** `GET /v1/me/notification-preferences`. */
export function useNotificationPreferences() {
  return useQuery({
    queryKey: qk.notificationPreferences(),
    queryFn: ({ signal }) =>
      http.get<NotificationPreferences>('/v1/me/notification-preferences', { signal }),
    staleTime: STALE.none,
    refetchOnMount: 'always',
  })
}

/** `PUT /v1/me/notification-preferences` with the complete object. */
export function useSaveNotificationPreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (preferences: NotificationPreferences) =>
      http.put<NotificationPreferences>('/v1/me/notification-preferences', preferences),
    meta: { handles: SAVE_FAILURE_CODES },
    onSuccess: (saved, sent) =>
      queryClient.setQueryData(qk.notificationPreferences(), saved ?? sent),
  })
}

// ---------------------------------------------------------------------------
// Blocked members (SET-BLOCKED)
// ---------------------------------------------------------------------------

/** `GET /v1/blocks`, `limit=20`. Unblocking is `useUnblockMember` in `features/relations`. */
export function useBlocks() {
  return useInfiniteQuery({
    queryKey: qk.blocks(),
    queryFn: ({ pageParam, signal }) =>
      http.get<Page<BlockEntry>>('/v1/blocks', {
        query: { limit: 20, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => nextCursor(page),
    staleTime: STALE.list,
  })
}

// ---------------------------------------------------------------------------
// Language (SET-ACCOUNT)
// ---------------------------------------------------------------------------

/** `PATCH /v1/me` with `{ locale }`: sets `Me` and switches the strings (17 section 12). */
export function useChangeLocale() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (locale: Locale) => http.patch<Me>('/v1/me', { locale }),
    meta: { handles: SAVE_FAILURE_CODES },
    onSuccess: (me) => {
      setMe(queryClient, me)
      void setLanguage(me.user.locale)
    },
  })
}

// ---------------------------------------------------------------------------
// Profile status (SET-ACCOUNT, 08 section 7)
// ---------------------------------------------------------------------------

/** Marks the data of every screen stale after the profile status changed. */
function invalidateScreenData(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] !== 'me' && query.queryKey[0] !== 'reference',
  })
}

/**
 * `invalid_state` means the status changed somewhere else: refetch `Me` and let the gate route
 * (08 section 7). Resolves to null then, so the caller shows nothing.
 */
async function orRefetchMe<T>(queryClient: QueryClient, call: () => Promise<T>): Promise<T | null> {
  try {
    return await call()
  } catch (error) {
    if (isApiError(error) && error.code === 'invalid_state') {
      await invalidateMe(queryClient)
      return null
    }
    throw error
  }
}

function useStatusChange<TVariables>(
  call: (variables: TVariables) => Promise<Me>,
  doneText: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: TVariables) => orRefetchMe(queryClient, () => call(variables)),
    onSuccess: (me) => {
      if (!me) return
      setMe(queryClient, me)
      invalidateScreenData(queryClient)
      toast.success(doneText)
    },
  })
}

/** `POST /v1/me/profile/pause` */
export function usePauseProfile() {
  const { t } = useTranslation('settings')
  return useStatusChange<void>(
    () => http.post<Me>('/v1/me/profile/pause'),
    t('account.status.pause.done'),
  )
}

/** `POST /v1/me/profile/resume` (no confirmation) */
export function useResumeProfile() {
  const { t } = useTranslation('settings')
  return useStatusChange<void>(
    () => http.post<Me>('/v1/me/profile/resume'),
    t('account.status.resume.done'),
  )
}

/** `POST /v1/me/profile/close` with the chosen reason */
export function useCloseProfile() {
  const { t } = useTranslation('settings')
  return useStatusChange<CloseReason>(
    (reason) => http.post<Me>('/v1/me/profile/close', { reason }),
    t('account.status.close.done'),
  )
}

/** `POST /v1/me/profile/reopen` with `{ confirm: true }` */
export function useReopenProfile() {
  const { t } = useTranslation('settings')
  return useStatusChange<void>(
    () => http.post<Me>('/v1/me/profile/reopen', { confirm: true }),
    t('account.status.reopen.done'),
  )
}

/**
 * Before reopening (08 section 7.4): `GET /v1/connections?filter=active`, looking for a connection
 * at `nikah_done`. Resolves to that connection's other member (or null when it is unavailable),
 * `false` when there is none. A failed check counts as none: the API still needs `confirm: true`.
 */
export function useNikahCheck(enabled: boolean) {
  return useQuery({
    queryKey: qk.nikahCheck(),
    enabled,
    retry: false,
    staleTime: STALE.none,
    queryFn: async ({ signal }) => {
      try {
        const page = await http.get<Page<Connection>>('/v1/connections', {
          query: { filter: 'active', limit: 50 },
          signal,
        })
        const done = page.items.find((connection) => connection.stage === 'nikah_done')
        return done ? { name: done.other?.display_name ?? null } : null
      } catch {
        return null
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Your data (SET-ACCOUNT, 09 section 12.1)
// ---------------------------------------------------------------------------

/**
 * `GET /v1/me/exports/latest`: null when no export exists (`404`). While the export is queued it
 * is refetched every 15 seconds, and only while the screen is visible.
 */
export function useDataExport() {
  return useQuery({
    queryKey: qk.dataExport(),
    queryFn: async ({ signal }): Promise<DataExport | null> => {
      try {
        return await http.get<DataExport>('/v1/me/exports/latest', { signal })
      } catch (error) {
        if (isApiError(error) && error.status === 404) return null
        throw error
      }
    },
    staleTime: STALE.none,
    refetchOnMount: 'always',
    refetchInterval: (query) => (query.state.data?.status === 'queued' ? 15_000 : false),
  })
}

/** `POST /v1/me/exports`: at most one request per 24 hours (`limit_reached`). */
export function useRequestExport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => http.post<{ status: 'queued' }>('/v1/me/exports'),
    meta: { limitText: 'settings:account.data.limit' },
    onSuccess: () => {
      const queued: DataExport = { status: 'queued', download_url: null, expires_at: null }
      queryClient.setQueryData(qk.dataExport(), queued)
    },
  })
}

// ---------------------------------------------------------------------------
// Deletion (SET-ACCOUNT, GATE-BLOCKED, GATE-CONSENT, GATE-DELETION; 06 section 9)
// ---------------------------------------------------------------------------

/**
 * `POST /v1/me/deletion`. `invalid_state` (already scheduled) refetches `Me` and routes. A
 * banned or suspended member keeps the gate (15 section 6); the returned `Me` carries
 * `purge_after`.
 */
export function useScheduleDeletion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: DeletionBody) =>
      orRefetchMe(queryClient, () => http.post<Me>('/v1/me/deletion', body)),
    onSuccess: (me) => {
      if (me) setMe(queryClient, me)
    },
  })
}

/** `DELETE /v1/me/deletion` ("Keep my account"). `invalid_state` refetches `Me` and routes. */
export function useCancelDeletion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => orRefetchMe(queryClient, () => http.delete<Me>('/v1/me/deletion')),
    onSuccess: (me) => {
      if (me) setMe(queryClient, me)
    },
  })
}

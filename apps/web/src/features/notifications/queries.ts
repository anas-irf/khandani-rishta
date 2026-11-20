import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { http } from '~/lib/api'
import type { Me, NotificationItem, Page } from '~/lib/api-types'
import { invalidateMe, nextCursor, qk, STALE, updateInPages } from '~/lib/query'

/**
 * The notification feed (15 section 14). Live updates come from the realtime client, which
 * invalidates `['notifications']` on `notification.new` (17 section 7.2); the badge follows the
 * `counters` event.
 */

/** `GET /v1/notifications`, newest first, `limit=20` (16 rule G6). */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: qk.notifications(),
    queryFn: ({ pageParam, signal }) =>
      http.get('/v1/notifications', {
        query: { limit: 20, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => nextCursor(page),
    staleTime: STALE.list,
  })
}

export type MarkReadVariables = { ids: string[] } | { all: true }

type FeedSnapshot = [readonly unknown[], InfiniteData<Page<NotificationItem>> | undefined][]

function setUnreadCounter(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (current: number) => number,
) {
  queryClient.setQueryData<Me>(qk.me(), (me) =>
    me
      ? {
          ...me,
          counters: {
            ...me.counters,
            unread_notifications: Math.max(0, update(me.counters.unread_notifications)),
          },
        }
      : me,
  )
}

function markInFeed(queryClient: ReturnType<typeof useQueryClient>, variables: MarkReadVariables) {
  const ids = 'ids' in variables ? new Set(variables.ids) : null
  updateInPages<NotificationItem>(queryClient, qk.notifications(), (item) =>
    !item.is_read && (ids === null || ids.has(item.id)) ? { ...item, is_read: true } : item,
  )
}

/**
 * `POST /v1/notifications/read` with `{ ids }` or `{ all: true }`. Marking rows read is one of
 * the optimistic updates 16 rule G7 allows: the dots and the counter change at once and are put
 * back when the request fails (the global handler shows the toast). "Mark all as read" is
 * applied when the server confirms. After either, `['me']` is refetched so the counters match.
 */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: MarkReadVariables) => http.post('/v1/notifications/read', variables),
    onMutate: async (variables) => {
      if (!('ids' in variables)) return { snapshot: undefined, previousMe: undefined }
      await queryClient.cancelQueries({ queryKey: qk.notifications() })
      const snapshot = queryClient.getQueriesData<InfiniteData<Page<NotificationItem>>>({
        queryKey: qk.notifications(),
      }) as FeedSnapshot
      const previousMe = queryClient.getQueryData<Me>(qk.me())

      const wanted = new Set(variables.ids)
      const unreadNow = new Set<string>()
      for (const [, data] of snapshot) {
        for (const page of data?.pages ?? []) {
          for (const item of page.items) {
            if (wanted.has(item.id) && !item.is_read) unreadNow.add(item.id)
          }
        }
      }
      markInFeed(queryClient, variables)
      setUnreadCounter(queryClient, (current) => current - unreadNow.size)
      return { snapshot, previousMe }
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data)
      if (context?.previousMe) queryClient.setQueryData(qk.me(), context.previousMe)
    },
    onSuccess: (_data, variables) => {
      if ('all' in variables) {
        markInFeed(queryClient, variables)
        setUnreadCounter(queryClient, () => 0)
      }
    },
    onSettled: () => {
      void invalidateMe(queryClient)
    },
  })
}

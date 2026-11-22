import { type QueryClient, type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { http, isApiError, seg } from '~/lib/api'
import type {
  Connection,
  Home,
  Interest,
  PhotoAccessEntry,
  ProfileCard,
  ProfileDetail,
  ReportBody,
  ShortlistEntry,
  Visit,
} from '~/lib/api-types'
import { formatDate } from '~/lib/format'
import { invalidateMe, qk, removeFromPages, updateInPages } from '~/lib/query'

/**
 * Shortlist, pass, block, report and photo access requests (15 section 13), used by the shared
 * components (ProfileCard, ReportDialog, BlockDialog) and by the profile screen. Cache effects
 * follow 17 section 6.3; optimistic updates only where 16 rule G7 allows them (shortlist, pass).
 */

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/** Infinite lists whose items are profile cards, or hold one in `profile` (17 section 6.2). */
const CARD_LIST_KEYS: readonly QueryKey[] = [
  qk.recommendations(),
  qk.searchAll(),
  qk.interestsAll(),
  qk.shortlist(),
  qk.visitors(),
  qk.visited(),
]

type Snapshot = [QueryKey, unknown][]

function takeSnapshot(queryClient: QueryClient, keys: readonly QueryKey[]): Snapshot {
  return keys.flatMap((queryKey) => queryClient.getQueriesData({ queryKey }))
}

function restoreSnapshot(queryClient: QueryClient, snapshot: Snapshot | undefined) {
  for (const [queryKey, data] of snapshot ?? []) queryClient.setQueryData(queryKey, data)
}

function isProfileCard(value: unknown): value is ProfileCard {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'display_name' in value &&
    'relation' in value
  )
}

/** Applies `update` to the card with this id, whether the item is a card or holds one. */
function mapCardIn<T>(item: T, profileId: string, update: (card: ProfileCard) => ProfileCard): T {
  if (isProfileCard(item)) return (item.id === profileId ? update(item) : item) as T
  if (typeof item === 'object' && item !== null && 'profile' in item) {
    const profile = (item as { profile: unknown }).profile
    if (isProfileCard(profile) && profile.id === profileId) {
      return { ...item, profile: update(profile) }
    }
  }
  return item
}

function mapHomeCards(home: Home, map: (cards: ProfileCard[]) => ProfileCard[]): Home {
  return {
    ...home,
    recommendations: map(home.recommendations),
    new_members: map(home.new_members),
    nearby: map(home.nearby),
    recent_visitors: map(home.recent_visitors),
  }
}

/** Sets `relation.is_shortlisted` of one profile in every cache that shows it. */
function setShortlisted(
  queryClient: QueryClient,
  profileId: string,
  shortlisted: boolean,
  note: string | undefined,
) {
  const update = (card: ProfileCard): ProfileCard => ({
    ...card,
    relation: { ...card.relation, is_shortlisted: shortlisted },
  })
  queryClient.setQueryData<ProfileDetail>(qk.profile(profileId), (detail) =>
    detail
      ? {
          ...detail,
          card: update(detail.card),
          relation: {
            ...detail.relation,
            is_shortlisted: shortlisted,
            shortlist_note: shortlisted ? (note ?? detail.relation.shortlist_note) : null,
          },
        }
      : detail,
  )
  queryClient.setQueryData<Home>(qk.home(), (home) =>
    home
      ? mapHomeCards(home, (cards) => cards.map((card) => mapCardIn(card, profileId, update)))
      : home,
  )
  for (const key of CARD_LIST_KEYS) {
    updateInPages<unknown>(queryClient, key, (item) => mapCardIn(item, profileId, update))
  }
}

/** Removes a profile's card from the home rows. */
function removeFromHome(queryClient: QueryClient, profileId: string) {
  queryClient.setQueryData<Home>(qk.home(), (home) =>
    home ? mapHomeCards(home, (cards) => cards.filter((card) => card.id !== profileId)) : home,
  )
}

/**
 * After a block (directly or with a report): the member disappears from every cached list
 * (16 section 6.7), then the keys of 17 section 6.3 are refetched and the profile is dropped.
 */
function applyBlockEffects(queryClient: QueryClient, profileId: string) {
  removeFromHome(queryClient, profileId)
  removeFromPages<ProfileCard>(queryClient, qk.recommendations(), (card) => card.id === profileId)
  removeFromPages<ProfileCard>(queryClient, qk.searchAll(), (card) => card.id === profileId)
  removeFromPages<Interest>(
    queryClient,
    qk.interestsAll(),
    (item) => item.profile?.id === profileId,
  )
  removeFromPages<ShortlistEntry>(
    queryClient,
    qk.shortlist(),
    (entry) => entry.profile_id === profileId,
  )
  removeFromPages<Visit>(queryClient, qk.visitors(), (visit) => visit.profile.id === profileId)
  removeFromPages<Visit>(queryClient, qk.visited(), (visit) => visit.profile.id === profileId)
  removeFromPages<Connection>(
    queryClient,
    qk.connectionsAll(),
    (item) => item.other?.id === profileId,
  )
  removeFromPages<PhotoAccessEntry>(
    queryClient,
    qk.photoAccessAll(),
    (entry) => entry.profile_id === profileId,
  )

  queryClient.removeQueries({ queryKey: qk.profile(profileId) })
  for (const queryKey of [
    qk.connectionsAll(),
    qk.interestsAll(),
    qk.shortlist(),
    qk.home(),
    qk.recommendations(),
    qk.blocks(),
  ]) {
    void queryClient.invalidateQueries({ queryKey })
  }
  void invalidateMe(queryClient)
}

// ---------------------------------------------------------------------------
// Shortlist
// ---------------------------------------------------------------------------

export type ShortlistVariables = {
  profileId: string
  /** The state to reach: true adds (or updates the note), false removes. */
  shortlisted: boolean
  /** At most 300 characters (16 section 6.7). Only sent when adding. */
  note?: string
}

/**
 * `PUT /v1/shortlist/{profile_id}` with `{}` (or `{ note }`) and `DELETE` for the heart.
 * Optimistic in `['profile', id]` and every list cache that shows the card; reverted on error
 * (the global handler shows the toast, or the limit dialog for a full shortlist).
 */
export function useShortlistToggle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ profileId, shortlisted, note }: ShortlistVariables) =>
      shortlisted
        ? http.put(`/v1/shortlist/${seg(profileId)}`, note === undefined ? {} : { note })
        : http.delete(`/v1/shortlist/${seg(profileId)}`),
    meta: { limitText: 'shared:shortlist.full', errorText: 'shared:shortlist.failed' },
    onMutate: async ({ profileId, shortlisted, note }) => {
      await queryClient.cancelQueries({ queryKey: qk.profile(profileId) })
      const previous = takeSnapshot(queryClient, [
        qk.profile(profileId),
        qk.home(),
        ...CARD_LIST_KEYS,
      ])
      setShortlisted(queryClient, profileId, shortlisted, note)
      return { previous }
    },
    onError: (_error, _variables, result) => restoreSnapshot(queryClient, result?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.shortlist() }),
  })
}

// ---------------------------------------------------------------------------
// Pass ("Not interested")
// ---------------------------------------------------------------------------

/**
 * `PUT /v1/passes/{profile_id}`. Optimistic: the card leaves `['home']`, `['recommendations']`
 * and the search caches at once and comes back on error; `['profile', id]` is refetched.
 */
export function usePass() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (profileId: string) => http.put(`/v1/passes/${seg(profileId)}`),
    onMutate: async (profileId) => {
      const previous = takeSnapshot(queryClient, [qk.home(), qk.recommendations(), qk.searchAll()])
      removeFromHome(queryClient, profileId)
      removeFromPages<ProfileCard>(queryClient, qk.recommendations(), (c) => c.id === profileId)
      removeFromPages<ProfileCard>(queryClient, qk.searchAll(), (c) => c.id === profileId)
      return { previous }
    },
    onError: (_error, _profileId, result) => restoreSnapshot(queryClient, result?.previous),
    onSuccess: (_data, profileId) =>
      queryClient.invalidateQueries({ queryKey: qk.profile(profileId) }),
  })
}

/** `DELETE /v1/passes/{profile_id}`: the "Undo" of the pass toast. The lists are refetched. */
export function useUndoPass() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (profileId: string) => http.delete(`/v1/passes/${seg(profileId)}`),
    onSuccess: (_data, profileId) => {
      for (const queryKey of [
        qk.profile(profileId),
        qk.home(),
        qk.recommendations(),
        qk.searchAll(),
      ]) {
        void queryClient.invalidateQueries({ queryKey })
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Block
// ---------------------------------------------------------------------------

/**
 * `PUT /v1/blocks/{profile_id}`. Waits for the server (G7). On success the member leaves every
 * cached list, the keys of 17 section 6.3 are invalidated and `['profile', id]` is removed;
 * the caller navigates back.
 */
export function useBlockMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (profileId: string) => http.put(`/v1/blocks/${seg(profileId)}`),
    onSuccess: (_data, profileId) => applyBlockEffects(queryClient, profileId),
  })
}

/** `DELETE /v1/blocks/{profile_id}`: the row leaves `['blocks']` (16 section 6.29). */
export function useUnblockMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (profileId: string) => http.delete(`/v1/blocks/${seg(profileId)}`),
    onSuccess: (_data, profileId) => {
      removeFromPages<{ profile_id: string }>(
        queryClient,
        qk.blocks(),
        (entry) => entry.profile_id === profileId,
      )
      void queryClient.invalidateQueries({ queryKey: qk.blocks() })
    },
  })
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * `POST /v1/reports` (13 section 6.4). With `also_block` the API applies the block in the same
 * transaction, so the block's cache effects follow. `limit_reached` opens the limit dialog with
 * the text of 16 section 6.11.
 */
export function useReportMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ReportBody) => http.post('/v1/reports', body),
    meta: { limitText: 'shared:report.limit' },
    onSuccess: (_data, body) => {
      if (body.also_block) applyBlockEffects(queryClient, body.target_profile_id)
    },
  })
}

// ---------------------------------------------------------------------------
// Photo access request
// ---------------------------------------------------------------------------

/**
 * `POST /v1/profiles/{profile_id}/photo-access` ("Request photos", 16 sections 5.6 and 6.7).
 * Shows its own toasts: "Request sent." on success, and the texts of 6.7 for
 * `not_permitted_by_member` and `cooldown_active`; `invalid_state` and `already_exists` refetch
 * the profile. `limit_reached` opens the limit dialog with the photo request text.
 */
export function useRequestPhotoAccess() {
  const queryClient = useQueryClient()
  const { t } = useTranslation('shared')

  const refetchProfile = (profileId: string) =>
    queryClient.invalidateQueries({ queryKey: qk.profile(profileId) })

  return useMutation({
    mutationFn: (profileId: string) => http.post(`/v1/profiles/${seg(profileId)}/photo-access`),
    meta: {
      handles: ['not_permitted_by_member', 'cooldown_active', 'already_exists', 'invalid_state'],
      limitText: 'shared:photo_access.limit',
    },
    onSuccess: (_data, profileId) => {
      toast.success(t('photo_access.sent'))
      void queryClient.invalidateQueries({ queryKey: qk.photoAccessAll() })
      void refetchProfile(profileId)
      void invalidateMe(queryClient)
    },
    onError: (error, profileId) => {
      if (!isApiError(error)) return
      switch (error.code) {
        case 'not_permitted_by_member':
          toast.error(t('photo_access.not_permitted'))
          break
        case 'cooldown_active': {
          const date = error.details.retry_after_date
          toast.error(
            t('photo_access.cooldown', { date: typeof date === 'string' ? formatDate(date) : '' }),
          )
          break
        }
        case 'already_exists':
        case 'invalid_state':
          void refetchProfile(profileId)
          break
        default:
          break
      }
    },
  })
}

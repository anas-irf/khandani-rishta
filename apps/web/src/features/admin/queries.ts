import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { http, isApiError, seg } from '~/lib/api'
import type { Page } from '~/lib/api-types'
import { i18n } from '~/lib/i18n'
import { nextCursor, qk, removeFromPages, STALE } from '~/lib/query'
import type {
  AdminCaste,
  AdminOverview,
  AdminPhotoItem,
  AdminProfile,
  AdminProfileListItem,
  AdminRelease,
  AdminReportDetail,
  AdminReportListItem,
  AdminSetting,
  AdminTextItem,
  AdminUser,
  AdminUserListItem,
  AdminVerificationDetail,
  AdminVerificationListItem,
  AnnouncementBody,
  AnnouncementResult,
  AuditEntry,
  AuditFilters,
  BanBody,
  CasteSuggestionItem,
  CreateCasteBody,
  CreateReleaseBody,
  LockedFieldsBody,
  PromoteSuggestionBody,
  ReportResolveBody,
  RequestChangesBody,
  RoleBody,
  SuspendBody,
  TextRejectBody,
  UpdateCasteBody,
  VerificationApproveBody,
  VerificationRejectBody,
  WarnBody,
} from './types'

/**
 * Admin routes (15 section 16, 18). Every key lives under `qk.admin(...)` and every query is
 * always refetched (`staleTime` 0, 17 section 6.2). A decision removes the item from the cached
 * queue pages at once, so it leaves the list without a reload (18 section 3), then refreshes
 * the counts of the overview.
 */

const ADMIN = '/v1/admin'
const PAGE_SIZE = 20

export const adminKeys = {
  overview: () => qk.admin('overview'),
  profileLists: () => qk.admin('profiles', 'list'),
  profileList: (filters: ProfileFilters) => qk.admin('profiles', 'list', filters),
  profile: (profileId: string) => qk.admin('profiles', 'detail', profileId),
  photoLists: () => qk.admin('photos'),
  photoList: (status: string) => qk.admin('photos', status),
  texts: () => qk.admin('texts'),
  verificationLists: () => qk.admin('verifications', 'list'),
  verificationList: (filters: VerificationFilters) => qk.admin('verifications', 'list', filters),
  verification: (requestId: string) => qk.admin('verifications', 'detail', requestId),
  reportLists: () => qk.admin('reports', 'list'),
  reportList: (status: string) => qk.admin('reports', 'list', { status }),
  report: (reportId: string) => qk.admin('reports', 'detail', reportId),
  userLists: () => qk.admin('users', 'list'),
  userList: (filters: UserFilters) => qk.admin('users', 'list', filters),
  user: (userId: string) => qk.admin('users', 'detail', userId),
  casteSuggestions: () => qk.admin('caste-suggestions'),
  castes: () => qk.admin('castes'),
  settings: () => qk.admin('settings'),
  releases: () => qk.admin('releases'),
  audit: (filters: AuditFilters) => qk.admin('audit-log', filters),
}

export type ProfileFilters = { status: string; q?: string }
export type VerificationFilters = { status: string; kind?: string }
export type UserFilters = { q: string; status?: string; role?: string }

/** Minimum length of a user search (18 section 5.1). */
export const USER_SEARCH_MIN_LENGTH = 3

function useAdminList<T>(
  key: readonly unknown[],
  path: string,
  params: Record<string, string | number | undefined>,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) =>
      http.get<Page<T>>(path, {
        query: { ...params, limit: PAGE_SIZE, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    staleTime: STALE.none,
    enabled,
  })
}

// ---------------------------------------------------------------------------
// Mutation plumbing
// ---------------------------------------------------------------------------

/** What to refresh when a decision answers `409 invalid_state` (someone else got there first). */
function refreshAfterConflict(queryClient: QueryClient, keys: readonly (readonly unknown[])[]) {
  toast.error(i18n.t('admin:errors.invalid_state'))
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: key })
  void queryClient.invalidateQueries({ queryKey: adminKeys.overview() })
}

function useDecision<TVariables>(options: {
  request: (variables: TVariables) => Promise<unknown>
  /** Cache effects on success. */
  onDone: (queryClient: QueryClient, variables: TVariables) => void
  /** Queries to refresh on `409 invalid_state`. */
  conflictKeys?: (variables: TVariables) => readonly (readonly unknown[])[]
  /** More error codes the screen handles itself (the global toast stays silent for them). */
  handles?: readonly string[]
}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: options.request,
    meta: { handles: ['invalid_state', ...(options.handles ?? [])] },
    onSuccess: (_result, variables) => {
      options.onDone(queryClient, variables)
      void queryClient.invalidateQueries({ queryKey: adminKeys.overview() })
    },
    onError: (error, variables) => {
      if (isApiError(error) && error.code === 'invalid_state') {
        refreshAfterConflict(queryClient, options.conflictKeys?.(variables) ?? [])
      }
    },
  })
}

/** Marks the lists under `key` stale without refetching the ones on screen (already patched). */
function markStale(queryClient: QueryClient, key: readonly unknown[]) {
  void queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' })
}

// ---------------------------------------------------------------------------
// ADM-HOME
// ---------------------------------------------------------------------------

/** Refreshed every 60 seconds (18 section 3). */
export function useAdminOverview() {
  return useQuery({
    queryKey: adminKeys.overview(),
    queryFn: ({ signal }) => http.get<AdminOverview>(`${ADMIN}/overview`, { signal }),
    staleTime: STALE.none,
    refetchInterval: 60_000,
  })
}

// ---------------------------------------------------------------------------
// ADM-PROFILES, ADM-PROFILE
// ---------------------------------------------------------------------------

export function useAdminProfiles(filters: ProfileFilters) {
  return useAdminList<AdminProfileListItem>(adminKeys.profileList(filters), `${ADMIN}/profiles`, {
    status: filters.status,
    q: filters.q,
  })
}

export function useAdminProfile(
  profileId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: adminKeys.profile(profileId ?? ''),
    queryFn: ({ signal }) =>
      http.get<AdminProfile>(`${ADMIN}/profiles/${seg(profileId ?? '')}`, { signal }),
    enabled: Boolean(profileId) && (options.enabled ?? true),
    staleTime: STALE.none,
  })
}

function profileDecisionDone(queryClient: QueryClient, profileId: string) {
  removeFromPages<AdminProfileListItem>(
    queryClient,
    adminKeys.profileList({ status: 'pending_review' }),
    (item) => item.profile_id === profileId,
  )
  markStale(queryClient, adminKeys.profileLists())
  void queryClient.invalidateQueries({ queryKey: adminKeys.profile(profileId) })
}

export function useApproveProfile() {
  return useDecision({
    request: (profileId: string) => http.post(`${ADMIN}/profiles/${seg(profileId)}/approve`),
    onDone: (queryClient, profileId) => profileDecisionDone(queryClient, profileId),
    conflictKeys: (profileId) => [adminKeys.profile(profileId), adminKeys.profileLists()],
  })
}

export function useRequestProfileChanges() {
  return useDecision({
    request: (variables: { profileId: string } & RequestChangesBody) =>
      http.post(`${ADMIN}/profiles/${seg(variables.profileId)}/request-changes`, {
        reason: variables.reason,
      }),
    onDone: (queryClient, variables) => profileDecisionDone(queryClient, variables.profileId),
    conflictKeys: (variables) => [adminKeys.profile(variables.profileId), adminKeys.profileLists()],
  })
}

export function useCorrectLockedFields() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { profileId: string } & LockedFieldsBody) => {
      const { profileId, ...body } = variables
      return http.patch(`${ADMIN}/profiles/${seg(profileId)}/locked-fields`, body)
    },
    meta: { handles: ['validation_failed'] },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.profile(variables.profileId) })
      markStale(queryClient, adminKeys.profileLists())
      markStale(queryClient, adminKeys.userLists())
    },
  })
}

// ---------------------------------------------------------------------------
// ADM-PHOTOS
// ---------------------------------------------------------------------------

export function useAdminPhotos(status: string) {
  return useAdminList<AdminPhotoItem>(adminKeys.photoList(status), `${ADMIN}/photos`, { status })
}

export function useApprovePhoto() {
  return useDecision({
    request: (photoId: string) => http.post(`${ADMIN}/photos/${seg(photoId)}/approve`),
    onDone: (queryClient, photoId) => {
      removeFromPages<AdminPhotoItem>(
        queryClient,
        adminKeys.photoList('pending_review'),
        (item) => item.photo_id === photoId,
      )
      markStale(queryClient, adminKeys.photoLists())
      void queryClient.invalidateQueries({ queryKey: qk.admin('profiles', 'detail') })
    },
    conflictKeys: () => [adminKeys.photoLists()],
  })
}

/** Rejecting a photo also works on an approved one (a reported photo, 18 section 4.2). */
export function useRejectPhoto() {
  return useDecision({
    request: (variables: { photoId: string; reason: string }) =>
      http.post(`${ADMIN}/photos/${seg(variables.photoId)}/reject`, { reason: variables.reason }),
    onDone: (queryClient, variables) => {
      removeFromPages<AdminPhotoItem>(
        queryClient,
        adminKeys.photoLists(),
        (item) => item.photo_id === variables.photoId,
      )
      markStale(queryClient, adminKeys.photoLists())
      void queryClient.invalidateQueries({ queryKey: qk.admin('profiles', 'detail') })
      void queryClient.invalidateQueries({ queryKey: adminKeys.reportLists() })
      void queryClient.invalidateQueries({ queryKey: qk.admin('reports', 'detail') })
    },
    conflictKeys: () => [adminKeys.photoLists()],
  })
}

// ---------------------------------------------------------------------------
// ADM-TEXTS
// ---------------------------------------------------------------------------

export function useAdminTexts() {
  return useAdminList<AdminTextItem>(adminKeys.texts(), `${ADMIN}/texts`, {})
}

type TextDecision = { profileId: string; field: string; text_sha256: string }

function textDone(queryClient: QueryClient, variables: TextDecision) {
  removeFromPages<AdminTextItem>(
    queryClient,
    adminKeys.texts(),
    (item) => item.profile_id === variables.profileId && item.field === variables.field,
  )
  void queryClient.invalidateQueries({ queryKey: qk.admin('profiles', 'detail') })
}

export function useApproveText() {
  return useDecision({
    request: (variables: TextDecision) =>
      http.post(`${ADMIN}/texts/${seg(variables.profileId)}/${seg(variables.field)}/approve`, {
        text_sha256: variables.text_sha256,
      }),
    onDone: textDone,
    conflictKeys: () => [adminKeys.texts()],
  })
}

export function useRejectText() {
  return useDecision({
    request: (variables: TextDecision & Pick<TextRejectBody, 'note'>) =>
      http.post(`${ADMIN}/texts/${seg(variables.profileId)}/${seg(variables.field)}/reject`, {
        text_sha256: variables.text_sha256,
        ...(variables.note ? { note: variables.note } : {}),
      }),
    onDone: textDone,
    conflictKeys: () => [adminKeys.texts()],
  })
}

// ---------------------------------------------------------------------------
// ADM-VERIFICATIONS, ADM-VERIFICATION
// ---------------------------------------------------------------------------

export function useAdminVerifications(filters: VerificationFilters) {
  return useAdminList<AdminVerificationListItem>(
    adminKeys.verificationList(filters),
    `${ADMIN}/verifications`,
    { status: filters.status, kind: filters.kind },
  )
}

/**
 * Every call writes an audit entry (`verification.view`) and the image links last 10 minutes, so
 * the detail is never refetched on focus or reconnect: "Reload images" does it on purpose.
 */
export function useAdminVerification(requestId: string | undefined) {
  return useQuery({
    queryKey: adminKeys.verification(requestId ?? ''),
    queryFn: ({ signal }) =>
      http.get<AdminVerificationDetail>(`${ADMIN}/verifications/${seg(requestId ?? '')}`, {
        signal,
      }),
    enabled: Boolean(requestId),
    staleTime: STALE.none,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

function verificationDone(queryClient: QueryClient, requestId: string, status: string) {
  removeFromPages<AdminVerificationListItem>(
    queryClient,
    qk.admin('verifications', 'list', { status: 'pending' }),
    (item) => item.request_id === requestId,
  )
  markStale(queryClient, adminKeys.verificationLists())
  // The decided request is not fetched again: that would write another `verification.view`.
  queryClient.setQueryData<AdminVerificationDetail>(adminKeys.verification(requestId), (old) =>
    old ? { ...old, status } : old,
  )
  void queryClient.invalidateQueries({ queryKey: qk.admin('profiles', 'detail') })
}

export function useApproveVerification() {
  return useDecision({
    request: (variables: { requestId: string } & VerificationApproveBody) =>
      http.post(`${ADMIN}/verifications/${seg(variables.requestId)}/approve`, {
        ...(variables.photos_match === undefined ? {} : { photos_match: variables.photos_match }),
      }),
    onDone: (queryClient, variables) =>
      verificationDone(queryClient, variables.requestId, 'approved'),
    conflictKeys: () => [adminKeys.verificationLists()],
  })
}

export function useRejectVerification() {
  return useDecision({
    request: (variables: { requestId: string } & VerificationRejectBody) =>
      http.post(`${ADMIN}/verifications/${seg(variables.requestId)}/reject`, {
        reason: variables.reason,
        ...(variables.note ? { note: variables.note } : {}),
      }),
    onDone: (queryClient, variables) =>
      verificationDone(queryClient, variables.requestId, 'rejected'),
    conflictKeys: () => [adminKeys.verificationLists()],
  })
}

// ---------------------------------------------------------------------------
// ADM-REPORTS, ADM-REPORT
// ---------------------------------------------------------------------------

export function useAdminReports(status: string) {
  return useAdminList<AdminReportListItem>(adminKeys.reportList(status), `${ADMIN}/reports`, {
    status,
  })
}

export function useAdminReport(reportId: string | undefined) {
  return useQuery({
    queryKey: adminKeys.report(reportId ?? ''),
    queryFn: ({ signal }) =>
      http.get<AdminReportDetail>(`${ADMIN}/reports/${seg(reportId ?? '')}`, { signal }),
    enabled: Boolean(reportId),
    staleTime: STALE.none,
  })
}

export function useClaimReport() {
  return useDecision({
    request: (reportId: string) => http.post(`${ADMIN}/reports/${seg(reportId)}/claim`),
    onDone: (queryClient, reportId) => {
      removeFromPages<AdminReportListItem>(
        queryClient,
        adminKeys.reportList('open'),
        (item) => item.report_id === reportId,
      )
      markStale(queryClient, adminKeys.reportLists())
      void queryClient.invalidateQueries({ queryKey: adminKeys.report(reportId) })
    },
    conflictKeys: (reportId) => [adminKeys.report(reportId), adminKeys.reportLists()],
  })
}

export function useResolveReport() {
  return useDecision({
    request: (variables: { reportId: string } & ReportResolveBody) =>
      http.post(`${ADMIN}/reports/${seg(variables.reportId)}/resolve`, {
        outcome: variables.outcome,
        note: variables.note,
      }),
    onDone: (queryClient, variables) => {
      for (const status of ['open', 'in_review']) {
        removeFromPages<AdminReportListItem>(
          queryClient,
          adminKeys.reportList(status),
          (item) => item.report_id === variables.reportId,
        )
      }
      markStale(queryClient, adminKeys.reportLists())
      void queryClient.invalidateQueries({ queryKey: adminKeys.report(variables.reportId) })
    },
    conflictKeys: (variables) => [adminKeys.report(variables.reportId), adminKeys.reportLists()],
  })
}

// ---------------------------------------------------------------------------
// ADM-USERS, ADM-USER
// ---------------------------------------------------------------------------

/** Runs only for a search of at least 3 characters: there is no "browse members" list. */
export function useAdminUsers(filters: UserFilters) {
  return useAdminList<AdminUserListItem>(
    adminKeys.userList(filters),
    `${ADMIN}/users`,
    { q: filters.q, status: filters.status, role: filters.role },
    filters.q.trim().length >= USER_SEARCH_MIN_LENGTH,
  )
}

export function useAdminUser(userId: string | undefined) {
  return useQuery({
    queryKey: adminKeys.user(userId ?? ''),
    queryFn: ({ signal }) => http.get<AdminUser>(`${ADMIN}/users/${seg(userId ?? '')}`, { signal }),
    enabled: Boolean(userId),
    staleTime: STALE.none,
  })
}

function userChanged(queryClient: QueryClient, userId: string) {
  void queryClient.invalidateQueries({ queryKey: adminKeys.user(userId) })
  markStale(queryClient, adminKeys.userLists())
  void queryClient.invalidateQueries({ queryKey: qk.admin('profiles', 'detail') })
  void queryClient.invalidateQueries({ queryKey: qk.admin('reports', 'detail') })
}

function useUserAction<TVariables extends { userId: string }>(
  request: (variables: TVariables) => Promise<unknown>,
) {
  return useDecision<TVariables>({
    request,
    onDone: (queryClient, variables) => userChanged(queryClient, variables.userId),
    conflictKeys: (variables) => [adminKeys.user(variables.userId)],
  })
}

export function useWarnUser() {
  return useUserAction((variables: { userId: string } & WarnBody) => {
    const { userId, ...body } = variables
    return http.post(`${ADMIN}/users/${seg(userId)}/warn`, body)
  })
}

export function useSuspendUser() {
  return useUserAction((variables: { userId: string } & SuspendBody) => {
    const { userId, ...body } = variables
    return http.post(`${ADMIN}/users/${seg(userId)}/suspend`, body)
  })
}

export function useUnsuspendUser() {
  return useUserAction((variables: { userId: string }) =>
    http.post(`${ADMIN}/users/${seg(variables.userId)}/unsuspend`),
  )
}

export function useBanUser() {
  return useUserAction((variables: { userId: string } & BanBody) => {
    const { userId, ...body } = variables
    return http.post(`${ADMIN}/users/${seg(userId)}/ban`, body)
  })
}

export function useUnbanUser() {
  return useUserAction((variables: { userId: string }) =>
    http.post(`${ADMIN}/users/${seg(variables.userId)}/unban`),
  )
}

export function useChangeRole() {
  return useUserAction((variables: { userId: string } & RoleBody) =>
    http.patch(`${ADMIN}/users/${seg(variables.userId)}/role`, { role: variables.role }),
  )
}

// ---------------------------------------------------------------------------
// ADM-CASTES
// ---------------------------------------------------------------------------

export function useCasteSuggestions() {
  return useAdminList<CasteSuggestionItem>(
    adminKeys.casteSuggestions(),
    `${ADMIN}/caste-suggestions`,
    {
      status: 'pending',
    },
  )
}

/** Castes are also in the reference bootstrap, which a change reloads on the server. */
function castesChanged(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: adminKeys.castes() })
  void queryClient.invalidateQueries({ queryKey: qk.referenceBootstrap() })
}

export function usePromoteSuggestion() {
  return useDecision({
    request: (variables: { id: string } & PromoteSuggestionBody) => {
      const { id, ...body } = variables
      return http.post(`${ADMIN}/caste-suggestions/${seg(id)}/promote`, body)
    },
    onDone: (queryClient, variables) => {
      removeFromPages<CasteSuggestionItem>(
        queryClient,
        adminKeys.casteSuggestions(),
        (item) => item.id === variables.id,
      )
      castesChanged(queryClient)
    },
    conflictKeys: () => [adminKeys.casteSuggestions()],
    handles: ['already_exists', 'validation_failed'],
  })
}

export function useRejectSuggestion() {
  return useDecision({
    request: (id: string) => http.post(`${ADMIN}/caste-suggestions/${seg(id)}/reject`),
    onDone: (queryClient, id) => {
      removeFromPages<CasteSuggestionItem>(
        queryClient,
        adminKeys.casteSuggestions(),
        (item) => item.id === id,
      )
    },
    conflictKeys: () => [adminKeys.casteSuggestions()],
  })
}

export function useAdminCastes() {
  return useQuery({
    queryKey: adminKeys.castes(),
    queryFn: ({ signal }) => http.get<{ items: AdminCaste[] }>(`${ADMIN}/castes`, { signal }),
    select: (data) => data.items,
    staleTime: STALE.none,
  })
}

export function useCreateCaste() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCasteBody) => http.post(`${ADMIN}/castes`, body),
    meta: { handles: ['validation_failed', 'already_exists'] },
    onSuccess: () => castesChanged(queryClient),
  })
}

export function useUpdateCaste() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { code: string } & UpdateCasteBody) => {
      const { code, ...body } = variables
      return http.patch(`${ADMIN}/castes/${seg(code)}`, body)
    },
    meta: { handles: ['validation_failed', 'invalid_state'] },
    onSuccess: () => castesChanged(queryClient),
  })
}

// ---------------------------------------------------------------------------
// ADM-SETTINGS, ADM-RELEASES, ADM-ANNOUNCE
// ---------------------------------------------------------------------------

export function useAdminSettings() {
  return useQuery({
    queryKey: adminKeys.settings(),
    queryFn: ({ signal }) => http.get<{ items: AdminSetting[] }>(`${ADMIN}/settings`, { signal }),
    select: (data) => data.items,
    staleTime: STALE.none,
  })
}

export function useSaveSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { key: string; value: unknown }) =>
      http.put(`${ADMIN}/settings/${seg(variables.key)}`, { value: variables.value }),
    meta: { handles: ['validation_failed'] },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.settings() })
    },
  })
}

export function useAdminReleases() {
  return useAdminList<AdminRelease>(adminKeys.releases(), `${ADMIN}/releases`, {})
}

export function useCreateRelease() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateReleaseBody) => http.post(`${ADMIN}/releases`, body),
    meta: { handles: ['validation_failed'] },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.releases() })
      // The app's own release check (meta) reads the same record.
      void queryClient.invalidateQueries({ queryKey: qk.appRelease() })
    },
  })
}

/** Answers `202` with the recipient estimate. At most one per 24 hours (`429 limit_reached`). */
export function useSendAnnouncement() {
  return useMutation({
    mutationFn: (body: AnnouncementBody) =>
      http.post<AnnouncementResult>(`${ADMIN}/announcements`, body),
    meta: { handles: ['validation_failed', 'limit_reached'] },
  })
}

// ---------------------------------------------------------------------------
// ADM-AUDIT
// ---------------------------------------------------------------------------

export function useAuditLog(filters: AuditFilters) {
  return useAdminList<AuditEntry>(adminKeys.audit(filters), `${ADMIN}/audit-log`, { ...filters })
}

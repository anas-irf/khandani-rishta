import { type InfiniteData, type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { delay, http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { Toaster } from '~/components/ui/sonner'
import type { Home, Page, ProfileCard, ProfileDetail } from '~/lib/api-types'
import { qk } from '~/lib/query'
import { db } from '~/mocks/db'
import { makeMe } from '~/mocks/factories'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { createTestQueryClient } from '~/test/render'
import {
  useBlockMember,
  usePass,
  useReportMember,
  useRequestPhotoAccess,
  useShortlistToggle,
} from './queries'

// Seeded members of the mock db (src/mocks/db.ts): index 9 is a plain member with a clear
// photo, index 8 one whose photos are blurred and can be requested.
const MEMBER_ID = '10000000-0000-4000-8000-000000000010'
const BLURRED_ID = '10000000-0000-4000-8000-000000000009'

function member(id: string): ProfileDetail {
  const profile = db.profiles.get(id)
  if (!profile) throw new Error(`No mock profile ${id}`)
  return structuredClone(profile)
}

function emptyHome(cards: ProfileCard[]): Home {
  return {
    recommendations: cards,
    new_members: cards,
    nearby: [],
    recent_visitors: [],
    visitors_count_7d: 0,
    pending_interests: 0,
    completeness: 80,
    nudges: [],
    pool_exhausted: false,
    relaxation_hints: [],
  }
}

function pages(cards: ProfileCard[]): InfiniteData<Page<ProfileCard>> {
  return { pages: [{ items: cards, next_cursor: null }], pageParams: [undefined] }
}

function setup() {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(qk.me(), makeMe())
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  )
  return { queryClient, wrapper }
}

function seedCaches(queryClient: QueryClient, detail: ProfileDetail) {
  queryClient.setQueryData(qk.profile(detail.card.id), detail)
  queryClient.setQueryData(qk.home(), emptyHome([detail.card]))
  queryClient.setQueryData(qk.recommendations(), pages([detail.card]))
  queryClient.setQueryData(qk.search({}, 'best_match'), pages([detail.card]))
}

describe('useShortlistToggle', () => {
  it('toggles is_shortlisted optimistically in the profile and every list, then keeps it', async () => {
    const { queryClient, wrapper } = setup()
    seedCaches(queryClient, member(MEMBER_ID))
    const { result } = renderHook(() => useShortlistToggle(), { wrapper })

    act(() => result.current.mutate({ profileId: MEMBER_ID, shortlisted: true }))

    await waitFor(() =>
      expect(
        queryClient.getQueryData<ProfileDetail>(qk.profile(MEMBER_ID))?.relation.is_shortlisted,
      ).toBe(true),
    )
    expect(
      queryClient.getQueryData<Home>(qk.home())?.recommendations[0]?.relation.is_shortlisted,
    ).toBe(true)
    expect(
      queryClient.getQueryData<InfiniteData<Page<ProfileCard>>>(qk.recommendations())?.pages[0]
        ?.items[0]?.relation.is_shortlisted,
    ).toBe(true)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(db.shortlist.map((entry) => entry.profile_id)).toContain(MEMBER_ID)
    expect(
      queryClient.getQueryData<ProfileDetail>(qk.profile(MEMBER_ID))?.card.relation.is_shortlisted,
    ).toBe(true)
  })

  it('reverts every cache when the request fails', async () => {
    server.use(
      http.put(apiUrl('/v1/shortlist/:profileId'), async () => {
        await delay(20)
        return apiError(500, 'internal_error', 'Boom')
      }),
    )
    const { queryClient, wrapper } = setup()
    seedCaches(queryClient, member(MEMBER_ID))
    const { result } = renderHook(() => useShortlistToggle(), { wrapper })

    act(() => result.current.mutate({ profileId: MEMBER_ID, shortlisted: true }))
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(
      queryClient.getQueryData<ProfileDetail>(qk.profile(MEMBER_ID))?.relation.is_shortlisted,
    ).toBe(false)
    expect(queryClient.getQueryData<Home>(qk.home())?.new_members[0]?.relation.is_shortlisted).toBe(
      false,
    )
    expect(await screen.findByText('Could not update the shortlist.')).toBeInTheDocument()
  })
})

describe('usePass', () => {
  it('removes the card from home, recommendations and search at once', async () => {
    const { queryClient, wrapper } = setup()
    seedCaches(queryClient, member(MEMBER_ID))
    const { result } = renderHook(() => usePass(), { wrapper })

    act(() => result.current.mutate(MEMBER_ID))

    await waitFor(() =>
      expect(queryClient.getQueryData<Home>(qk.home())?.recommendations).toEqual([]),
    )
    expect(
      queryClient.getQueryData<InfiniteData<Page<ProfileCard>>>(qk.search({}, 'best_match'))
        ?.pages[0]?.items,
    ).toEqual([])
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(db.passes.has(MEMBER_ID)).toBe(true)
  })

  it('puts the card back when the pass fails', async () => {
    server.use(
      http.put(apiUrl('/v1/passes/:profileId'), () => apiError(500, 'internal_error', 'x')),
    )
    const { queryClient, wrapper } = setup()
    seedCaches(queryClient, member(MEMBER_ID))
    const { result } = renderHook(() => usePass(), { wrapper })

    act(() => result.current.mutate(MEMBER_ID))
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(queryClient.getQueryData<Home>(qk.home())?.recommendations).toHaveLength(1)
    expect(
      queryClient.getQueryData<InfiniteData<Page<ProfileCard>>>(qk.recommendations())?.pages[0]
        ?.items,
    ).toHaveLength(1)
  })
})

describe('useBlockMember', () => {
  it('blocks, removes the member from cached lists and drops the profile', async () => {
    const { queryClient, wrapper } = setup()
    seedCaches(queryClient, member(MEMBER_ID))
    const { result } = renderHook(() => useBlockMember(), { wrapper })

    await act(() => result.current.mutateAsync(MEMBER_ID))

    expect(db.blocks.map((entry) => entry.profile_id)).toContain(MEMBER_ID)
    expect(queryClient.getQueryData(qk.profile(MEMBER_ID))).toBeUndefined()
    expect(queryClient.getQueryData<Home>(qk.home())?.recommendations).toEqual([])
    expect(
      queryClient.getQueryData<InfiniteData<Page<ProfileCard>>>(qk.search({}, 'best_match'))
        ?.pages[0]?.items,
    ).toEqual([])
    expect(queryClient.getQueryState(qk.me())?.isInvalidated).toBe(true)
  })
})

describe('useReportMember', () => {
  it('applies the block when also_block is set', async () => {
    const { queryClient, wrapper } = setup()
    seedCaches(queryClient, member(MEMBER_ID))
    const { result } = renderHook(() => useReportMember(), { wrapper })

    await act(() =>
      result.current.mutateAsync({
        target_profile_id: MEMBER_ID,
        subject_type: 'profile',
        reason: 'fake_profile',
        also_block: true,
      }),
    )

    expect(db.blocks.map((entry) => entry.profile_id)).toContain(MEMBER_ID)
    expect(queryClient.getQueryData(qk.profile(MEMBER_ID))).toBeUndefined()
  })
})

describe('useRequestPhotoAccess', () => {
  it('sends the request, says "Request sent." and refetches the profile', async () => {
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(qk.profile(BLURRED_ID), member(BLURRED_ID))
    const { result } = renderHook(() => useRequestPhotoAccess(), { wrapper })

    await act(() => result.current.mutateAsync(BLURRED_ID))

    expect(await screen.findByText('Request sent.')).toBeInTheDocument()
    expect(db.photoAccess.sent.map((entry) => entry.profile_id)).toContain(BLURRED_ID)
    expect(queryClient.getQueryState(qk.profile(BLURRED_ID))?.isInvalidated).toBe(true)
  })

  it('explains not_permitted_by_member and cooldown_active with the texts of 16 section 6.7', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useRequestPhotoAccess(), { wrapper })

    server.use(
      http.post(apiUrl('/v1/profiles/:profileId/photo-access'), () =>
        apiError(409, 'not_permitted_by_member', 'No'),
      ),
    )
    await act(() => result.current.mutateAsync(BLURRED_ID).catch(() => undefined))
    expect(
      await screen.findByText('This member is not accepting photo requests.'),
    ).toBeInTheDocument()

    server.use(
      http.post(apiUrl('/v1/profiles/:profileId/photo-access'), () =>
        apiError(409, 'cooldown_active', 'Wait', {
          details: { retry_after_date: '2026-12-15' },
        }),
      ),
    )
    await act(() => result.current.mutateAsync(BLURRED_ID).catch(() => undefined))
    expect(await screen.findByText('You can ask again on 15 Dec 2026.')).toBeInTheDocument()
  })

  it('answers already_exists by refetching the profile, without a toast', async () => {
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(qk.profile(BLURRED_ID), member(BLURRED_ID))
    const { result } = renderHook(() => useRequestPhotoAccess(), { wrapper })

    await act(() => result.current.mutateAsync(BLURRED_ID))
    // Fresh data again, so the second answer's refetch is visible.
    queryClient.setQueryData(qk.profile(BLURRED_ID), member(BLURRED_ID))
    expect(queryClient.getQueryState(qk.profile(BLURRED_ID))?.isInvalidated).toBe(false)

    await act(() => result.current.mutateAsync(BLURRED_ID).catch(() => undefined))

    await waitFor(() => expect(result.current.error).toMatchObject({ code: 'already_exists' }))
    expect(queryClient.getQueryState(qk.profile(BLURRED_ID))?.isInvalidated).toBe(true)
    expect(screen.queryByText('This has already been done.')).not.toBeInTheDocument()
  })
})

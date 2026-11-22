// APP-MATCHES (16 section 6.5)
import { Link } from '@tanstack/react-router'
import { RefreshCw, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { InfiniteList } from '~/components/common/InfiniteList'
import { ListSkeleton } from '~/components/common/ListSkeleton'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Page } from '~/components/common/Page'
import { profileCardCellClass } from '~/components/common/ProfileCard'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { StatusBanner } from '~/components/common/StatusBanner'
import { Button } from '~/components/ui/button'
import { useCandidate } from '~/features/profile-sections/useCandidate'
import { isApiError } from '~/lib/api'
import { formatRelative } from '~/lib/format'
import { cn } from '~/lib/utils'
import { DiscoveryCard } from './components/DiscoveryCard'
import { ExhaustedNotice } from './components/ExhaustedNotice'
import { MatchesEmpty } from './components/MatchesEmpty'
import { usePassInPlace } from './components/usePassInPlace'
import { useRecommendations, useRefreshRecommendations } from './queries'

/** While "Finding new matches..." shows, the first page is refetched after 5 and 15 seconds. */
export const REFRESH_POLL_MS = [5000, 15000] as const

export function MatchesScreen() {
  return (
    <ScreenAccess screen="APP-MATCHES">
      <MatchesContent />
    </ScreenAccess>
  )
}

function MatchesContent() {
  const { t } = useTranslation('discovery')
  const { named, name } = useCandidate()
  const online = useOnlineStatus()
  const recommendations = useRecommendations()
  const refresh = useRefreshRecommendations()
  const passing = usePassInPlace()
  const pages = recommendations.data?.pages
  const first = pages?.[0]
  const last = pages?.[pages.length - 1]

  // A refresh accepted by the API shows the banner until the next refetch answers.
  const [requested, setRequested] = useState(false)
  const banner = requested || first?.is_refreshing === true

  const refetchRef = useRef(recommendations.refetch)
  refetchRef.current = recommendations.refetch
  const [episode, setEpisode] = useState(0)
  const bannerBefore = useRef(false)
  useEffect(() => {
    if (banner && !bannerBefore.current) setEpisode((count) => count + 1)
    bannerBefore.current = banner
  }, [banner])

  useEffect(() => {
    if (episode === 0) return
    const [firstPoll, secondPoll] = REFRESH_POLL_MS
    const timers = [
      setTimeout(() => {
        void refetchRef.current().finally(() => setRequested(false))
      }, firstPoll),
      setTimeout(() => {
        void refetchRef.current().finally(() => setRequested(false))
      }, secondPoll),
    ]
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [episode])

  const startRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: () => setRequested(true),
      onError: (error) => {
        if (isApiError(error) && error.code === 'rate_limited') toast(t('matches.rate_limited'))
      },
    })

  const itemCount = passing.arrange(pages?.flatMap((page) => page.items) ?? []).length
  const atEnd = recommendations.data !== undefined && !recommendations.hasNextPage

  return (
    <Page
      title={t('matches.title', { context: named, name })}
      description={
        first?.refreshed_at
          ? t('matches.updated', { time: formatRelative(first.refreshed_at) })
          : undefined
      }
      actions={
        <>
          <Button
            variant="quiet"
            onClick={startRefresh}
            loading={refresh.isPending}
            disabled={!online}
          >
            {refresh.isPending ? null : <RefreshCw aria-hidden="true" />}
            {t('matches.refresh')}
          </Button>
          <Button asChild variant="quiet">
            <Link to="/me/preferences">
              <SlidersHorizontal aria-hidden="true" />
              {t('matches.preferences')}
            </Link>
          </Button>
        </>
      }
    >
      {banner ? (
        <StatusBanner variant="info" icon={RefreshCw}>
          <span role="status">{t('matches.refreshing')}</span>
        </StatusBanner>
      ) : null}
      <InfiniteList
        query={recommendations}
        getKey={(card) => card.id}
        arrange={passing.arrange}
        label={t('matches.list_label', { context: named, name })}
        refreshable={false}
        listClassName="card-grid"
        itemClassName={cn(profileCardCellClass, 'wide:mb-10')}
        skeleton={<ListSkeleton size="full" count={6} />}
        renderItem={(card, index) => (
          <DiscoveryCard
            card={card}
            index={index}
            passing={passing}
            headingLevel="h2"
            priority={index === 0}
          />
        )}
        empty={
          first ? (
            <MatchesEmpty
              poolExhausted={first.pool_exhausted}
              hints={first.relaxation_hints}
              refetch={recommendations.refetch}
            />
          ) : null
        }
      />
      {atEnd && itemCount > 0 && last ? (
        last.pool_exhausted ? (
          <ExhaustedNotice
            variant="end"
            hints={last.relaxation_hints}
            className="mx-auto max-w-[420px]"
          />
        ) : (
          <p className="py-4 text-center text-muted-foreground" data-list-end="">
            {t('matches.end')}
          </p>
        )
      ) : null}
    </Page>
  )
}

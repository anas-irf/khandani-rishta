import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CardSkeleton } from '~/components/common/CardSkeleton'
import { EmptyState } from '~/components/common/EmptyState'
import { Button } from '~/components/ui/button'
import { useCandidate } from '~/features/profile-sections/useCandidate'
import type { RelaxationHint } from '~/lib/api-types'
import { ExhaustedNotice } from './ExhaustedNotice'

/** "Finding your matches...": refetch after 5 seconds, at most 3 times (16 section 6.4). */
export const FINDING_RETRY_MS = 5000
export const FINDING_RETRIES = 3

/** The skeleton of a row of full-size cards, with the same column widths. */
export function CardRailSkeleton() {
  return (
    <div aria-hidden="true" className="@container min-w-0">
      <div className="card-rail overflow-hidden">
        {[0, 1, 2, 3].map((index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    </div>
  )
}

/**
 * The empty states of "Your matches" (16 section 6.4), shared by `APP-HOME` and `APP-MATCHES`
 * (6.5: "the same texts"): while the pool is not exhausted, "Finding your matches..." with a
 * skeleton row and up to 3 refetches 5 seconds apart, then "No matches yet..." with "Search";
 * when it is exhausted, the exhausted notice with its hints.
 */
export function MatchesEmpty({
  poolExhausted,
  hints,
  refetch,
  titleAs,
}: {
  poolExhausted: boolean
  hints: readonly RelaxationHint[]
  refetch: () => Promise<unknown>
  titleAs?: 'h2' | 'h3'
}) {
  const { t } = useTranslation('discovery')
  const { context } = useCandidate()
  const [attempts, setAttempts] = useState(0)
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch
  const finding = !poolExhausted && attempts < FINDING_RETRIES

  useEffect(() => {
    if (poolExhausted || attempts >= FINDING_RETRIES) return
    const timer = setTimeout(() => {
      void refetchRef.current().finally(() => setAttempts((count) => count + 1))
    }, FINDING_RETRY_MS)
    return () => clearTimeout(timer)
  }, [poolExhausted, attempts])

  if (poolExhausted) return <ExhaustedNotice variant="empty" hints={hints} titleAs={titleAs} />

  if (finding) {
    return (
      <div role="status" className="flex min-w-0 flex-col gap-4">
        <p className="text-foreground-secondary">{t('matches_state.finding', { context })}</p>
        <CardRailSkeleton />
      </div>
    )
  }

  return (
    <EmptyState
      titleAs={titleAs}
      title={t('matches_state.none_title')}
      text={t('matches_state.none_text')}
      action={
        <Button asChild>
          <Link to="/search">{t('matches_state.search')}</Link>
        </Button>
      }
    />
  )
}

import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CardSkeleton } from '~/components/common/CardSkeleton'
import { EmptyState } from '~/components/common/EmptyState'
import { Button } from '~/components/ui/button'
import type { RelaxationHint } from '~/lib/api-types'
import { ExhaustedNotice } from './ExhaustedNotice'

/** "Finding your matches...": refetch after 5 seconds, at most 3 times (16 section 6.4). */
export const FINDING_RETRY_MS = 5000
export const FINDING_RETRIES = 3

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
}: {
  poolExhausted: boolean
  hints: readonly RelaxationHint[]
  refetch: () => Promise<unknown>
}) {
  const { t } = useTranslation('discovery')
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

  if (poolExhausted) return <ExhaustedNotice variant="empty" hints={hints} />

  if (finding) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <p className="text-muted-foreground">{t('matches_state.finding')}</p>
        <div aria-hidden="true" className="-mx-4 flex gap-3 overflow-hidden px-4 md:mx-0 md:px-0">
          {[0, 1, 2, 3].map((index) => (
            <CardSkeleton key={index} className="w-64 shrink-0" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <EmptyState
      title={t('matches_state.none_title')}
      text={t('matches_state.none_text')}
      className="py-6"
      action={
        <Button asChild>
          <Link to="/search">{t('matches_state.search')}</Link>
        </Button>
      }
    />
  )
}

import { Link } from '@tanstack/react-router'
import { Clock, SlidersHorizontal } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '~/components/common/EmptyState'
import { Diamond } from '~/components/common/Ornament'
import { Button } from '~/components/ui/button'
import { usePreferences } from '~/features/preferences/queries'
import { useCandidate } from '~/features/profile-sections/useCandidate'
import type { RelaxationHint } from '~/lib/api-types'
import { cn } from '~/lib/utils'

/**
 * The exhausted pool (16 section 6.4, 10 section 8.7, DESIGN.md 6.15): the headline, one line per
 * relaxation hint ("Changing your must-have for {dimension} would show {n} more profiles."), the
 * age line when the viewer's age is a must-have, and "Review preferences".
 *
 * - `empty`: the panel in place of the list, with "Search" beside the action.
 * - `end`: the card-wide panel that closes the list.
 */
export function ExhaustedNotice({
  variant,
  hints,
  titleAs: Title = 'h2',
  className,
}: {
  variant: 'empty' | 'end'
  hints: readonly RelaxationHint[]
  titleAs?: 'h2' | 'h3'
  className?: string
}) {
  const { t } = useTranslation('discovery')
  const { context } = useCandidate()
  const titleId = useId()

  if (variant === 'empty') {
    return (
      <div data-exhausted={variant} className={className}>
        <EmptyState
          titleAs={Title}
          titleId={titleId}
          title={t('matches_state.exhausted_empty', { context })}
          action={
            <>
              <Button asChild>
                <Link to="/me/preferences">{t('matches_state.review_preferences')}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/search">{t('matches_state.search')}</Link>
              </Button>
            </>
          }
        >
          <HintRows hints={hints} className="text-body-lg" />
        </EmptyState>
      </div>
    )
  }

  return (
    <section
      aria-labelledby={titleId}
      data-exhausted={variant}
      data-fills-cell=""
      className={cn(
        'tonal flex w-full min-w-0 flex-col gap-4 rounded-lg px-6 py-7 wide:row-span-5',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-[80px] w-[64px] items-center justify-center rounded-arch-inner border-[1.5px] border-dashed border-accent-decor"
      >
        <Diamond className="size-[10px]" />
      </span>
      <Title id={titleId} className="text-title-lg">
        {t('matches_state.exhausted_end', { context })}
      </Title>
      <HintRows hints={hints} className="text-body-md" />
      <Button asChild variant="secondary" className="mt-auto w-full">
        <Link to="/me/preferences">{t('matches_state.review_preferences')}</Link>
      </Button>
    </section>
  )
}

/** The hints, then "Widening your age range may also help." (10 section 8.7). */
function HintRows({ hints, className }: { hints: readonly RelaxationHint[]; className?: string }) {
  const { t } = useTranslation('discovery')
  const { context } = useCandidate()
  const preferences = usePreferences()
  const ageHint = preferences.data?.age_importance === 'must'
  if (hints.length === 0 && !ageHint) return null

  return (
    <ul className={cn('flex max-w-full flex-col gap-4 text-foreground-secondary', className)}>
      {hints.slice(0, 2).map((hint) => (
        <li key={hint.dimension} className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-[1lh] items-center text-muted-foreground">
            <SlidersHorizontal className="size-[1.2em]" />
          </span>
          <span className="min-w-0">
            <HintText hint={hint} />
          </span>
        </li>
      ))}
      {ageHint ? (
        <li className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-[1lh] items-center text-muted-foreground">
            <Clock className="size-[1.2em]" />
          </span>
          <span className="min-w-0">{t('matches_state.age_hint', { context })}</span>
        </li>
      ) : null}
    </ul>
  )
}

/** An invisible separator: no copy and no label holds one. */
const VALUE_EDGE = '\u2063'

/**
 * A hint with the dimension and the count in bold (DESIGN.md 6.15). The bold is found here, so
 * the copy stays plain text: Android shows the same strings (specs/22 section 1).
 */
function HintText({ hint }: { hint: RelaxationHint }) {
  const { t } = useTranslation('discovery')
  const { context } = useCandidate()
  const marked = (value: string | number) => `${VALUE_EDGE}${value}${VALUE_EDGE}`
  const label = t(`dimension.${hint.dimension}`, {
    defaultValue: hint.dimension.replaceAll('_', ' '),
  })
  const text = t('matches_state.hint', {
    context,
    replace: { dimension: marked(label), count: marked(hint.extra_profiles) },
  })
  // Every second piece is one of the values.
  return text.split(VALUE_EDGE).map((part, position) =>
    position % 2 === 1 ? (
      <strong key={part} className="font-bold text-foreground tabular-nums">
        {part}
      </strong>
    ) : (
      part
    ),
  )
}

import { Link } from '@tanstack/react-router'
import { SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { usePreferences } from '~/features/preferences/queries'
import type { RelaxationHint } from '~/lib/api-types'
import { cn } from '~/lib/utils'

/**
 * The exhausted pool (16 section 6.4, 10 section 8.7): the headline, one line per relaxation hint
 * ("Changing your must-have for {dimension} would show {n} more profiles."), the age line when
 * the viewer's age is a must-have, and "Review preferences" (plus "Search" when the list is
 * empty). With no hints the headline stands alone (16 section 6.4).
 */
export function ExhaustedNotice({
  variant,
  hints,
  className,
}: {
  /** `empty`: nothing to show at all; `end`: the final card after the list. */
  variant: 'empty' | 'end'
  hints: readonly RelaxationHint[]
  className?: string
}) {
  const { t } = useTranslation('discovery')
  return (
    <section
      data-exhausted={variant}
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-sm',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
          <SlidersHorizontal aria-hidden="true" className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="font-semibold">
            {variant === 'empty'
              ? t('matches_state.exhausted_empty')
              : t('matches_state.exhausted_end')}
          </p>
          {hints.length > 0 ? (
            <ul className="flex flex-col gap-1 text-muted-foreground">
              {hints.slice(0, 2).map((hint) => (
                <li key={hint.dimension}>
                  {t('matches_state.hint', {
                    dimension: t(`dimension.${hint.dimension}`, {
                      defaultValue: hint.dimension.replaceAll('_', ' '),
                    }),
                    count: hint.extra_profiles,
                  })}
                </li>
              ))}
            </ul>
          ) : null}
          <AgeHint />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/me/preferences">{t('matches_state.review_preferences')}</Link>
        </Button>
        {variant === 'empty' ? (
          <Button asChild variant="secondary">
            <Link to="/search">{t('matches_state.search')}</Link>
          </Button>
        ) : null}
      </div>
    </section>
  )
}

/** "Widening your age range may also help." when age is a must-have (10 section 8.7). */
function AgeHint() {
  const { t } = useTranslation('discovery')
  const preferences = usePreferences()
  if (preferences.data?.age_importance !== 'must') return null
  return <p className="text-muted-foreground">{t('matches_state.age_hint')}</p>
}

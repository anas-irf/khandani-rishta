import { useTranslation } from 'react-i18next'
import { useCandidate } from '~/features/profile-sections/useCandidate'
import { cn } from '~/lib/utils'

/**
 * The closed list of reason codes of 10 section 7. `verified` and `new_member` are not reasons
 * any more: badges say both, so an API that still sends them is ignored like any unknown code.
 */
export const REASON_CODES = [
  'same_city',
  'same_caste',
  'same_sect',
  'you_meet_their_preferences',
  'age_fits',
  'education_fits',
  'religiosity_fits',
  'family_values_fit',
  'profession_fits',
  'same_mother_tongue',
  'same_region',
  'shared_hobbies',
  'meets_your_must_haves',
  'recently_active',
] as const

const KNOWN: ReadonlySet<string> = new Set(REASON_CODES)

/**
 * Up to `max` reasons (10 section 7, DESIGN.md 6.6) as a list rather than pills, because the
 * labels are long. Each has a dot and never a tick, which means verified. Unknown codes are
 * ignored, so a newer API value never shows a raw code. Renders nothing when no code is left.
 */
export function ReasonChips({
  reasons,
  max = 3,
  className,
}: {
  reasons: readonly string[]
  max?: number
  className?: string
}) {
  const { t } = useTranslation('shared')
  const { context } = useCandidate()
  const known = reasons.filter((code) => KNOWN.has(code)).slice(0, max)
  if (known.length === 0) return null

  return (
    <ul
      aria-label={t('reasons_label')}
      className={cn('flex flex-col gap-1 text-body-sm', className)}
    >
      {known.map((code) => (
        <li key={code} className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="flex h-[1lh] w-[16px] shrink-0 items-center justify-center"
          >
            <span className="size-[6px] rounded-pill bg-muted-foreground" />
          </span>
          <span className="min-w-0">{t(`reason.${code}`, { context })}</span>
        </li>
      ))}
    </ul>
  )
}

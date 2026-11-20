import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/utils'

/** The closed list of reason codes of 10 section 7. */
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
  'verified',
  'new_member',
  'recently_active',
] as const

const KNOWN: ReadonlySet<string> = new Set(REASON_CODES)

/**
 * Up to `max` reason chips (10 section 7). Unknown codes are ignored, so a newer API value
 * never shows a raw code. Renders nothing when no known code is left.
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
  const known = reasons.filter((code) => KNOWN.has(code)).slice(0, max)
  if (known.length === 0) return null

  return (
    <ul aria-label={t('reasons_label')} className={cn('flex flex-wrap gap-1.5', className)}>
      {known.map((code) => (
        <li
          key={code}
          className="rounded-full bg-accent-soft px-2.5 py-0.5 text-sm text-foreground"
        >
          {t(`reason.${code}`)}
        </li>
      ))}
    </ul>
  )
}

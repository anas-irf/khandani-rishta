import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LockedGroup, Tier } from '~/lib/api-types'
import { cn } from '~/lib/utils'

/** Groups with a row label on `APP-PROFILE` (16 section 6.7). `family` replaces a whole block. */
type LabelledGroup = Exclude<LockedGroup, 'photos' | 'full_name' | 'family'>

const LABELLED: ReadonlySet<string> = new Set<LabelledGroup>([
  'caste',
  'area',
  'career_details',
  'income',
  'home',
  'health',
])

/**
 * The placeholder for a group listed in `locked` (16 section 6.7, 09 section 5.5, DESIGN.md
 * 6.10): an outlined pill with a lock and "Visible after you connect", or "Hidden by this member"
 * at the tier `connection`. Never rendered as empty fields.
 */
export function LockedValue({
  tier,
  group,
  label,
  className,
}: {
  /** `relation.tier` of the profile being viewed. */
  tier: Tier
  /** The locked group; gives the row label of 16 section 6.7 when `label` is not set. */
  group?: LockedGroup
  /** Row label; overrides the group's label. */
  label?: string
  className?: string
}) {
  const { t } = useTranslation('shared')
  const rowLabel =
    label ?? (group && LABELLED.has(group) ? t(`locked.group.${group as LabelledGroup}`) : null)
  const text =
    tier === 'connection' ? t('locked.hidden_by_member') : t('locked.visible_after_connect')

  return (
    <div
      data-locked-group={group}
      className={cn('flex max-w-full flex-wrap items-baseline gap-x-3 gap-y-1', className)}
    >
      {rowLabel ? <span className="text-body-sm text-muted-foreground">{rowLabel}</span> : null}
      <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-input px-3 py-1 text-label-sm text-foreground-secondary">
        <Lock aria-hidden="true" strokeWidth={2.2} className="size-[1em]" />
        <span className="min-w-0">{text}</span>
      </span>
    </div>
  )
}

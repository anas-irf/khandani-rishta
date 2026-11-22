import { Mail, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCandidate } from '~/features/profile-sections/useCandidate'
import type { ProfileCard } from '~/lib/api-types'
import { cn } from '~/lib/utils'

type Hint = 'connected' | 'sent' | 'received'

function hintOf(relation: ProfileCard['relation']): Hint | null {
  if (relation.tier === 'connection') return 'connected'
  if (relation.interest_direction === 'sent') return 'sent'
  if (relation.interest_direction === 'received') return 'received'
  return null
}

const LOOK: Record<Hint, string> = {
  sent: 'text-foreground-secondary',
  received: 'bg-primary-soft px-3 py-[5px] text-primary',
  connected: 'bg-success-soft px-3 py-[5px] text-success',
}

/**
 * "Interest sent", "Interested in you", "Connected" (16 section 1.5, DESIGN.md 6.7). The envelope
 * means an interest; the heart belongs to Shortlist alone.
 */
export function RelationHint({
  relation,
  className,
}: {
  relation: ProfileCard['relation']
  className?: string
}) {
  const { t } = useTranslation('shared')
  const { context } = useCandidate()
  const hint = hintOf(relation)
  if (!hint) return null
  const Icon = hint === 'connected' ? UsersRound : Mail
  return (
    <span
      data-relation-hint={hint}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-pill text-label-md font-bold',
        LOOK[hint],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-[1.125em]" />
      {t(`card.relation.${hint}`, { context })}
    </span>
  )
}

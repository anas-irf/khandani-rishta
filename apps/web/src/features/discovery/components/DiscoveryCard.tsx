import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ProfileCard } from '~/components/common/ProfileCard'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import type { ProfileCard as ProfileCardData } from '~/lib/api-types'
import { usePassWithUndo } from './usePassWithUndo'

/**
 * A full-size profile card with the card actions of `APP-HOME`, `APP-MATCHES` and `APP-SEARCH`
 * (16 section 6.4): tap opens the profile, the heart toggles the shortlist, and the card menu
 * offers "Not interested".
 */
export function DiscoveryCard({
  card,
  headingLevel,
  className,
}: {
  card: ProfileCardData
  headingLevel?: 'h2' | 'h3'
  className?: string
}) {
  const { t } = useTranslation('discovery')
  const pass = usePassWithUndo()

  return (
    <ProfileCard
      card={card}
      size="full"
      headingLevel={headingLevel}
      className={className}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-ms-2"
              aria-label={t('card.more', { name: card.display_name })}
            >
              <MoreHorizontal aria-hidden="true" className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => pass(card.id)}>
              {t('card.not_interested')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  )
}

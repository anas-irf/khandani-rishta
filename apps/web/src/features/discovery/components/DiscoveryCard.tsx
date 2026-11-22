import { Ellipsis } from 'lucide-react'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Diamond } from '~/components/common/Ornament'
import { ProfileCard } from '~/components/common/ProfileCard'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { useCandidate } from '~/features/profile-sections/useCandidate'
import type { ProfileCard as ProfileCardData } from '~/lib/api-types'
import { useFocusOnMount } from '~/lib/focus'
import type { PassInPlace } from './usePassInPlace'

type DiscoveryCardProps = {
  card: ProfileCardData
  /** The card's place in the list, where its panel stays. */
  index: number
  passing: PassInPlace
  headingLevel?: 'h2' | 'h3'
  priority?: boolean
}

/**
 * A full-size profile card with the card actions of `APP-HOME`, `APP-MATCHES` and `APP-SEARCH`
 * (16 section 6.4): tap opens the profile, Shortlist toggles, and More offers "Not interested",
 * which puts a panel with Undo in the card's place.
 */
export function DiscoveryCard(props: DiscoveryCardProps) {
  const { card, passing } = props
  const entry = passing.entryOf(card.id)
  if (entry?.state === 'passed') {
    return <PassedPanel card={card} height={entry.height} onUndo={() => passing.undo(card.id)} />
  }
  return <OpenCard {...props} restored={entry?.state === 'restored'} />
}

function OpenCard({
  card,
  index,
  passing,
  headingLevel,
  priority,
  restored,
}: DiscoveryCardProps & { restored: boolean }) {
  const { t } = useTranslation(['discovery', 'shared'])
  const linkRef = useFocusOnMount<HTMLAnchorElement>(restored)
  const moreRef = useRef<HTMLButtonElement>(null)

  const pass = () => {
    const article = moreRef.current?.closest('article')
    passing.pass(card, index, article?.getBoundingClientRect().height ?? 0)
  }

  return (
    <ProfileCard
      card={card}
      size="full"
      headingLevel={headingLevel}
      priority={priority}
      linkRef={linkRef}
      more={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={moreRef}
              variant="quiet"
              size="compact"
              className="grow"
              aria-label={t('card.more', { name: card.display_name })}
            >
              <Ellipsis aria-hidden="true" />
              {t('shared:card.more')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={pass}>{t('card.not_interested')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  )
}

/** What stays in the place of a passed card, at its full height (DESIGN.md 6.9). */
function PassedPanel({
  card,
  height,
  onUndo,
}: {
  card: ProfileCardData
  height: number
  onUndo: () => void
}) {
  const { t } = useTranslation('discovery')
  const { context } = useCandidate()
  const online = useOnlineStatus()
  const titleId = useId()
  const textId = useId()
  const undoRef = useFocusOnMount<HTMLButtonElement>()

  return (
    <article
      aria-labelledby={titleId}
      data-passed-card={card.id}
      data-fills-cell=""
      // The height of the card it replaces, measured when it was passed.
      style={height > 0 ? { minHeight: height } : undefined}
      className="tonal flex w-full min-w-0 flex-col items-center justify-center gap-4 rounded-lg px-6 py-10 text-center wide:row-span-5"
    >
      <Diamond className="size-[10px]" />
      <p id={titleId} className="max-w-full text-title-md">
        {t('card.hidden_from', { name: card.display_name, context })}
      </p>
      <p id={textId} className="text-body-sm text-muted-foreground">
        {t('card.hidden_for')}
      </p>
      <Button
        ref={undoRef}
        variant="secondary"
        aria-describedby={`${titleId} ${textId}`}
        disabled={!online}
        onClick={onUndo}
      >
        {t('card.undo')}
      </Button>
    </article>
  )
}

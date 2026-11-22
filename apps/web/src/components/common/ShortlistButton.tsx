import { Heart } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, type ButtonProps } from '~/components/ui/button'
import { useShortlistToggle } from '~/features/relations/queries'
import { cn } from '~/lib/utils'
import { useOnlineStatus } from './OfflineBanner'

/**
 * The labelled Shortlist toggle of 16 section 1.5, on cards and on the profile: "Shortlist", or
 * pressed with a filled heart and "Shortlisted". `PUT /v1/shortlist/{id}` with `{}` or `DELETE`,
 * optimistic (G7): while the request runs it shows the requested state, and the hook reverts the
 * caches with a toast on failure. The heart means this and nothing else (DESIGN.md 6.7).
 */
export function ShortlistButton({
  profileId,
  shortlisted: saved,
  onAdded,
  variant = 'secondary',
  ...props
}: Omit<ButtonProps, 'children' | 'onClick' | 'asChild' | 'loading'> & {
  profileId: string
  /** `relation.is_shortlisted`. */
  shortlisted: boolean
  /** Runs when adding succeeded (the profile then offers "Add a note"). */
  onAdded?: () => void
}) {
  const { t } = useTranslation('shared')
  const toggle = useShortlistToggle()
  const online = useOnlineStatus()
  const shortlisted = toggle.isPending ? toggle.variables.shortlisted : saved

  return (
    <Button
      variant={variant}
      aria-pressed={shortlisted}
      disabled={!online}
      onClick={() =>
        toggle.mutate(
          { profileId, shortlisted: !shortlisted },
          {
            onSuccess: (_data, variables) => {
              if (variables.shortlisted) onAdded?.()
            },
          },
        )
      }
      {...props}
    >
      <Heart aria-hidden="true" className={cn(shortlisted && 'fill-current text-primary')} />
      {shortlisted ? t('card.shortlisted') : t('card.shortlist')}
    </Button>
  )
}

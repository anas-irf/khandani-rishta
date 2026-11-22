import { createLink, type LinkComponent } from '@tanstack/react-router'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '~/lib/utils'
import { ArchIcon, type ArchTone } from './Arch'

/** The arrow at the end of a row; it points the other way in right-to-left layouts. */
export function RowChevron({ className }: { className?: string }) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn('size-[20px] shrink-0 text-muted-foreground rtl:-scale-x-100', className)}
    />
  )
}

type RowAnchorProps = Omit<ComponentProps<'a'>, 'title' | 'children'> & {
  icon?: LucideIcon
  label: ReactNode
  description?: ReactNode
  /** A count or a state before the chevron. */
  trailing?: ReactNode
}

function RowAnchor({
  icon: Icon,
  label,
  description,
  trailing,
  className,
  ...props
}: RowAnchorProps) {
  return (
    <a
      data-slot="link-row"
      className={cn(
        'flex min-h-touch-lg w-full items-center gap-3 rounded-sm py-3 text-foreground transition-colors hover:text-primary',
        className,
      )}
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" className="size-5 text-muted-foreground" /> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-title-sm">{label}</span>
        {description ? (
          <span className="text-body-sm text-muted-foreground">{description}</span>
        ) : null}
      </span>
      {/* A space between the words and the count, for software that reads the text. */}
      {trailing ? <> {trailing}</> : null}
      <RowChevron />
    </a>
  )
}

const LinkRowRoute = createLink(RowAnchor)

/** A row of a menu of screens (Settings, the Me menu, hints): one link, with a chevron. */
export const LinkRow: LinkComponent<typeof RowAnchor> = (props) => <LinkRowRoute {...props} />

/** The same row for an address outside the app (`mailto:`). */
export const AnchorRow = RowAnchor

type NudgeAnchorProps = Omit<RowAnchorProps, 'icon' | 'trailing'> & {
  icon: LucideIcon
  tone?: ArchTone
  /** In the row on phones a card is 72 tall with the title only; the text stays for screen readers. */
  inRow?: boolean
}

function NudgeAnchor({
  icon,
  tone,
  inRow = false,
  label,
  description,
  className,
  ...props
}: NudgeAnchorProps) {
  return (
    <a
      data-slot="nudge-card"
      className={cn(
        // Relative: the screen-reader text must not escape a row that scrolls sideways.
        'tonal relative flex items-center gap-[12px] rounded-lg px-[16px] py-4 text-foreground transition-colors hover:bg-muted-strong',
        inRow &&
          'h-full max-wide:min-h-[72px] max-wide:gap-[12px] max-wide:py-3 max-wide:ps-[12px] max-wide:pe-[16px]',
        className,
      )}
      {...props}
    >
      <ArchIcon
        icon={icon}
        tone={tone}
        className={cn(inRow && 'max-wide:h-[44px] max-wide:w-[36px]')}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-emphasis">{label}</span>
        {description ? (
          <span
            className={cn('text-body-sm text-foreground-secondary', inRow && 'max-wide:sr-only')}
          >
            {description}
          </span>
        ) : null}
      </span>
      <RowChevron />
    </a>
  )
}

const NudgeCardRoute = createLink(NudgeAnchor)

/** A suggested next step as one sand link: an arch with its icon, the title and its text (6.21). */
export const NudgeCard: LinkComponent<typeof NudgeAnchor> = (props) => <NudgeCardRoute {...props} />

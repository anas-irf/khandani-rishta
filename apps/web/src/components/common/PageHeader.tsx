import { Link, useCanGoBack, useRouter } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { useBarHeight } from '~/lib/media'
import { cn } from '~/lib/utils'
import { Band, type ColumnWidth } from './Band'

export type PageHeaderProps = {
  title: string
  /** `h2` for a pane beside the screen that has the page's `h1` (the chat list). */
  titleAs?: 'h1' | 'h2'
  /** Small text under the title. */
  description?: ReactNode
  /** A fixed back destination (a path). The arrow is a link to it. */
  backTo?: string
  /**
   * A back arrow that returns to the previous screen, or to `/home` when the screen was opened
   * without history (16 section 2.3).
   */
  showBack?: boolean
  /** Accessible name of the back control (default "Back"). */
  backLabel?: string
  /** Controls at the end of the header (menu, refresh, ...). */
  actions?: ReactNode
  /** More of the header's band: tabs, a hero. */
  children?: ReactNode
  /** The column of the screen's body, so that the title lines up with it. */
  width?: ColumnWidth
  className?: string
}

/**
 * The top of a screen: a sand band with the title as the page's `h1` at 28 / 700 (DESIGN.md 3.2),
 * its controls, and what else belongs to the header.
 *
 * A detail screen (one with a back arrow) has no bottom navigation, so on phones its back arrow
 * and title become a 64 tall bar that stays at the top (16 section 2.1, DESIGN.md 6.16). The
 * title wraps rather than being cut, and the band follows under it.
 */
export function PageHeader({
  title,
  titleAs: Title = 'h1',
  description,
  backTo,
  showBack = false,
  backLabel,
  actions,
  children,
  width,
  className,
}: PageHeaderProps) {
  const { t } = useTranslation('shared')
  const label = backLabel ?? t('header.back')
  const barRef = useBarHeight('--screen-bar')
  const hasBack = Boolean(backTo) || showBack
  const more =
    description || children ? (
      <>
        {description ? (
          <p className="max-w-measure text-body-sm text-foreground-secondary">{description}</p>
        ) : null}
        {children}
      </>
    ) : null

  const titleRow = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-[min(100%,12rem)] flex-1 items-center gap-1">
        {backTo ? (
          <Button asChild variant="ghost" size="icon" className="-ms-[12px]">
            <Link to={backTo} aria-label={label}>
              <BackArrow />
            </Link>
          </Button>
        ) : showBack ? (
          <HistoryBackButton label={label} />
        ) : null}
        <Title
          className={cn(
            'min-w-0',
            hasBack ? 'text-title-md font-bold wide:text-headline-md' : 'text-headline-md',
          )}
        >
          {title}
        </Title>
      </div>
      {actions ? (
        <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )

  if (!hasBack) {
    return (
      <Band
        as="header"
        tone="sand"
        width={width}
        space="sm"
        data-slot="page-header"
        className={className}
        innerClassName="flex flex-col gap-3"
      >
        {titleRow}
        {more}
      </Band>
    )
  }

  return (
    <>
      <Band
        as="header"
        ref={barRef}
        width={width}
        space="none"
        data-slot="page-header"
        className={cn(
          'sticky top-0 z-20 border-b border-border wide:static wide:band-sand wide:border-b-0',
          className,
        )}
        innerClassName={cn(
          'flex min-h-[64px] flex-col justify-center py-1 wide:pt-[clamp(16px,2.4vw,32px)]',
          more ? 'wide:pb-2' : 'wide:pb-[clamp(16px,2.4vw,32px)]',
        )}
      >
        {titleRow}
      </Band>
      {more ? (
        <Band
          as="div"
          tone="sand"
          width={width}
          space="none"
          innerClassName="flex flex-col gap-3 pt-4 pb-5 wide:pt-0 wide:pb-[clamp(16px,2.4vw,32px)]"
        >
          {more}
        </Band>
      ) : null}
    </>
  )
}

/** The back chevron; it points the other way in right-to-left layouts. */
export function BackArrow() {
  return <ChevronLeft aria-hidden="true" className="size-[26px] rtl:-scale-x-100" />
}

function HistoryBackButton({ label }: { label: string }) {
  const goBack = useGoBack()
  return (
    <Button variant="ghost" size="icon" className="-ms-[12px]" aria-label={label} onClick={goBack}>
      <BackArrow />
    </Button>
  )
}

/**
 * Back to the previous screen, or to `/home` when there is no in-app history (a screen opened
 * from a notification or link, 16 section 2.3 rule 3).
 */
export function useGoBack(fallback = '/home') {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  return () => {
    if (canGoBack) router.history.back()
    else void router.navigate({ to: fallback })
  }
}

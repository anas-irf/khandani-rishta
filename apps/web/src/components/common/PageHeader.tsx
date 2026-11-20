import { Link, useCanGoBack, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'

export type PageHeaderProps = {
  title: string
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
  className?: string
}

const backClass = 'size-11 -ms-2 shrink-0'

/**
 * The title row of a screen: optional back arrow (mirrored in right-to-left layouts), the
 * title as the page's `h1`, and optional actions.
 */
export function PageHeader({
  title,
  description,
  backTo,
  showBack = false,
  backLabel,
  actions,
  className,
}: PageHeaderProps) {
  const { t } = useTranslation('shared')
  const label = backLabel ?? t('header.back')

  let back: ReactNode = null
  if (backTo) {
    back = (
      <Button asChild variant="ghost" size="icon" className={backClass}>
        <Link to={backTo} aria-label={label}>
          <BackArrow />
        </Link>
      </Button>
    )
  } else if (showBack) {
    back = <HistoryBackButton label={label} />
  }

  return (
    <header className={cn('flex items-center gap-2 py-3', className)}>
      {back}
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-xl font-semibold leading-snug md:text-2xl">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  )
}

function BackArrow() {
  return <ArrowLeft aria-hidden="true" className="size-5 rtl:-scale-x-100" />
}

function HistoryBackButton({ label }: { label: string }) {
  const goBack = useGoBack()
  return (
    <Button variant="ghost" size="icon" className={backClass} aria-label={label} onClick={goBack}>
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

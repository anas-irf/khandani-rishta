import { CircleCheck, CircleX, Info, type LucideIcon, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { cn } from '~/lib/utils'

export type StatusBannerVariant = 'info' | 'success' | 'warning' | 'danger'

const ICONS: Record<StatusBannerVariant, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
}

/**
 * A soft coloured banner for profile and moderation states (17 section 10): under review, changes
 * requested, a rejected photo, a warning. Always an icon and text, never colour alone (G13).
 */
export function StatusBanner({
  variant,
  title,
  children,
  icon,
  action,
  className,
}: {
  variant: StatusBannerVariant
  title?: ReactNode
  /** The banner text. */
  children?: ReactNode
  /** Replaces the variant's default icon. */
  icon?: LucideIcon
  /** A button or link under the text. */
  action?: ReactNode
  className?: string
}) {
  const Icon = icon ?? ICONS[variant]
  return (
    <Alert variant={variant} className={className} data-status-banner={variant}>
      <Icon aria-hidden="true" />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {children || action ? (
        <AlertDescription className={cn(!title && 'text-body-md')}>
          {children ? <div className="max-w-full">{children}</div> : null}
          {action ? <div className="mt-2 flex max-w-full flex-wrap gap-3">{action}</div> : null}
        </AlertDescription>
      ) : null}
    </Alert>
  )
}

import { Inbox, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

/**
 * The standard empty state (16 rule G2): an icon, a title, one line of text and, where useful,
 * one primary action. The copy comes from the screen's entry in 16.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  text,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  text?: ReactNode
  /** One primary button or link. */
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col items-center gap-3 px-4 py-10 text-center md:py-14', className)}
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon aria-hidden="true" className="size-7" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      {text ? <p className="max-w-md text-muted-foreground">{text}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

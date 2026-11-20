import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/utils'

export type Fact = { label: string; value: ReactNode }

/** A card of label and value pairs, as a description list. Empty values show a dash. */
export function Facts({
  title,
  facts,
  columns = 2,
  className,
  action,
}: {
  title?: string
  facts: Fact[]
  columns?: 1 | 2 | 3
  className?: string
  action?: ReactNode
}) {
  const { t } = useTranslation('admin')
  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4',
        className,
      )}
    >
      {title || action ? (
        <header className="flex items-center justify-between gap-3">
          {title ? <h2 className="text-base font-semibold">{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      <dl
        className={cn(
          'grid gap-x-6 gap-y-2 text-sm',
          columns === 2 && 'grid-cols-2',
          columns === 3 && 'grid-cols-3',
        )}
      >
        {facts.map((fact) => (
          <div key={fact.label} className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="break-words font-medium">
              {fact.value === null || fact.value === undefined || fact.value === '' ? (
                <>
                  <span aria-hidden="true">-</span>
                  <span className="sr-only">{t('common.none')}</span>
                </>
              ) : (
                fact.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** A titled block of the detail screens (no description list inside). */
export function Panel({
  title,
  children,
  action,
  className,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}

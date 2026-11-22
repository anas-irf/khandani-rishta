import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DiamondTitle } from '~/components/common/Ornament'
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
    <section className={cn('tonal panel min-w-0 gap-3', className)}>
      {title || action ? (
        <header className="flex flex-wrap items-center justify-between gap-3">
          {title ? (
            <h2 className="text-title-md font-bold">
              <DiamondTitle>{title}</DiamondTitle>
            </h2>
          ) : (
            <span />
          )}
          {action}
        </header>
      ) : null}
      <dl
        className={cn(
          'grid gap-x-4 gap-y-3 text-body-sm',
          // A column that would break words gives way: the count is the most there will be.
          columns === 2 && 'grid-cols-[repeat(auto-fit,minmax(max(6.5rem,40%),1fr))]',
          columns === 3 && 'grid-cols-[repeat(auto-fit,minmax(max(6.5rem,28%),1fr))]',
        )}
      >
        {facts.map((fact) => (
          <div key={fact.label} className="flex min-w-0 flex-col">
            <dt className="text-caption text-muted-foreground">{fact.label}</dt>
            <dd className="font-semibold wrap-anywhere tabular-nums">
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
    <section className={cn('tonal panel min-w-0 gap-3', className)}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-title-md font-bold">
          <DiamondTitle>{title}</DiamondTitle>
        </h2>
        {action}
      </header>
      {children}
    </section>
  )
}

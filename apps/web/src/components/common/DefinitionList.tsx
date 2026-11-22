import type { ComponentProps, ReactNode } from 'react'
import { cn } from '~/lib/utils'

/** Rows of a label and a value (DESIGN.md 6.10). `split` sets them in two columns when wide. */
export function DefinitionList({
  split = false,
  className,
  ...props
}: ComponentProps<'dl'> & { split?: boolean }) {
  return (
    <dl
      data-slot="definition-list"
      className={cn(
        'min-w-0',
        split && 'grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-x-12',
        className,
      )}
      {...props}
    />
  )
}

/**
 * One row: the label on a basis of 140, the value on 170 growing 1.4 times as fast, so values
 * start on one line down the group. When the column is too narrow the value drops under it.
 */
export function DefinitionRow({
  label,
  children,
  className,
  ...props
}: ComponentProps<'div'> & { label: ReactNode }) {
  return (
    <div
      data-slot="definition-row"
      className={cn(
        'flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border py-3',
        className,
      )}
      {...props}
    >
      <dt className="max-w-full flex-[1_1_140px] text-body-sm text-muted-foreground">{label}</dt>
      <dd className="max-w-full min-w-0 flex-[1.4_1_170px] text-title-sm">{children}</dd>
    </div>
  )
}

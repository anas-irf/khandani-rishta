import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'
import { Band, BandStack } from './Band'
import { PageHeader, type PageHeaderProps } from './PageHeader'

export type PageProps = Omit<PageHeaderProps, 'children' | 'className'> & {
  /** The header band's extra content (tabs, a hero). */
  header?: ReactNode
  /**
   * - `body` (default): one band on the background under the header.
   * - `bands`: the children are `Band`s of `tone="auto"` that take turns in a `BandStack`.
   */
  layout?: 'body' | 'bands'
  children: ReactNode
  className?: string
}

/**
 * A screen inside the app shell: the header band, then the body in the same column. Every
 * screen that is not a reference screen is built from this, so all share one tonal rhythm.
 */
export function Page({
  header,
  layout = 'body',
  width,
  children,
  className,
  ...headerProps
}: PageProps) {
  return (
    <div data-slot="page" className="flex min-w-0 flex-1 flex-col">
      <PageHeader width={width} {...headerProps}>
        {header}
      </PageHeader>
      {layout === 'bands' ? (
        <BandStack className={className}>{children}</BandStack>
      ) : (
        <Band
          as="div"
          width={width}
          className="flex-1"
          innerClassName={cn('flex flex-col gap-6', className)}
        >
          {children}
        </Band>
      )}
    </div>
  )
}

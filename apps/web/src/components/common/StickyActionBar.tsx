import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { useBarHeight } from '~/lib/media'
import { cn } from '~/lib/utils'

const barVariants = cva(
  'sticky z-20 flex max-h-[60dvh] w-full flex-col gap-[12px] overflow-y-auto border-border bg-surface px-[16px] [--tonal:var(--color-muted)]',
  {
    variants: {
      placement: {
        /** The phone: on the bottom navigation where there is one. */
        bottom:
          'bottom-[var(--bottom-nav,0px)] rounded-sheet border-t pt-[14px] pb-[max(12px,env(safe-area-inset-bottom))] shadow-bar',
        /** The head of a panel on wide screens, under the app bar. */
        top: 'top-[var(--app-bar,0px)] rounded-t-xl border-b py-[12px]',
      },
    },
    defaultVariants: { placement: 'bottom' },
  },
)

/**
 * The bar at the bottom of a phone (DESIGN.md 6.14): surface, sheet radius, a hairline and the
 * bar shadow. Wide screens have no bottom bar: there it heads the panel it acts on
 * (`placement="top"`). Sticky rather than fixed, so it never hides the end of the page. A bar
 * taller than most of the window scrolls inside. Give it an `aria-label` where it is a region of
 * its own.
 */
export function StickyActionBar({
  placement,
  className,
  ...props
}: ComponentProps<'section'> & VariantProps<typeof barVariants>) {
  const ref = useBarHeight(placement === 'top' ? '--screen-bar' : '--action-bar')
  return (
    <section
      ref={ref}
      data-slot="action-bar"
      className={cn(barVariants({ placement }), className)}
      {...props}
    />
  )
}

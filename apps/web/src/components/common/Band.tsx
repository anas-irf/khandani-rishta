import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'

const bandVariants = cva('', {
  variants: {
    tone: {
      page: 'band-page',
      sand: 'band-sand',
      success: 'band-success',
      primary: 'band-primary',
      inverse: 'band-inverse',
      /** Takes its turn from the surrounding `BandStack`. */
      auto: '',
    },
  },
  defaultVariants: { tone: 'page' },
})

const columnVariants = cva('mx-auto w-full px-gutter', {
  variants: {
    width: {
      /** Up to 1,168 of content (DESIGN.md 5.2). */
      content: 'max-w-[calc(var(--container-content)+2*var(--spacing-gutter))]',
      /** Lists and reading: 768. */
      column: 'max-w-[calc(var(--container-column)+2*var(--spacing-gutter))]',
      /** Forms: 560 (07 section 2.6). */
      form: 'max-w-[calc(var(--container-form)+2*var(--spacing-gutter))]',
    },
    space: {
      none: '',
      sm: 'py-[clamp(16px,2.4vw,32px)]',
      md: 'py-[clamp(32px,4.5vw,56px)]',
      /** Landing sections. */
      lg: 'py-[clamp(56px,7vw,112px)]',
    },
  },
  defaultVariants: { width: 'content', space: 'md' },
})

export type ColumnWidth = NonNullable<VariantProps<typeof columnVariants>['width']>

export type BandProps = ComponentProps<'section'> &
  VariantProps<typeof bandVariants> &
  VariantProps<typeof columnVariants> & {
    /** The element of the band (default `section`; `div` when it is not a landmark or group). */
    as?: 'section' | 'div' | 'header' | 'footer'
    /** Classes of the column inside the band. `className` is for the full-width band. */
    innerClassName?: string
  }

/**
 * A tonal band (DESIGN.md 6.10): a full-width fill with the content column inside. Bands separate
 * the parts of a screen in place of cards and shadows, and what sits in one can use `tonal` for a
 * fill that stands out on it.
 */
export function Band({
  as = 'section',
  tone,
  width,
  space,
  className,
  innerClassName,
  children,
  ...props
}: BandProps) {
  // The four elements take the same attributes; a union tag cannot type the shared `ref`.
  const Element = as as 'section'
  return (
    <Element data-slot="band" className={cn(bandVariants({ tone }), className)} {...props}>
      <div className={cn(columnVariants({ width, space }), innerClassName)}>{children}</div>
    </Element>
  )
}

/**
 * A band inside a column that still reaches both edges of the window: a profile's article beside
 * its rail, or a profile inside a dialog. The screen's root needs `overflow-x-clip`.
 */
export function BleedBand({
  tone = 'page',
  className,
  ...props
}: ComponentProps<'div'> & { tone?: 'page' | 'sand' }) {
  return (
    <div
      data-slot="band"
      className={cn(bandVariants({ tone }), 'band-bleed py-[clamp(28px,4.5vw,56px)]', className)}
      {...props}
    />
  )
}

/**
 * Bands that take turns between background and sand, counting only the ones that render, so a
 * screen that leaves out a group keeps its rhythm. The last band takes the space that is left.
 */
export function BandStack({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="band-stack"
      className={cn('band-stack flex flex-1 flex-col *:last:flex-1', className)}
      {...props}
    />
  )
}

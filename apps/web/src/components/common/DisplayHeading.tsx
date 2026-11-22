import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'

/** The serif of display titles (DESIGN.md 3.2). For a title that is a dialog's, take the classes. */
export const displayHeadingVariants = cva('max-w-full font-display font-normal text-balance', {
  variants: { size: { md: 'text-display-md', sm: 'text-display-sm' } },
  defaultVariants: { size: 'md' },
})

/** A title in serif: the public pages, the closing bands and the celebrations. */
export function DisplayHeading({
  as: Tag = 'h2',
  size,
  className,
  ...props
}: ComponentProps<'h2'> & VariantProps<typeof displayHeadingVariants> & { as?: 'h1' | 'h2' }) {
  return <Tag className={cn(displayHeadingVariants({ size }), className)} {...props} />
}

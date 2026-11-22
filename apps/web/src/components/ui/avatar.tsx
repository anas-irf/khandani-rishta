import { cva, type VariantProps } from 'class-variance-authority'
import { Avatar as AvatarPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/** Arches at 4:5 (DESIGN.md 5.2). Photos and monograms are never circles. */
const avatarVariants = cva('relative flex shrink-0 overflow-hidden rounded-arch', {
  variants: {
    size: {
      xs: 'h-[50px] w-[40px]',
      sm: 'h-[58px] w-[46px]',
      md: 'h-[70px] w-[56px]',
      lg: 'h-[80px] w-[64px]',
      xl: 'h-[120px] w-[96px]',
    },
  },
  defaultVariants: { size: 'xs' },
})

function Avatar({
  className,
  size,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & VariantProps<typeof avatarVariants>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(avatarVariants({ size }), className)}
      {...props}
    />
  )
}

/** Always pass `alt` (use `alt=""` when the name is shown next to the avatar). */
function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('size-full select-none object-cover', className)}
      {...props}
      // Deterrent only (17 section 11). Set after the spread so callers cannot turn it back on.
      draggable={false}
    />
  )
}

/** The monogram arch: initials in serif italic inside a gold hairline. */
function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-arch border-[1.5px] border-accent-decor bg-muted font-display text-[18px] leading-none text-primary italic',
        className,
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarFallback, AvatarImage, avatarVariants }

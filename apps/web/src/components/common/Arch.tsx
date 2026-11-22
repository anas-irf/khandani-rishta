import { cva, type VariantProps } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { avatarVariants } from '~/components/ui/avatar'
import { cn, initialsOf } from '~/lib/utils'

/** The frame of every member photo: an arch at 4:5 that clips what is inside (DESIGN.md 4.1). */
export function ArchFrame({
  large = false,
  asChild = false,
  className,
  ...props
}: ComponentProps<'div'> & {
  /** The 22 bottom corners of the profile gallery. */
  large?: boolean
  /** The single child becomes the arch: a button keeps its focus ring outside the clip. */
  asChild?: boolean
}) {
  const Element = asChild ? Slot.Root : 'div'
  return (
    <Element
      data-slot="arch"
      className={cn(
        'tonal relative overflow-hidden',
        large ? 'rounded-arch-lg' : 'rounded-arch',
        className,
      )}
      {...props}
    />
  )
}

/** The gold line inside an arch; `double` adds the fainter second line of the profile. */
export function ArchInlay({ double = false }: { double?: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-[14px] rounded-arch-inner border border-accent-decor"
      />
      {double ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[23px] rounded-arch-inner border border-accent-decor/45"
        />
      ) : null}
    </>
  )
}

// Letters as a picture, so they follow the arch they sit in and not the reader's text size.
const monogramVariants = cva('font-display text-primary italic', {
  variants: {
    size: {
      // The line height follows its size: tailwind-merge drops one that comes before a size.
      xs: 'text-[18px] leading-none',
      sm: 'text-[22px] leading-none',
      md: 'text-[34px] leading-none',
      card: 'text-[58px] leading-none',
      /** The centre arch of the landing hero, small in the rows of a phone. */
      hero: 'text-[22px] leading-none wide:text-[68px] wide:leading-none',
      profile: 'text-[76px] leading-none',
    },
  },
  defaultVariants: { size: 'sm' },
})

/** The first letters of the first and last words of a name, in serif italic (DESIGN.md 6.8). */
export function Monogram({
  name,
  size,
  className,
}: { name: string | null | undefined; className?: string } & VariantProps<
  typeof monogramVariants
>) {
  return (
    <span aria-hidden="true" className={cn(monogramVariants({ size }), className)}>
      {initialsOf(name)}
    </span>
  )
}

const monogramArchVariants = cva('items-center justify-center border-[1.5px]', {
  variants: {
    tone: {
      sand: 'border-accent-decor bg-muted',
      page: 'border-accent-decor bg-background',
      primary: 'border-primary bg-primary',
    },
  },
  defaultVariants: { tone: 'sand' },
})

const MONOGRAM_IN_ARCH = { xs: 'xs', sm: 'sm', md: 'sm', lg: 'sm', xl: 'md' } as const

/** A small arch holding a monogram. Decorative: the name is always written next to it. */
export function MonogramArch({
  name,
  size = 'sm',
  tone,
  className,
}: {
  name: string | null | undefined
  size?: keyof typeof MONOGRAM_IN_ARCH
  className?: string
} & VariantProps<typeof monogramArchVariants>) {
  return (
    <span
      aria-hidden="true"
      className={cn(avatarVariants({ size }), monogramArchVariants({ tone }), className)}
    >
      <Monogram
        name={name}
        size={MONOGRAM_IN_ARCH[size]}
        className={cn(tone === 'primary' && 'text-primary-foreground')}
      />
    </span>
  )
}

const archIconVariants = cva('flex shrink-0 items-center justify-center rounded-arch-sm', {
  variants: {
    size: {
      sm: 'h-[44px] w-[36px] [&>svg]:size-[20px]',
      md: 'h-[56px] w-[46px] [&>svg]:size-[22px]',
      lg: 'h-[68px] w-[56px] [&>svg]:size-[24px]',
    },
    tone: {
      tonal: 'tonal text-foreground',
      primary: 'bg-primary-soft text-primary',
      success: 'bg-success-soft text-success',
      solid: 'bg-success text-success-foreground',
      warning: 'bg-warning-soft text-warning',
      danger: 'bg-danger-soft text-danger',
      outline: 'border-[1.5px] border-accent-decor text-primary',
    },
  },
  defaultVariants: { size: 'md', tone: 'primary' },
})

export type ArchTone = NonNullable<VariantProps<typeof archIconVariants>['tone']>

/** An icon in a small arch, in place of an icon in a circle. Decorative. */
export function ArchIcon({
  icon: Icon,
  size,
  tone,
  className,
}: { icon: LucideIcon; className?: string } & VariantProps<typeof archIconVariants>) {
  return (
    <span aria-hidden="true" className={cn(archIconVariants({ size, tone }), className)}>
      <Icon strokeWidth={1.8} />
    </span>
  )
}

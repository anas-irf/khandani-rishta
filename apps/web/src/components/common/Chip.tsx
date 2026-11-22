import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '~/lib/utils'

// The 24 radius is a pill at one line and stays a soft rectangle at two.
const chipClass = 'tonal inline-flex max-w-full items-center rounded-lg text-body-sm'

/** A word or two on the fill that stands out on the band behind it (hobbies). */
export function Chip({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="chip" className={cn(chipClass, 'px-[16px] py-[8px]', className)} {...props} />
  )
}

/** A chosen value with a 48 by 48 button that takes it away (filters, multi-selects). */
export function RemovableChip({
  children,
  removeLabel,
  onRemove,
  disabled,
  className,
}: {
  children: ReactNode
  removeLabel: string
  onRemove: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <span
      data-slot="chip"
      className={cn(chipClass, 'min-h-touch border border-input ps-4', className)}
    >
      <span dir="auto" className="min-w-0 py-[8px]">
        {children}
      </span>
      <button
        type="button"
        aria-label={removeLabel}
        disabled={disabled}
        onClick={onRemove}
        className="inline-flex size-touch shrink-0 items-center justify-center rounded-pill text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </span>
  )
}

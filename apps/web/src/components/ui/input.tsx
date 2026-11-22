import { cva } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/** The look of every field: input, text area, select and combobox trigger (DESIGN.md 4). */
const controlVariants = cva(
  'w-full min-w-0 rounded-input border-[1.5px] border-input bg-surface text-body-md text-foreground transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-muted-strong disabled:text-foreground-secondary aria-invalid:border-danger aria-invalid:bg-danger-soft',
  {
    variants: {
      control: {
        // Side paddings are px, so larger text keeps the room for what is written.
        input: 'flex min-h-touch px-[16px] py-2 text-ellipsis',
        textarea: 'flex min-h-24 resize-y px-[16px] py-3',
        select: 'min-h-touch appearance-none py-2 ps-[16px] pe-[calc(1.25rem+14px)] text-ellipsis',
      },
    },
    defaultVariants: { control: 'input' },
  },
)

/** Text input. 17 px text on purpose: under 16 px, iOS Safari zooms in when focused. */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        controlVariants({ control: 'input' }),
        'file:me-3 file:border-0 file:bg-transparent file:text-label-md file:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { controlVariants, Input }

import { cva, type VariantProps } from 'class-variance-authority'
import { Label as LabelPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

const labelVariants = cva(
  'flex select-none items-center gap-2 text-label-lg text-foreground peer-disabled:cursor-not-allowed peer-disabled:text-muted-foreground group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-muted-foreground',
  {
    variants: {
      variant: {
        field: '',
        /** One part of a field of several ("From", "Feet", "Country code"). */
        part: 'text-body-sm font-normal text-muted-foreground',
        /** The words of a checkbox or radio, the whole row to tap. */
        option: 'min-h-touch gap-3 text-body-md font-normal',
      },
    },
    defaultVariants: { variant: 'field' },
  },
)

function Label({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(labelVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Label }

import type * as React from 'react'
import { controlVariants } from '~/components/ui/input'
import { cn } from '~/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(controlVariants({ control: 'textarea' }), className)}
      {...props}
    />
  )
}

export { Textarea }

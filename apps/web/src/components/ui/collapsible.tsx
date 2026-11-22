import { Collapsible as CollapsiblePrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

function Collapsible(props: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

/** The whole row opens and closes: 56 tall, the label at 18 / 700, with room for a chevron. */
function CollapsibleTrigger({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        'group/collapsible flex min-h-touch-lg w-full items-center justify-between gap-3 rounded-sm py-2 text-start text-emphasis text-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CollapsibleContent(props: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return <CollapsiblePrimitive.Content data-slot="collapsible-content" {...props} />
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger }

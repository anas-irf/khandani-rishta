import { Tabs as TabsPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-4', className)}
      {...props}
    />
  )
}

/**
 * Pills that wrap onto another line at larger text and are never clipped. `chip` is the second
 * level, under a row of pills. Give the list an `aria-label` when no visible heading introduces it.
 */
function TabsList({
  className,
  variant = 'pill',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: 'pill' | 'chip' }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn('group/tabs flex max-w-full flex-wrap items-center gap-2', className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex min-h-touch min-w-touch max-w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-transparent px-[16px] py-[8px] text-center text-label-lg text-foreground transition-colors hover:tonal disabled:cursor-not-allowed disabled:text-muted-foreground group-data-[variant=chip]/tabs:border-input group-data-[variant=chip]/tabs:px-4 group-data-[variant=chip]/tabs:text-label-md data-[state=active]:border-primary data-[state=active]:bg-primary-soft data-[state=active]:font-bold data-[state=active]:text-primary group-data-[variant=chip]/tabs:data-[state=active]:border-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-5',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 rounded-sm', className)}
      {...props}
    />
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }

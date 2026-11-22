import { Tooltip as TooltipPrimitive } from 'radix-ui'
import * as React from 'react'
import { cn } from '~/lib/utils'

// Tooltips do not appear on touch screens. Never put information only in a tooltip.

const ProviderPresentContext = React.createContext(false)

/** Mount once near the app root to share delays between tooltips. */
function TooltipProvider({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <ProviderPresentContext.Provider value={true}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        {...props}
      />
    </ProviderPresentContext.Provider>
  )
}

/** Works with or without an ancestor `TooltipProvider`: it adds its own when there is none. */
function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const hasProvider = React.useContext(ProviderPresentContext)
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />
  return hasProvider ? root : <TooltipProvider>{root}</TooltipProvider>
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-50 max-w-[min(320px,calc(100vw-16px))] origin-(--radix-tooltip-content-transform-origin) rounded-item bg-inverse px-3 py-2 text-caption text-balance text-inverse-foreground motion-safe:transition-[opacity,scale] motion-safe:starting:scale-95 motion-safe:starting:opacity-0',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-inverse" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }

import { ChevronDown } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { cn } from '~/lib/utils'
import { DiamondTitle } from './Ornament'

export type DisclosureProps = {
  title: ReactNode
  /** Small words after the title: "(optional)", "2 selected". */
  note?: ReactNode
  /** Heading level that fits the page outline (default h3). */
  as?: 'h2' | 'h3'
  /** The diamond before the title, where the groups beside it have one. */
  ornament?: boolean
  defaultOpen?: boolean
  /** Something inside needs attention (an error): the group opens, and stays open afterwards. */
  forceOpen?: boolean
  /** Keeps what is inside mounted while closed, for controls that hold their own state. */
  keepMounted?: boolean
  children: ReactNode
  className?: string
  contentClassName?: string
}

/** A titled group that opens and closes. The whole title row is its button. */
export function Disclosure({
  title,
  note,
  as: Heading = 'h3',
  ornament = false,
  defaultOpen = false,
  forceOpen = false,
  keepMounted = false,
  children,
  className,
  contentClassName,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])
  const shown = open || forceOpen
  const label = (
    <>
      {title}
      {note ? (
        <>
          {' '}
          <span className="text-body-sm font-normal text-muted-foreground">{note}</span>
        </>
      ) : null}
    </>
  )

  return (
    <Collapsible open={shown} onOpenChange={setOpen} className={className}>
      <Heading>
        <CollapsibleTrigger className={cn(ornament && 'text-title-md font-bold')}>
          {ornament ? (
            <DiamondTitle>{label}</DiamondTitle>
          ) : (
            <span className="min-w-0">{label}</span>
          )}
          <ChevronDown
            aria-hidden="true"
            className="size-5 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-180"
          />
        </CollapsibleTrigger>
      </Heading>
      <CollapsibleContent {...(keepMounted ? { forceMount: true, hidden: !shown } : {})}>
        <div className={cn('flex flex-col gap-5 pt-4 pb-5', contentClassName)}>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

import { UserX } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'
import { ArchIcon } from './Arch'

/**
 * The quiet row in place of a compact card when the member is no longer available (Shortlist,
 * Interests, photo requests): the arch keeps its place and the list keeps its rhythm.
 */
export function UnavailableRow({
  text,
  children,
  className,
  ...props
}: ComponentProps<'div'> & { text: string }) {
  return (
    <div
      data-slot="unavailable-row"
      className={cn(
        'grid min-h-[76px] grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 py-3',
        className,
      )}
      {...props}
    >
      <ArchIcon
        icon={UserX}
        tone="tonal"
        className="h-[76px] w-[60px] rounded-arch text-muted-foreground"
      />
      <div className="flex min-w-0 flex-col items-start gap-2 self-center">
        <p className="text-title-sm text-muted-foreground">{text}</p>
        {children}
      </div>
    </div>
  )
}

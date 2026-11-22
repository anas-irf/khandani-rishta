import { Button, type ButtonProps } from '~/components/ui/button'
import { cn } from '~/lib/utils'

/** A queue beside the item under review. At large text the queue gives way first. */
export const queueGridClass = 'grid grid-cols-[min(17rem,36%)_minmax(0,1fr)] items-start gap-6'

/** One item of a review queue. The one under review takes the selected border and fill. */
export function QueueButton({
  selected,
  className,
  ...props
}: ButtonProps & { selected: boolean }) {
  return (
    <Button
      variant="ghost"
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'w-full justify-start rounded-row px-3 py-2 text-start text-body-sm font-normal aria-[current=true]:border-primary aria-[current=true]:bg-primary-soft',
        className,
      )}
      {...props}
    />
  )
}

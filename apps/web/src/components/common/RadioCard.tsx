import type { ComponentProps, ReactNode } from 'react'
import { RadioGroupItem } from '~/components/ui/radio-group'
import { cn } from '~/lib/utils'

/**
 * A choice that needs an explanation: the whole row is the label of its radio, and the chosen
 * one takes the selected border (DESIGN.md 4.1 row radius, 4.2). Place it inside a `RadioGroup`.
 */
export function RadioCard({
  id,
  label,
  description,
  className,
  ...itemProps
}: Omit<ComponentProps<typeof RadioGroupItem>, 'id' | 'children'> & {
  id: string
  label: ReactNode
  description?: ReactNode
}) {
  const labelId = `${id}-title`
  const descriptionId = description ? `${id}-description` : undefined
  return (
    <label
      htmlFor={id}
      data-slot="radio-card"
      className={cn(
        'tonal flex min-h-touch items-start gap-3 rounded-row border-[1.5px] border-transparent px-4 py-3 transition-colors hover:bg-muted-strong has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft has-[:disabled]:cursor-not-allowed',
        className,
      )}
    >
      <RadioGroupItem
        id={id}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        {...itemProps}
      />
      <span className="grid min-w-0 gap-1">
        <span id={labelId} className="text-title-sm">
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className="text-body-sm text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

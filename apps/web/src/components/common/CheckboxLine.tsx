import type { ComponentProps, ReactNode } from 'react'
import { Checkbox } from '~/components/ui/checkbox'
import { Label } from '~/components/ui/label'

/** A checkbox and its words. They may hold links and wrap beside the box, which stays on top. */
export function CheckboxLine({
  id,
  label,
  ...props
}: ComponentProps<typeof Checkbox> & { id: string; label: ReactNode }) {
  return (
    <div className="flex min-h-touch items-start gap-3 py-[11px]">
      <Checkbox id={id} {...props} />
      <Label htmlFor={id} className="block min-w-0 text-body-md font-normal">
        {label}
      </Label>
    </div>
  )
}

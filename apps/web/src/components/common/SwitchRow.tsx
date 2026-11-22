import { type ComponentProps, type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '~/components/ui/spinner'
import { SwitchRoot, SwitchTrack } from '~/components/ui/switch'
import { cn } from '~/lib/utils'

export type SwitchRowProps = Omit<ComponentProps<typeof SwitchRoot>, 'children'> & {
  label: ReactNode
  help?: ReactNode
  /** A save is running: a spinner before the track. */
  busy?: boolean
}

/**
 * A setting that is one switch from edge to edge (DESIGN.md 6.11): at least 72 tall, the label
 * and its help at the start, then the track and the word "On" or "Off". It takes the state props
 * of a Radix switch (`checked`, `onCheckedChange`, `disabled`).
 */
export function SwitchRow({
  label,
  help,
  busy = false,
  className,
  'aria-describedby': describedBy,
  ...props
}: SwitchRowProps) {
  const { t } = useTranslation()
  const id = useId()
  const labelId = `${id}-label`
  const helpId = help ? `${id}-help` : undefined

  return (
    <SwitchRoot
      data-slot="switch-row"
      aria-labelledby={labelId}
      aria-describedby={[helpId, describedBy].filter(Boolean).join(' ') || undefined}
      className={cn(
        'tonal flex min-h-[72px] w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-row py-3 ps-[20px] pe-[16px] text-start text-foreground transition-colors enabled:hover:bg-muted-strong',
        className,
      )}
      {...props}
    >
      {/* A button holds phrasing content only, so every box here is a span. */}
      <span className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1">
        <span id={labelId} className="text-emphasis">
          {label}
        </span>
        {help ? (
          <span id={helpId} className="text-body-sm text-muted-foreground">
            {help}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="ms-auto inline-flex items-center gap-3">
        {busy ? <Spinner /> : null}
        <SwitchTrack />
        <span className="min-w-[1.75em] text-label-md font-bold">
          <span className="group-data-[state=checked]/switch:hidden">{t('switch.off')}</span>
          <span className="hidden group-data-[state=checked]/switch:inline">{t('switch.on')}</span>
        </span>
      </span>
    </SwitchRoot>
  )
}

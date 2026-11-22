import { Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { useFieldControl } from '~/lib/form-context'
import { fallbackLabel } from '~/lib/reference'
import { RemovableChip } from '../Chip'
import { ariaFor, type BaseFieldProps, FieldShell, subId, useFieldDisabled } from './field-shell'
import { OptionSearch, type SearchOption } from './option-search'
import { useFieldOptions } from './search-select-field'

export type MultiSelectFieldProps = BaseFieldProps & {
  options?: SearchOption[]
  /** A reference list or lookup table name, used when `options` is not given. */
  list?: string
  /** At most this many choices; the add control is disabled with a message when reached. */
  max?: number
  /** Text shown when nothing is chosen, for example "Any" for a preference (07 section 11.2). */
  emptyLabel?: string
  addLabel?: string
  searchPlaceholder?: string
}

/** Several choices shown as chips, added from a searchable list. Value `string[]`. */
export function MultiSelectField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  options,
  list,
  max,
  emptyLabel,
  addLabel,
  searchPlaceholder,
}: MultiSelectFieldProps) {
  const { t } = useTranslation('fields')
  const control = useFieldControl<string[]>()
  const isDisabled = useFieldDisabled(control, disabled)
  const items = useFieldOptions(options, list)
  const [open, setOpen] = useState(false)
  const listId = useId()
  const value = control.value ?? []
  const reached = max != null && value.length >= max
  const maxId = subId(control, 'max')
  const labelOf = (code: string) =>
    items.find((option) => option.code === code)?.label ?? fallbackLabel(code)

  function add(code: string) {
    if (value.includes(code) || reached) return
    const next = [...value, code]
    control.setValue(next)
    if (max != null && next.length >= max) setOpen(false)
  }

  function remove(code: string) {
    control.setValue(value.filter((entry) => entry !== code))
  }

  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
    >
      {value.length > 0 ? (
        <ul
          aria-label={t('fields:multi_select.selected_label', { label })}
          className="flex flex-wrap gap-2"
        >
          {value.map((code) => (
            <li key={code} className="max-w-full">
              <RemovableChip
                removeLabel={t('fields:multi_select.remove', { item: labelOf(code) })}
                disabled={isDisabled}
                onRemove={() => remove(code)}
              >
                {labelOf(code)}
              </RemovableChip>
            </li>
          ))}
        </ul>
      ) : emptyLabel ? (
        <p className="text-body-sm text-muted-foreground">{emptyLabel}</p>
      ) : null}
      <OptionSearch
        label={label}
        options={items}
        selected={value}
        excluded={value}
        onSelect={add}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) control.onBlur()
        }}
        searchPlaceholder={searchPlaceholder}
        closeOnSelect={false}
        listId={listId}
        trigger={
          <Button
            id={control.inputId}
            name={control.name}
            variant="secondary"
            className="w-fit"
            aria-label={t('fields:multi_select.add_label', { label })}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            disabled={isDisabled || reached}
            {...ariaFor(control, {
              required,
              hasHelp: Boolean(helpText),
              extraDescribedBy: reached ? maxId : undefined,
            })}
          >
            <Plus aria-hidden="true" />
            {addLabel ?? t('fields:multi_select.add')}
          </Button>
        }
      />
      {reached ? (
        <p id={maxId} role="status" className="text-caption text-muted-foreground">
          {t('fields:multi_select.max_reached', { max })}
        </p>
      ) : null}
    </FieldShell>
  )
}

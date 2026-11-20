import { ChevronsUpDown, X } from 'lucide-react'
import { type KeyboardEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { useFieldControl } from '~/lib/form-context'
import { fallbackLabel, type Option, useOptions } from '~/lib/reference'
import { cn } from '~/lib/utils'
import {
  type AriaProps,
  ariaFor,
  type BaseFieldProps,
  FieldShell,
  useFieldDisabled,
} from './field-shell'
import { OptionSearch, type OtherOption, type SearchOption } from './option-search'

/** Options from the `options` prop, else from the reference list named by `list`. */
export function useFieldOptions<T extends Option>(options: T[] | undefined, list?: string): T[] {
  const fromList = useOptions(list ?? '')
  return options ?? (fromList as T[])
}

type SearchSelectControlProps = {
  id: string
  name?: string
  label: string
  options: SearchOption[]
  value: string | null
  onChange: (code: string | null) => void
  onBlur?: () => void
  placeholder?: string
  searchPlaceholder?: string
  otherOption?: OtherOption
  maxResults?: number
  required?: boolean
  disabled?: boolean
  /** Text shown in the trigger when `value` is null but something else was chosen (`otherOption`). */
  displayText?: string
  /** Called by the clear button instead of `onChange(null)`. */
  onClear?: () => void
  aria: AriaProps
}

/** The trigger button, the popover list and the clear button. */
export function SearchSelectControl({
  id,
  name,
  label,
  options,
  value,
  onChange,
  onBlur,
  placeholder,
  searchPlaceholder,
  otherOption,
  maxResults,
  required = false,
  disabled = false,
  displayText,
  onClear,
  aria,
}: SearchSelectControlProps) {
  const { t } = useTranslation('fields')
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const listId = useId()
  const current = value ? options.find((option) => option.code === value) : undefined
  const text = value ? (current?.label ?? fallbackLabel(value)) : displayText

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (open || disabled) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setTyped('')
      setOpen(true)
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey) {
      // Typing on the closed control opens the list with that letter in the filter.
      event.preventDefault()
      setTyped(event.key)
      setOpen(true)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <OptionSearch
        label={label}
        options={options}
        selected={value ? [value] : []}
        onSelect={(code) => onChange(code)}
        otherOption={otherOption}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setTyped('')
            onBlur?.()
          }
        }}
        initialQuery={typed}
        searchPlaceholder={searchPlaceholder}
        maxResults={maxResults}
        listId={listId}
        trigger={
          <button
            type="button"
            id={id}
            name={name}
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            {...aria}
            disabled={disabled}
            onKeyDown={onTriggerKeyDown}
            className="flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-input)] border border-input bg-surface ps-3 pe-3 text-start text-base text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-danger aria-invalid:focus-visible:ring-danger"
          >
            <span dir="auto" className={cn('truncate', !text && 'text-muted-foreground')}>
              {text || placeholder || t('fields:search_select.placeholder')}
            </span>
            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        }
      />
      {!required && (value || displayText) ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('fields:search_select.clear', { label })}
          disabled={disabled}
          onClick={() => (onClear ? onClear() : onChange(null))}
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}

export type SearchSelectFieldProps = BaseFieldProps & {
  /** Options with optional aliases matched by the search (caste aliases, 07 section 5.2). */
  options?: SearchOption[]
  /** A reference list or lookup table name, used when `options` is not given. */
  list?: string
  placeholder?: string
  searchPlaceholder?: string
  /** A last row such as "Other (type your own)"; it receives the typed text. */
  otherOption?: OtherOption
  /** Shown in the control when the value is null but `otherOption` was used. */
  displayText?: string
  /** Replaces the default of the clear button (setting the value to null). */
  onClear?: () => void
  /** At most this many matches are listed (default 50). */
  maxResults?: number
}

/** A long list with search (07 section 2.6: selects with more than 8 options). Value `string | null`. */
export function SearchSelectField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  options,
  list,
  placeholder,
  searchPlaceholder,
  otherOption,
  displayText,
  onClear,
  maxResults,
}: SearchSelectFieldProps) {
  const control = useFieldControl<string | null>()
  const isDisabled = useFieldDisabled(control, disabled)
  const items = useFieldOptions(options, list)
  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
    >
      <SearchSelectControl
        id={control.inputId}
        name={control.name}
        label={label}
        options={items}
        value={control.value ?? null}
        onChange={control.setValue}
        onBlur={control.onBlur}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        otherOption={otherOption}
        displayText={displayText}
        onClear={onClear}
        maxResults={maxResults}
        required={required}
        disabled={isDisabled}
        aria={ariaFor(control, { required, hasHelp: Boolean(helpText) })}
      />
    </FieldShell>
  )
}

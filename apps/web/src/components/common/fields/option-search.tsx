import { Check } from 'lucide-react'
import { type KeyboardEvent, type ReactElement, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import type { Option } from '~/lib/reference'
import { cn } from '~/lib/utils'

/**
 * The searchable list behind `SearchSelectField`, `MultiSelectField` and the country control of
 * `CityPickerField` (07 section 2.6, 5.2): a popover with a filter input (`role="combobox"`)
 * and a `listbox`. Arrow keys move through the options, Enter chooses, Escape closes and returns
 * focus to the trigger.
 */

export type SearchOption = Option & { aliases?: string[] }

export type OtherOption = {
  label: string
  /** Called with the text typed in the filter ("Use 'typed text'", 07 section 5.2). */
  onSelect: (query: string) => void
}

/** Lower case without accents, so "Arain" matches "Arāin". */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

/**
 * Options matching `query` on the label or any alias, ignoring case and accents. Labels that
 * start with the query come first; the original order is kept inside each group.
 */
export function filterOptions<T extends SearchOption>(options: T[], query: string): T[] {
  const q = normalizeSearch(query)
  if (!q) return options
  const starts: T[] = []
  const contains: T[] = []
  for (const option of options) {
    const label = normalizeSearch(option.label)
    if (label.startsWith(q)) starts.push(option)
    else if (
      label.includes(q) ||
      option.aliases?.some((alias) => normalizeSearch(alias).includes(q))
    ) {
      contains.push(option)
    }
  }
  return [...starts, ...contains]
}

type OptionSearchProps = {
  /** Accessible name of the list ("Caste or biradari"). */
  label: string
  options: SearchOption[]
  /** Codes shown as selected (`aria-selected` and a check mark). */
  selected: string[]
  /** Codes left out of the list (already chosen in a multi-select). */
  excluded?: string[]
  onSelect: (code: string) => void
  otherOption?: OtherOption
  /** The trigger, rendered as the popover trigger (a `<button>`). */
  trigger: ReactElement
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Text typed on the trigger before the list opened. */
  initialQuery?: string
  searchPlaceholder?: string
  maxResults?: number
  closeOnSelect?: boolean
  /** Id of the listbox, so the trigger can reference it with `aria-controls`. */
  listId: string
}

export function OptionSearch({
  label,
  options,
  selected,
  excluded,
  onSelect,
  otherOption,
  trigger,
  open,
  onOpenChange,
  initialQuery = '',
  searchPlaceholder,
  maxResults = 50,
  closeOnSelect = true,
  listId,
}: OptionSearchProps) {
  const { t } = useTranslation('fields')
  const [query, setQuery] = useState(initialQuery)
  const [active, setActive] = useState(0)
  const optionIdPrefix = useId()

  const available = useMemo(() => {
    if (!excluded?.length) return options
    const skip = new Set(excluded)
    return options.filter((option) => !skip.has(option.code))
  }, [options, excluded])
  const matches = useMemo(() => filterOptions(available, query), [available, query])
  const visible = matches.slice(0, maxResults)
  const truncated = matches.length > visible.length
  const rows = visible.length + (otherOption ? 1 : 0)
  const selectedSet = new Set(selected)

  // When the list opens: start from the typed text, or at the selected option.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the list opens only
  useEffect(() => {
    if (!open) return
    setQuery(initialQuery)
    const index = initialQuery ? 0 : available.findIndex((option) => selected.includes(option.code))
    setActive(Math.max(0, index))
  }, [open])

  useEffect(() => {
    if (!open || rows === 0) return
    const element = document.getElementById(`${optionIdPrefix}-${Math.min(active, rows - 1)}`)
    element?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open, rows, optionIdPrefix])

  function choose(index: number) {
    if (index < visible.length) {
      const option = visible[index]
      if (!option) return
      onSelect(option.code)
      if (closeOnSelect) onOpenChange(false)
      else {
        setQuery('')
        setActive(0)
      }
      return
    }
    if (otherOption) {
      otherOption.onSelect(query.trim())
      onOpenChange(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((current) => (rows === 0 ? 0 : Math.min(current + 1, rows - 1)))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive((current) => Math.max(current - 1, 0))
        break
      case 'PageDown':
        event.preventDefault()
        setActive((current) => (rows === 0 ? 0 : Math.min(current + 10, rows - 1)))
        break
      case 'PageUp':
        event.preventDefault()
        setActive((current) => Math.max(current - 10, 0))
        break
      case 'Enter':
        // Never submit the surrounding form from the filter.
        event.preventDefault()
        if (rows > 0) choose(Math.min(active, rows - 1))
        break
      default:
        break
    }
  }

  const activeIndex = rows === 0 ? -1 : Math.min(active, rows - 1)
  const optionClass =
    'flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-[var(--radius-input)] px-3 py-2 text-base data-[active=true]:bg-muted'

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={label}
        className="flex w-(--radix-popover-trigger-width) min-w-72 flex-col p-0"
      >
        <div className="border-b border-border p-2">
          <Input
            role="combobox"
            aria-label={t('fields:search_select.search_label', { label })}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeIndex >= 0 ? `${optionIdPrefix}-${activeIndex}` : undefined
            }
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            dir="auto"
            placeholder={searchPlaceholder ?? t('fields:search_select.search')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div
          id={listId}
          role="listbox"
          aria-label={t('fields:search_select.options_label', { label })}
          className="max-h-72 overflow-y-auto p-1"
        >
          {visible.map((option, index) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: options are chosen by keyboard on the combobox input (aria-activedescendant)
            <div
              key={option.code}
              id={`${optionIdPrefix}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={selectedSet.has(option.code)}
              data-active={index === activeIndex}
              className={optionClass}
              // Keep focus in the filter input while the pointer is used.
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <Check
                aria-hidden="true"
                className={cn(
                  'size-4 shrink-0 text-primary',
                  !selectedSet.has(option.code) && 'invisible',
                )}
              />
              <span dir="auto">{option.label}</span>
            </div>
          ))}
          {otherOption ? (
            // biome-ignore lint/a11y/useKeyWithClickEvents: options are chosen by keyboard on the combobox input (aria-activedescendant)
            <div
              id={`${optionIdPrefix}-${visible.length}`}
              role="option"
              tabIndex={-1}
              aria-selected={false}
              data-active={visible.length === activeIndex}
              className={cn(optionClass, 'font-medium text-primary')}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(visible.length)}
              onClick={() => choose(visible.length)}
            >
              <span className="size-4 shrink-0" aria-hidden="true" />
              <span>{otherOption.label}</span>
            </div>
          ) : null}
        </div>
        {visible.length === 0 ? (
          <p role="status" className="px-3 pb-3 text-sm text-muted-foreground">
            {t('fields:search_select.no_results')}
          </p>
        ) : null}
        {truncated ? (
          <p
            role="status"
            className="border-t border-border px-3 py-2 text-sm text-muted-foreground"
          >
            {t('fields:search_select.more_results', { shown: visible.length })}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

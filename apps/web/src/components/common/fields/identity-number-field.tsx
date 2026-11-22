import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '~/components/ui/input'
import { useFieldControl } from '~/lib/form-context'
import { ariaFor, type BaseFieldProps, FieldShell, useFieldDisabled } from './field-shell'

export type IdentityDocumentType = 'cnic' | 'nicop' | 'poc' | 'passport'

const CNIC_DIGITS = 13
const PASSPORT_MAX = 12

function isCnicLike(type: IdentityDocumentType): boolean {
  return type !== 'passport'
}

/**
 * The number as stored and sent (12 section 3.2 and 3.7): spaces and hyphens removed, upper
 * case. CNIC, NICOP and POC keep digits only (at most 13); a passport keeps letters and digits
 * (at most 12).
 */
export function normalizeIdentityNumber(type: IdentityDocumentType, input: string): string {
  const compact = input.replace(/[\s-]/g, '').toUpperCase()
  return isCnicLike(type)
    ? compact.replace(/\D/g, '').slice(0, CNIC_DIGITS)
    : compact.replace(/[^A-Z0-9]/g, '').slice(0, PASSPORT_MAX)
}

/** `3520212345671` shown as `35202-1234567-1`: hyphens after the 5th and 12th digit. */
export function formatIdentityNumber(type: IdentityDocumentType, value: string): string {
  if (!isCnicLike(type)) return value
  const digits = value.replace(/\D/g, '').slice(0, CNIC_DIGITS)
  if (digits.length <= 5) return digits
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`
}

/** Index in `formatted` just after the `count`-th character that is not a hyphen. */
function caretAfter(formatted: string, count: number): number {
  if (count <= 0) return 0
  let seen = 0
  for (let index = 0; index < formatted.length; index += 1) {
    if (formatted[index] !== '-') seen += 1
    if (seen === count) return index + 1
  }
  return formatted.length
}

export type IdentityNumberFieldProps = BaseFieldProps & {
  documentType: IdentityDocumentType
  placeholder?: string
}

/**
 * Identity number with the input mask of 12 section 3.7. Value `string | null`: the normalised
 * number without hyphens (13 digits for CNIC, NICOP and POC; letters and digits for a passport).
 */
export function IdentityNumberField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  documentType,
  placeholder,
}: IdentityNumberFieldProps) {
  const { t } = useTranslation('fields')
  const control = useFieldControl<string | null>()
  const isDisabled = useFieldDisabled(control, disabled)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const cnicLike = isCnicLike(documentType)
  const display = formatIdentityNumber(documentType, control.value ?? '')

  // Keep the caret where it was typed when hyphens are added or removed around it.
  useLayoutEffect(() => {
    const caret = pendingCaret.current
    const input = inputRef.current
    if (caret == null || !input || document.activeElement !== input) return
    pendingCaret.current = null
    input.setSelectionRange(caret, caret)
  })

  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
    >
      <Input
        ref={inputRef}
        id={control.inputId}
        name={control.name}
        type="text"
        dir="ltr"
        inputMode={cnicLike ? 'numeric' : 'text'}
        autoComplete="off"
        autoCapitalize={cnicLike ? 'off' : 'characters'}
        autoCorrect="off"
        spellCheck={false}
        maxLength={cnicLike ? CNIC_DIGITS + 2 : PASSPORT_MAX + 4}
        placeholder={
          placeholder ??
          (cnicLike
            ? t('fields:identity.placeholder_cnic')
            : t('fields:identity.placeholder_passport'))
        }
        value={display}
        onChange={(event) => {
          const raw = event.target.value
          const caret = event.target.selectionStart ?? raw.length
          const before = normalizeIdentityNumber(documentType, raw.slice(0, caret)).length
          const normalized = normalizeIdentityNumber(documentType, raw)
          pendingCaret.current = caretAfter(formatIdentityNumber(documentType, normalized), before)
          control.setValue(normalized === '' ? null : normalized)
        }}
        onBlur={control.onBlur}
        disabled={isDisabled}
        className="tabular-nums"
        {...ariaFor(control, { required, hasHelp: Boolean(helpText) })}
      />
    </FieldShell>
  )
}

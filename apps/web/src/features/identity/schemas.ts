import { type Issue, sectionSchema } from '~/features/profile-sections/schemas'
import type { IdentityDocumentType } from '~/lib/api-types'

/**
 * The identity number form (07 section 13, 12 section 3). Client rules are those marked C in
 * 07 section 16.8; the API checks the rest (first digit, dummy numbers, the gender digit).
 */

export const IDENTITY_NS = 'identity'

export type IdentityValues = {
  document_type: IdentityDocumentType
  /** Normalised by `IdentityNumberField`: no hyphens or spaces, upper case. */
  number: string | null
}

/** The preselected document type (07 section 13.2, 12 section 3.1). */
export function defaultDocumentType(
  nationalityCode: string | null | undefined,
  countryCode: string | null | undefined,
): IdentityDocumentType {
  // A missing nationality counts as Pakistani: the location step defaults it to PK.
  if (nationalityCode && nationalityCode !== 'PK') return 'passport'
  if (countryCode && countryCode !== 'PK') return 'nicop'
  return 'cnic'
}

export function isCnicLike(type: IdentityDocumentType): boolean {
  return type !== 'passport'
}

/** Whether the number is complete enough to submit: 13 digits for CNIC, NICOP and POC (12 3.7). */
export function numberComplete(values: IdentityValues): boolean {
  if (!values.number) return false
  return isCnicLike(values.document_type) ? /^\d{13}$/.test(values.number) : true
}

export function validateIdentity(values: IdentityValues): Issue[] {
  const message = (code: string) => `${IDENTITY_NS}:errors.number.${code}`
  const number = values.number?.replace(/[\s-]/g, '').toUpperCase() ?? ''
  if (number === '') return [{ path: 'number', message: message('required') }]
  if (isCnicLike(values.document_type)) {
    if (!/^\d{13}$/.test(number)) return [{ path: 'number', message: message('invalid_cnic') }]
  } else if (!/^[A-Z0-9]{6,12}$/.test(number) || !/\d/.test(number)) {
    return [{ path: 'number', message: message('invalid_passport') }]
  }
  return []
}

export const identitySchema = sectionSchema<IdentityValues>(validateIdentity)

import { HttpResponse, http } from 'msw'
import type { IdentityBody, IdentityDocumentType, IdentitySummary } from '~/lib/api-types'
import { db } from '../db'
import { apiError, apiUrl, readJson, validationError } from '../http'
import { gateErrorFor } from './account'
import { fieldError } from './profile'

/**
 * 15 section 7 and 12 section 3: the identity document number.
 *
 * `GET /v1/me/identity` answers the `IdentitySummary`, or `null` when no number was added.
 *
 * Test numbers that answer `409 identity_already_registered` (12 section 3.4), so the dialog of
 * 07 section 13.4 can be tried:
 * - CNIC or NICOP `35201-9999999-x`, where `x` is any digit that matches the gender (odd for a
 *   male profile, even for a female one), for example `3520199999992` for a woman;
 * - passport `ZZ9999999`.
 */

export const REGISTERED_PK_ID_PREFIX = '352019999999'
export const REGISTERED_PASSPORT = 'ZZ9999999'

const DOCUMENT_TYPES: IdentityDocumentType[] = ['cnic', 'nicop', 'poc', 'passport']

/** 12 section 3.2: trim, remove spaces and hyphens, upper case. */
export function normaliseIdentityNumber(number: string): string {
  return number.trim().replace(/[\s-]/g, '').toUpperCase()
}

/** "*********1234": asterisks for every character except the last four (12 section 2.3). */
export function maskIdentityNumber(number: string): string {
  return `${'*'.repeat(Math.max(0, number.length - 4))}${number.slice(-4)}`
}

function isRegistered(documentType: IdentityDocumentType, number: string): boolean {
  const registered = (db.extra['identity.registered'] as string[] | undefined) ?? []
  if (registered.includes(number)) return true
  if (documentType === 'passport') return number === REGISTERED_PASSPORT
  return documentType !== 'poc' && number.startsWith(REGISTERED_PK_ID_PREFIX)
}

export const handlers = [
  http.get(apiUrl('/v1/me/identity'), () => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    return HttpResponse.json(db.identity)
  }),

  http.put(apiUrl('/v1/me/identity'), async ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    const body = await readJson<Partial<IdentityBody>>(request)
    const documentType = body.document_type
    if (!documentType || !DOCUMENT_TYPES.includes(documentType)) {
      return validationError([fieldError('document_type', 'required')])
    }
    if (db.identity && (db.identity.status === 'pending' || db.identity.status === 'verified')) {
      return apiError(409, 'invalid_state', 'The identity is being verified or is verified.', {
        details: { status: db.identity.status },
      })
    }
    const gender = db.ownProfile.basics.gender
    if (!gender) {
      return apiError(409, 'invalid_state', 'The profile has no gender yet.', {
        details: { onboarding_step: db.me.profile.onboarding_step },
      })
    }

    const number = normaliseIdentityNumber(body.number ?? '')
    const invalid = (message: string) => validationError([fieldError('number', 'invalid', message)])
    if (number === '')
      return validationError([fieldError('number', 'required', 'Enter the number.')])
    if (documentType === 'passport') {
      if (!/^[A-Z0-9]{6,12}$/.test(number) || !/\d/.test(number)) {
        return invalid('A passport number has 6 to 12 letters and digits.')
      }
    } else {
      if (!/^\d{13}$/.test(number)) return invalid('A CNIC number has 13 digits.')
      if (documentType !== 'poc') {
        const first = Number(number[0])
        if (first < 1 || first > 8 || /^(\d)\1{12}$/.test(number) || number === '1234567890123') {
          return invalid('This does not look like a valid CNIC number.')
        }
        const last = Number(number[12])
        if ((last % 2 === 1) !== (gender === 'male')) {
          return validationError([
            fieldError(
              'number',
              'mismatch',
              'This number does not match the gender on the profile. Please check the number and the gender. If both are correct, contact support.',
            ),
          ])
        }
      }
    }
    if (isRegistered(documentType, number)) {
      return apiError(
        409,
        'identity_already_registered',
        'This number is already registered with another profile. If you believe this is a mistake, contact support.',
      )
    }

    const summary: IdentitySummary = {
      document_type: documentType,
      number_masked: maskIdentityNumber(number),
      status: 'unverified',
      verified_at: null,
    }
    db.identity = summary
    db.ownProfile = { ...db.ownProfile, identity: summary }
    return HttpResponse.json(summary)
  }),
]

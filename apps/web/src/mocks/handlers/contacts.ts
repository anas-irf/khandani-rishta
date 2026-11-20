import { HttpResponse, http } from 'msw'
import type { ApiFieldError, ContactsSection } from '~/lib/api-types'
import { db } from '../db'
import { referenceBootstrap } from '../fixtures/reference'
import { apiUrl, readJson, validationError } from '../http'
import { gateErrorFor } from './account'
import { checkName, checkText, collapse, fieldError, ownProfileView } from './profile'

/**
 * `PUT /v1/me/profile/sections/contacts` (15 section 7) with the rules of 08 section 3:
 * E.164 phone numbers with the Pakistani mobile rule, the email format, the guardian fields
 * required together, and the free-text rules for `guardian_name` and `best_time_to_call`.
 * `handlers/profile.ts` leaves this section to this file.
 */

const E164 = /^\+[1-9][0-9]{7,14}$/
const PHONE_FIELDS = ['phone_e164', 'whatsapp_e164', 'guardian_phone_e164'] as const
const GUARDIAN_FIELDS = ['guardian_name', 'guardian_relation', 'guardian_phone_e164'] as const

const MESSAGES = {
  phone: 'Enter a valid phone number with the country code.',
  pkMobile: 'Enter a valid mobile number, for example 300 1234567.',
  email: 'Enter a valid email address.',
  emailLong: 'This email address is too long.',
  guardian: "Enter the guardian's name, relation and mobile number.",
  guardianName: 'Enter a name of 2 to 80 characters, letters only.',
  bestTime: 'Keep it under 80 characters.',
  preferred: 'Choose who families should contact first.',
}

/** 08 section 3.3 rules 4 and 5. */
export function phoneError(value: string): string | null {
  if (!E164.test(value)) return MESSAGES.phone
  if (value.startsWith('+92') && !/^\+923\d{9}$/.test(value)) return MESSAGES.pkMobile
  return null
}

/** 08 section 3.2: one `@`, something before it, a dot in the domain part, no spaces. */
export function emailValid(value: string): boolean {
  const parts = value.split('@')
  if (parts.length !== 2 || /\s/.test(value)) return false
  const [local, domain] = parts
  return (
    Boolean(local) &&
    Boolean(domain?.includes('.')) &&
    !domain?.startsWith('.') &&
    !domain?.endsWith('.')
  )
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export const handlers = [
  http.put(apiUrl('/v1/me/profile/sections/contacts'), async ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    const body = await readJson<ContactsSection>(request)
    const errors: ApiFieldError[] = []

    const value = {
      phone_e164: text(body.phone_e164),
      whatsapp_e164: text(body.whatsapp_e164),
      contact_email: text(body.contact_email),
      guardian_name: collapse(body.guardian_name),
      guardian_relation: body.guardian_relation || null,
      guardian_phone_e164: text(body.guardian_phone_e164),
      preferred_contact: body.preferred_contact,
      best_time_to_call: collapse(body.best_time_to_call),
    } satisfies ContactsSection

    for (const field of PHONE_FIELDS) {
      const phone = value[field]
      const message = phone ? phoneError(phone) : null
      if (message) errors.push(fieldError(field, 'invalid', message))
    }

    const email = value.contact_email
    if (email && email.length > 254)
      errors.push(fieldError('contact_email', 'too_long', MESSAGES.emailLong))
    else if (email && !emailValid(email)) {
      errors.push(fieldError('contact_email', 'invalid', MESSAGES.email))
    }

    if (value.preferred_contact !== 'self' && value.preferred_contact !== 'guardian') {
      errors.push(fieldError('preferred_contact', 'invalid', MESSAGES.preferred))
    }

    // 08 section 3.4: the three guardian fields go together, and are required for `guardian`.
    const anyGuardian = GUARDIAN_FIELDS.some((field) => value[field] != null)
    if (anyGuardian || value.preferred_contact === 'guardian') {
      for (const field of GUARDIAN_FIELDS) {
        if (value[field] == null) errors.push(fieldError(field, 'required', MESSAGES.guardian))
      }
    }
    checkName(errors, 'guardian_name', value.guardian_name, 80, { length: MESSAGES.guardianName })
    if (
      value.guardian_relation &&
      !(referenceBootstrap.options.guardian_relation ?? []).some(
        (option) => option.code === value.guardian_relation,
      )
    ) {
      errors.push(fieldError('guardian_relation', 'unknown_code'))
    }
    checkText(errors, 'best_time_to_call', value.best_time_to_call, {
      max: 80,
      lengthMessage: MESSAGES.bestTime,
    })

    if (errors.length > 0) return validationError(errors)
    db.ownProfile = { ...db.ownProfile, contacts: value }
    return HttpResponse.json(ownProfileView())
  }),
]

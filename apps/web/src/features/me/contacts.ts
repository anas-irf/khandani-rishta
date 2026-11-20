import { z } from 'zod'
import type { ContactsSection, Filled } from '~/lib/api-types'

/**
 * The contact details form of `SET-CONTACTS` (08 section 3): values, prefill, the request body
 * and the client-side rules. Messages are i18n keys of the `me` namespace, the same keys
 * `serverFieldMessage('me', ...)` uses for the API's field errors (`me:errors.<field>.<code>`).
 */

export const CONTACTS_NS = 'me'

export type ContactsValues = {
  phone_e164: string | null
  /** "Same as mobile number": the WhatsApp control is hidden and the mobile number is sent. */
  whatsapp_same: boolean
  whatsapp_e164: string | null
  contact_email: string | null
  preferred_contact: 'self' | 'guardian' | null
  guardian_name: string | null
  guardian_relation: Filled<ContactsSection>['guardian_relation']
  guardian_phone_e164: string | null
  best_time_to_call: string | null
}

/** Fields `focus` may name (08 section 3.5 step 2). */
export const FOCUSABLE_CONTACT_FIELDS = [
  'phone_e164',
  'whatsapp_e164',
  'contact_email',
  'guardian_name',
] as const

export const GUARDIAN_FIELDS = [
  'guardian_name',
  'guardian_relation',
  'guardian_phone_e164',
] as const

const E164 = /^\+[1-9][0-9]{7,14}$/
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*[\p{L}\p{M}.]$/u

function key(field: string, code: string) {
  return `${CONTACTS_NS}:errors.${field}.${code}`
}

/** Trims and collapses inner whitespace; empty is null. */
function collapse(value: string | null | undefined): string | null {
  const text = value?.trim().replace(/\s+/g, ' ') ?? ''
  return text === '' ? null : text
}

export function contactsFromProfile(contacts: ContactsSection): ContactsValues {
  const phone = contacts.phone_e164 ?? null
  const whatsapp = contacts.whatsapp_e164 ?? null
  const same = whatsapp !== null && whatsapp === phone
  return {
    phone_e164: phone,
    whatsapp_same: same,
    whatsapp_e164: same ? null : whatsapp,
    contact_email: contacts.contact_email ?? null,
    preferred_contact: contacts.preferred_contact ?? 'self',
    guardian_name: contacts.guardian_name ?? null,
    guardian_relation: contacts.guardian_relation ?? null,
    guardian_phone_e164: contacts.guardian_phone_e164 ?? null,
    best_time_to_call: contacts.best_time_to_call ?? null,
  }
}

/** The whole section for `PUT /v1/me/profile/sections/contacts`. */
export function contactsToBody(values: ContactsValues): ContactsSection {
  return {
    phone_e164: values.phone_e164,
    whatsapp_e164: values.whatsapp_same ? values.phone_e164 : values.whatsapp_e164,
    contact_email: values.contact_email?.trim() || null,
    guardian_name: collapse(values.guardian_name),
    guardian_relation: values.guardian_relation,
    guardian_phone_e164: values.guardian_phone_e164,
    preferred_contact: values.preferred_contact ?? 'self',
    best_time_to_call: collapse(values.best_time_to_call),
  }
}

/** 08 section 3.3 rules 4 and 5: the message key for a phone value, or null when valid. */
export function phoneIssue(field: string, value: string | null): string | null {
  if (!value) return null
  if (!E164.test(value)) return key(field, 'invalid')
  if (value.startsWith('+92') && !/^\+923\d{9}$/.test(value)) return key('phone', 'pk_mobile')
  return null
}

/** 08 section 3.2: one `@`, something before it, a dot in the domain part, no spaces. */
export function isEmail(value: string): boolean {
  if (/\s/.test(value)) return false
  const parts = value.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts as [string, string]
  return local.length > 0 && /^[^.]+(\.[^.]+)+$/.test(domain)
}

export type ContactIssue = { path: keyof ContactsValues; message: string }

/** The client-side rules of 08 sections 3.2 to 3.4, with the messages of 3.7. */
export function validateContacts(values: ContactsValues): ContactIssue[] {
  const issues: ContactIssue[] = []
  const phones = ['phone_e164', 'guardian_phone_e164'] as const
  for (const field of phones) {
    const issue = phoneIssue(field, values[field])
    if (issue) issues.push({ path: field, message: issue })
  }
  if (!values.whatsapp_same) {
    const issue = phoneIssue('whatsapp_e164', values.whatsapp_e164)
    if (issue) issues.push({ path: 'whatsapp_e164', message: issue })
  }

  const email = values.contact_email?.trim() ?? ''
  if (email.length > 254)
    issues.push({ path: 'contact_email', message: key('contact_email', 'too_long') })
  else if (email && !isEmail(email)) {
    issues.push({ path: 'contact_email', message: key('contact_email', 'invalid') })
  }

  if (values.preferred_contact !== 'self' && values.preferred_contact !== 'guardian') {
    issues.push({ path: 'preferred_contact', message: key('preferred_contact', 'invalid') })
  }

  const name = collapse(values.guardian_name)
  const relation = values.guardian_relation
  const guardianPhone = values.guardian_phone_e164
  const anyGuardian = name !== null || relation !== null || guardianPhone !== null
  if (anyGuardian || values.preferred_contact === 'guardian') {
    if (name === null) issues.push({ path: 'guardian_name', message: key('guardian', 'required') })
    if (relation === null) {
      issues.push({ path: 'guardian_relation', message: key('guardian', 'required') })
    }
    if (guardianPhone === null) {
      issues.push({ path: 'guardian_phone_e164', message: key('guardian', 'required') })
    }
  }
  if (name !== null && (name.length < 2 || name.length > 80 || !NAME.test(name))) {
    issues.push({ path: 'guardian_name', message: key('guardian_name', 'invalid') })
  }

  if ((collapse(values.best_time_to_call)?.length ?? 0) > 80) {
    issues.push({ path: 'best_time_to_call', message: key('best_time_to_call', 'too_long') })
  }
  return issues
}

export const contactsSchema = z
  .custom<ContactsValues>((value) => typeof value === 'object' && value !== null)
  .superRefine((value, ctx) => {
    for (const issue of validateContacts(value)) {
      ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
    }
  })

/** Whether the guardian group starts open (08 section 3.4 rule 3). */
export function guardianGroupOpen(values: ContactsValues): boolean {
  return (
    values.preferred_contact === 'guardian' ||
    GUARDIAN_FIELDS.some((field) => values[field] !== null)
  )
}

/** Whether any contact value was added (the "Contact details" card of `ME-PROFILE`). */
export function hasContactDetails(contacts: ContactsSection): boolean {
  return [
    contacts.phone_e164,
    contacts.whatsapp_e164,
    contacts.contact_email,
    contacts.guardian_name,
    contacts.guardian_phone_e164,
  ].some((value) => value !== null && value !== '')
}

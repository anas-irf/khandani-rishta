import { z } from 'zod'
import { boundedInt, boundedText } from './forms'

/**
 * Client-side validation of the admin forms, mirroring the limits of 18. The server stays the
 * authority: its `validation_failed` answer is always shown (17 section 8).
 */

/** `reason` of a profile change request: 10 to 500 characters (18 section 4.1). */
export const requestChangesSchema = z.object({ reason: boundedText(10, 500) })

/** `reason` of a sanction: 3 to 500 characters (18 section 5.3). */
export const sanctionReasonSchema = boundedText(3, 500)

export const warnSchema = z.object({ reason: sanctionReasonSchema })
export const suspendSchema = z.object({ reason: sanctionReasonSchema, days: boundedInt(1, 365) })
export const banSchema = z.object({ reason: sanctionReasonSchema })

/** `note` of a report resolution: 10 to 1,000 characters (18 section 4.5). */
export const resolveReportSchema = z.object({
  outcome: z.enum(['actioned', 'dismissed'], { error: 'required' }),
  note: boundedText(10, 1000),
})

/** `note` of a text rejection: up to 300 characters, shown to the member (18 section 4.3). */
export const textRejectSchema = z.object({ note: boundedText(0, 300) })

export const verificationRejectSchema = z.object({
  reason: z.string().min(1, { error: 'required' }),
  note: boundedText(0, 1000),
})

/** Staff-only reason of a locked-field correction: 10 to 500 characters (18 section 5.4). */
export const lockedFieldsSchema = z.object({
  first_name: boundedText(0, 100),
  last_name: boundedText(0, 100),
  gender: z.enum(['', 'male', 'female']),
  date_of_birth: z.string().refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: 'invalid',
  }),
  reason: boundedText(10, 500),
})

/** Caste codes (18 section 6.1). */
export const CASTE_CODE_PATTERN = /^[a-z][a-z0-9_]*$/

const casteCode = z
  .string()
  .trim()
  .refine((value) => value.length > 0, { message: 'required' })
  .refine((value) => value.length === 0 || CASTE_CODE_PATTERN.test(value), {
    message: 'invalid_code',
  })

const casteBase = {
  code: casteCode,
  name: boundedText(1, 100),
  name_ur: boundedText(0, 100),
  parent_code: z.string(),
}

function parentPrefixRule(
  value: { code: string; parent_code: string },
  context: z.RefinementCtx,
): void {
  if (value.parent_code && !value.code.startsWith(`${value.parent_code}_`)) {
    context.addIssue({
      code: 'custom',
      path: ['code'],
      message: `code_needs_parent_prefix:${value.parent_code}_`,
    })
  }
}

export const promoteSuggestionSchema = z.object(casteBase).superRefine(parentPrefixRule)

export const createCasteSchema = z
  .object({
    ...casteBase,
    aliases: z.string(),
    sort_order: boundedInt(0, 100000).optional(),
  })
  .superRefine(parentPrefixRule)

export const editCasteSchema = z.object({
  name: boundedText(1, 100),
  name_ur: boundedText(0, 100),
  aliases: z.string(),
  sort_order: boundedInt(0, 100000),
  is_active: z.boolean(),
})

/** Release form (18 section 7.2). */
export const RELEASE_URL_PREFIX = 'https://download.'

export const releaseSchema = z
  .object({
    version_code: boundedInt(1, 2_000_000_000),
    version_name: boundedText(1, 40),
    min_supported_version_code: boundedInt(1, 2_000_000_000),
    download_url: z
      .string()
      .trim()
      .refine((value) => value.startsWith(RELEASE_URL_PREFIX), {
        message: `url_prefix:${RELEASE_URL_PREFIX}`,
      }),
    release_notes: boundedText(0, 1000),
  })
  .superRefine((value, context) => {
    if (value.min_supported_version_code > value.version_code) {
      context.addIssue({
        code: 'custom',
        path: ['min_supported_version_code'],
        message: 'min_above_version',
      })
    }
  })

/** Announcement form (18 section 7.3). */
export const announcementSchema = z.object({
  text_en: boundedText(1, 300),
  text_ur: boundedText(0, 300),
  url: z
    .string()
    .trim()
    .refine((value) => value === '' || value.startsWith('https://'), {
      message: 'url_prefix:https://',
    }),
})

import { z } from 'zod'
import { AUDIT_TARGET_TYPES } from '~/lib/api-enums'

/**
 * List filters of the admin routes, used as `validateSearch` (17 section 3) and parsed again by
 * the screens. A bad value in the URL falls back to the default instead of failing.
 */

export const PROFILE_STATUSES = [
  'pending_review',
  'changes_requested',
  'active',
  'paused',
  'closed',
  'suspended',
  'draft',
] as const

export const PHOTO_STATUSES = ['pending_review', 'approved'] as const
export const VERIFICATION_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const
export const REPORT_STATUSES = ['open', 'in_review', 'actioned', 'dismissed'] as const
export const USER_STATUSES = ['active', 'suspended', 'banned', 'deletion_scheduled'] as const
export const USER_ROLES = ['member', 'moderator', 'admin'] as const

const optionalText = z.string().optional().catch(undefined)

export const profilesSearch = z.object({
  status: z.enum(PROFILE_STATUSES).default('pending_review').catch('pending_review'),
  q: optionalText,
})

export const photosSearch = z.object({
  status: z.enum(PHOTO_STATUSES).default('pending_review').catch('pending_review'),
})

export const verificationsSearch = z.object({
  status: z.enum(VERIFICATION_STATUSES).default('pending').catch('pending'),
  kind: z.enum(['id_document', 'selfie']).optional().catch(undefined),
})

export const reportsSearch = z.object({
  status: z.enum(REPORT_STATUSES).default('open').catch('open'),
})

export const usersSearch = z.object({
  q: optionalText,
  status: z.enum(USER_STATUSES).optional().catch(undefined),
  role: z.enum(USER_ROLES).optional().catch(undefined),
  /** The page of the users list, from 1. Missing or invalid means the first page. */
  page: z.coerce.number().int().min(1).optional().catch(undefined),
})

export const castesSearch = z.object({
  tab: z.enum(['suggestions', 'castes']).default('suggestions').catch('suggestions'),
})

export const auditSearch = z.object({
  actor_user_id: optionalText,
  action: optionalText,
  target_type: z.enum(AUDIT_TARGET_TYPES).optional().catch(undefined),
  target_id: optionalText,
})

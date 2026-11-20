import type { components } from '@khandani/api-contract'

type Schemas = components['schemas']

/**
 * Run-time lists of the contract's enumerations, for the places where a code picked from a
 * reference option list (typed as a plain string) goes into a request body. Each list is
 * checked against the generated type: a missing member fails to compile.
 */
function enumValues<T extends string>() {
  return <const V extends readonly T[]>(
    values: V &
      ([Exclude<T, V[number]>] extends [never] ? unknown : { missing: Exclude<T, V[number]> }),
  ): V => values
}

/** Whether `value` is one of `values`, narrowing it to their type. */
export function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value)
}

/** The `target_type` values of the audit log (18 section 8.3, 04 section 9.4). */
export const AUDIT_TARGET_TYPES = enumValues<Schemas['AuditTargetType']>()([
  'profile',
  'photo',
  'verification_request',
  'report',
  'user',
  'caste',
  'caste_suggestion',
  'app_setting',
  'app_release',
])

export const BEARDS = enumValues<Schemas['Beard']>()(['full', 'trimmed', 'none'])

export const CHILDREN_ACCEPTANCES = enumValues<Schemas['ChildrenAcceptance']>()([
  'any',
  'not_living_with_partner',
  'none',
])

export const EMAIL_MATCH_DIGESTS = enumValues<Schemas['EmailMatchDigest']>()([
  'off',
  'daily',
  'weekly',
])

export const EMPLOYMENT_TYPES = enumValues<Schemas['EmploymentType']>()([
  'private_job',
  'government_job',
  'armed_forces',
  'business_owner',
  'self_employed',
  'student',
  'homemaker',
  'not_working',
  'retired',
])

export const FAMILY_TYPES = enumValues<Schemas['FamilyType']>()(['joint', 'nuclear'])

export const FAMILY_VALUES = enumValues<Schemas['FamilyValues']>()([
  'religious',
  'traditional',
  'moderate',
  'liberal',
])

export const HIJABS = enumValues<Schemas['Hijab']>()([
  'niqab',
  'hijab',
  'dupatta',
  'occasionally',
  'none',
])

export const LIVING_ARRANGEMENTS = enumValues<Schemas['LivingArrangement']>()([
  'with_family',
  'separate',
  'flexible',
])

export const MANAGED_BY = enumValues<Schemas['ManagedBy']>()([
  'self',
  'parent',
  'sibling',
  'relative',
  'friend',
])

export const MARITAL_STATUSES = enumValues<Schemas['MaritalStatus']>()([
  'never_married',
  'divorced',
  'widowed',
  'separated',
  'nikah_ended_before_rukhsati',
  'married',
])

export const RELIGIOSITY_LEVELS = enumValues<Schemas['Religiosity']>()([
  'very_practising',
  'practising',
  'moderately_practising',
  'not_practising',
])

export const REPORT_REASONS = enumValues<Schemas['ReportReason']>()([
  'fake_profile',
  'already_married',
  'misleading_information',
  'inappropriate_photo',
  'harassment',
  'asking_for_money',
  'marriage_bureau_or_agent',
  'underage',
  'impersonation',
  'offensive_content',
  'other',
])

export const PHOTO_REJECTION_REASONS = enumValues<Schemas['PhotoRejectionReason']>()([
  'not_a_person',
  'face_not_visible',
  'group_photo',
  'inappropriate',
  'contains_contact_info',
  'low_quality',
  'not_the_candidate',
  'other',
])

export const SMOKING_OPTIONS = enumValues<Schemas['Smoking']>()(['no', 'occasionally', 'yes'])

export const USER_ROLES = enumValues<Schemas['UserRole']>()(['member', 'moderator', 'admin'])

export const VERIFICATION_REJECTION_REASONS = enumValues<Schemas['VerificationRejectionReason']>()([
  'unreadable',
  'document_mismatch',
  'expired_document',
  'face_mismatch',
  'gesture_missing',
  'underage',
  'suspected_fraud',
  'other',
])

export const WORK_AFTER_MARRIAGE_OPTIONS = enumValues<Schemas['WorkAfterMarriage']>()([
  'yes',
  'no',
  'flexible',
])

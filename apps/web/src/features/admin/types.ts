import type { components, operations } from '@khandani/api-contract'

/**
 * Request and response types of the admin routes (15 section 16, 18). Every type is an alias of
 * the OpenAPI contract generated from the API (`packages/api-contract`), under the name the
 * admin screens import. Regenerate with `pnpm generate:api-client` after the contract changes.
 */

type Schemas = components['schemas']

/** The roles that may open the staff console. */
export type StaffRole = Exclude<Schemas['UserRole'], 'member'>

export type AdminTextField = Schemas['ModeratedField']
export type AuditTargetType = Schemas['AuditTargetType']

// ---------------------------------------------------------------------------
// 4.1 Profiles
// ---------------------------------------------------------------------------

export type AdminProfileListItem = Schemas['AdminProfileListItem']
export type AuditEntry = Schemas['AuditEntry']
/** `profile` is `OwnProfile` with `contacts` `null` for moderators (`AdminOwnProfile`). */
export type AdminProfile = Schemas['AdminProfile']
export type RequestChangesBody = Schemas['RequestChangesBody']
export type LockedFieldsBody = Schemas['LockedFieldsBody']

// ---------------------------------------------------------------------------
// 4.2 Photos
// ---------------------------------------------------------------------------

export type AdminPhotoItem = Schemas['AdminPhotoItem']
export type PhotoStatus = Schemas['PhotoStatus']
export type PhotoRejectionReason = Schemas['PhotoRejectionReason']

// ---------------------------------------------------------------------------
// 4.3 Texts
// ---------------------------------------------------------------------------

export type AdminTextItem = Schemas['AdminTextItem']
export type TextRejectBody = Schemas['RejectText']

// ---------------------------------------------------------------------------
// 4.4 Verifications
// ---------------------------------------------------------------------------

export type AdminVerificationKind = Schemas['VerificationKind']
export type VerificationStatus = Schemas['VerificationStatus']
export type VerificationRejectionReason = Schemas['VerificationRejectionReason']
export type AdminVerificationListItem = Schemas['AdminVerificationListItem']
export type AdminVerificationDetail = Schemas['AdminVerificationDetail']
export type VerificationApproveBody = Schemas['ApproveVerification']
export type VerificationRejectBody = Schemas['RejectVerification']

// ---------------------------------------------------------------------------
// 4.5 Reports
// ---------------------------------------------------------------------------

export type AdminReportListItem = Schemas['AdminReportListItem']
export type ReportReason = Schemas['ReportReason']
export type ReportSource = Schemas['ReportSource']
export type ReportStatus = Schemas['ReportStatus']
export type AdminReportDetail = Schemas['AdminReportDetail']
export type ReportOutcome = Schemas['Outcome']
export type ReportResolveBody = Schemas['ResolveBody']

/**
 * One message of the `context` of a message report (13 section 6.3). Not part of the contract:
 * `context` is the JSON snapshot stored when the report was filed, whose shape depends on the
 * subject, so the contract types it as a free-form object and the screen checks each message.
 */
export type ReportContextMessage = {
  id: string
  sender: 'reporter' | 'target' | 'system'
  body: string | null
  safety_flag?: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// 5. Users
// ---------------------------------------------------------------------------

export type AdminUserListItem = Schemas['AdminUserListItem']
export type AdminUser = Schemas['AdminUser']
export type WarnBody = Schemas['WarnBody']
export type SuspendBody = Schemas['SuspendBody']
export type BanBody = Schemas['BanBody']
export type RoleBody = Schemas['RoleBody']

// ---------------------------------------------------------------------------
// 6. Castes
// ---------------------------------------------------------------------------

export type CasteSuggestionItem = Schemas['CasteSuggestionItem']
export type PromoteSuggestionBody = Schemas['PromoteBody']
export type AdminCaste = Schemas['AdminCaste']
export type CreateCasteBody = Schemas['CreateCasteBody']
export type UpdateCasteBody = Schemas['PatchCasteBody']

// ---------------------------------------------------------------------------
// 7. Settings, releases, announcements
// ---------------------------------------------------------------------------

/** `value` and `default` are any JSON value, whose type depends on the key (18 section 7.1). */
export type AdminSetting = Schemas['SettingItem']
export type AdminRelease = Schemas['AdminRelease']
export type CreateReleaseBody = Schemas['CreateReleaseBody']
export type AnnouncementBody = Schemas['AnnouncementBody']

// ---------------------------------------------------------------------------
// 8. Audit log
// ---------------------------------------------------------------------------

/** The filters of `GET /v1/admin/audit-log`, without the paging parameters. */
export type AuditFilters = Omit<
  NonNullable<operations['list_audit_log']['parameters']['query']>,
  'limit' | 'cursor'
>

// ---------------------------------------------------------------------------
// 9. Overview
// ---------------------------------------------------------------------------

export type AdminOverview = Schemas['AdminOverview']

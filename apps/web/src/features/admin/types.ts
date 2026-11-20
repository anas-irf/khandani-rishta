import type { ContactsSection, Gender, OwnProfile, Preferences, Privacy } from '~/lib/api-types'

/**
 * Request and response types of the admin routes, transcribed from specs/18-admin-console.md
 * (15 section 16 lists the routes). Field names must stay exactly as in the specification.
 * Shapes that 18 does not define (marked below) are the smallest ones the screens need.
 */

export type StaffRole = 'moderator' | 'admin'

export type AdminTextField = 'about_me' | 'about_family' | 'partner_notes'

// ---------------------------------------------------------------------------
// 4.1 Profiles
// ---------------------------------------------------------------------------

export type AdminProfileListItem = {
  profile_id: string
  user_id: string
  public_code: string
  status: string
  first_name: string | null
  last_name: string | null
  gender: Gender | null
  age: number | null
  city_name: string | null
  managed_by: string | null
  onboarding_completed_at: string | null
  /** First photo of any status, unblurred. */
  photo_thumb_url: string | null
  open_system_reports: number
  created_at: string
}

export type AuditEntry = {
  id: string
  actor: { user_id: string; email: string | null }
  action: string
  target_type: string
  target_id: string
  details: Record<string, unknown>
  created_at: string
}

export type AdminSanction = {
  id: string
  type: string
  reason: string
  starts_at: string
  ends_at: string | null
  revoked_at: string | null
  created_by_email: string | null
}

export type AdminProfile = {
  user: {
    id: string
    email: string | null
    email_verified: boolean
    /** null for moderators. */
    phone_e164: string | null
    role: string
    status: string
    status_reason: string | null
    suspended_until: string | null
    created_at: string
    last_seen_at: string | null
  }
  /** 15 section 4.3. `contacts` is null for moderators. */
  profile: Omit<OwnProfile, 'contacts'> & { contacts: ContactsSection | null }
  preferences: Preferences | null
  privacy: Privacy
  first_activated_at: string | null
  last_active_at: string | null
  stats: {
    interests_sent: number
    interests_received: number
    /** Sent interests that were accepted. */
    interests_accepted_by_others: number
    active_connections: number
    connections_ended_by_others: number
    /** Messages with safety_flag = 'money' sent in 30 days. */
    money_flags_30d: number
    blocks_received: number
  }
  /** Newest 10. */
  reports_against: AdminReportListItem[]
  reports_filed: { total: number; actioned: number; dismissed: number }
  sanctions: AdminSanction[]
  verification_requests: {
    id: string
    kind: string
    status: string
    rejection_reason: string | null
    created_at: string
    reviewed_at: string | null
  }[]
  /** Newest 20 entries whose target is this profile or its user. */
  audit: AuditEntry[]
}

export type RequestChangesBody = { reason: string }

export type LockedFieldsBody = {
  first_name?: string
  last_name?: string
  gender?: Gender
  date_of_birth?: string
  reason: string
}

// ---------------------------------------------------------------------------
// 4.2 Photos
// ---------------------------------------------------------------------------

export type AdminPhotoItem = {
  photo_id: string
  profile_id: string
  public_code: string
  first_name: string | null
  gender: Gender | null
  age: number | null
  status: string
  created_at: string
  /** Unblurred, signed. */
  large_url: string
  /** profile_photos.moderation (13 section 4.2). */
  moderation: Record<string, unknown> | null
  /** The profile has no approved photo yet. */
  would_be_primary: boolean
  profile_is_photo_verified: boolean
  other_photos: { photo_id: string; status: string; is_primary: boolean; medium_url: string }[]
}

// ---------------------------------------------------------------------------
// 4.3 Texts
// ---------------------------------------------------------------------------

export type AdminTextItem = {
  profile_id: string
  public_code: string
  first_name: string | null
  gender: Gender | null
  field: AdminTextField
  text: string
  /** Hex; must be sent back with the decision. */
  text_sha256: string
  updated_at: string
}

export type TextRejectBody = { text_sha256: string; note?: string }

// ---------------------------------------------------------------------------
// 4.4 Verifications
// ---------------------------------------------------------------------------

export type AdminVerificationKind = 'id_document' | 'selfie'

export type AdminVerificationListItem = {
  request_id: string
  kind: AdminVerificationKind
  status: string
  profile_id: string
  public_code: string
  first_name: string | null
  created_at: string
}

export type AdminVerificationDetail = {
  request_id: string
  kind: AdminVerificationKind
  status: string
  gesture: string
  /** The gesture equals the challenge of the submission day or the day before. */
  gesture_valid: boolean
  created_at: string
  images: {
    /** Signed, valid 10 minutes; null when not provided or already purged. */
    front_url: string | null
    back_url: string | null
    selfie_url: string | null
  }
  media_purged: boolean
  /** null for kind = 'selfie'. */
  identity: {
    document_type: string
    /** Decrypted, formatted #####-#######-# for 13-digit types. */
    number: string
    status: string
  } | null
  profile: {
    profile_id: string
    public_code: string
    first_name: string | null
    last_name: string | null
    gender: Gender | null
    date_of_birth: string | null
    age: number | null
    marital_status: string | null
    managed_by: string | null
    manager_name: string | null
    /** Approved photos. */
    photos: { photo_id: string; status: string; is_primary: boolean; large_url: string }[]
  }
  previous_requests: {
    id: string
    kind: string
    status: string
    rejection_reason: string | null
    created_at: string
  }[]
}

export type VerificationApproveBody = { photos_match?: boolean }
export type VerificationRejectBody = { reason: string; note?: string }

// ---------------------------------------------------------------------------
// 4.5 Reports
// ---------------------------------------------------------------------------

export type AdminReportListItem = {
  report_id: string
  source: 'member' | 'system'
  priority: 1 | 2 | 3
  reason: string
  subject_type: 'profile' | 'photo' | 'message'
  status: string
  target: { profile_id: string; user_id: string; public_code: string; first_name: string | null }
  reporter: { profile_id: string; public_code: string; first_name: string | null } | null
  open_reports_on_target: number
  handled_by_email: string | null
  created_at: string
}

export type AdminReportDetail = AdminReportListItem & {
  details: string | null
  /** 13 section 6.3 and 5.5. */
  context: Record<string, unknown> | null
  /** For subject_type = 'photo'. */
  photo: { photo_id: string; status: string; large_url: string | null } | null
  resolution_note: string | null
  handled_at: string | null
  target_summary: {
    user_status: string
    profile_status: string
    reports_against_total: number
    reports_against_actioned: number
    sanctions: {
      type: string
      reason: string
      starts_at: string
      ends_at: string | null
      revoked_at: string | null
    }[]
    is_id_verified: boolean
    is_photo_verified: boolean
  }
  reporter_summary: { filed: number; actioned: number; dismissed: number } | null
  /** Other open or in-review reports on the same target. */
  related_reports: AdminReportListItem[]
}

export type ReportOutcome = 'actioned' | 'dismissed'
export type ReportResolveBody = { outcome: ReportOutcome; note: string }

/** One message of a message report context (13 section 6.3). */
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

export type AdminUserListItem = {
  user_id: string
  profile_id: string
  public_code: string
  email: string | null
  role: string
  status: string
  profile_status: string
  first_name: string | null
  last_name: string | null
  gender: Gender | null
  created_at: string
  last_seen_at: string | null
}

export type AdminUser = AdminUserListItem & {
  email_verified: boolean
  /** null for moderators. */
  phone_e164: string | null
  phone_verified: boolean
  status_reason: string | null
  suspended_until: string | null
  deletion_requested_at: string | null
  purge_after: string | null
  locale: string
  devices: {
    platform: string
    app_version: string | null
    device_model: string | null
    last_seen_at: string
  }[]
  consents: { document: string; version: string; accepted_at: string }[]
  sanctions: {
    id: string
    type: string
    reason: string
    report_id: string | null
    starts_at: string
    ends_at: string | null
    created_by_email: string | null
    revoked_at: string | null
    revoked_by_email: string | null
  }[]
  /** Newest 20. */
  reports_against: AdminReportListItem[]
  reports_filed: { total: number; actioned: number; dismissed: number }
  flags: {
    /** 5 or more dismissed and none actioned in 30 days (13 section 6.6). */
    reporter_misuse: boolean
    money_flags_30d: number
    shared_device_with_sanctioned_user: boolean
  }
  /** Newest 50 entries whose target is this user or their profile. */
  audit: AuditEntry[]
}

export type WarnBody = { reason: string; report_id?: string }
export type SuspendBody = { reason: string; days: number; report_id?: string }
export type BanBody = { reason: string; report_id?: string }
export type RoleBody = { role: 'member' | 'moderator' | 'admin' }

// ---------------------------------------------------------------------------
// 6. Castes
// ---------------------------------------------------------------------------

export type CasteSuggestionItem = {
  id: string
  name: string
  normalized_name: string
  parent_code: string | null
  parent_name: string | null
  usage_count: number
  status: 'pending' | 'promoted' | 'rejected'
  /** Existing castes whose name or alias is close (trigram similarity of 0.4 or more). */
  similar: { code: string; name: string }[]
  created_at: string
}

export type PromoteSuggestionBody = {
  code: string
  name: string
  name_ur?: string
  parent_code?: string
}

/**
 * One row of `GET /v1/admin/castes` (15 section 16: all castes and sub-castes, including
 * inactive ones, with `sort_order` and `is_active`). 18 does not define the shape; it follows
 * the `castes` table (05 section 13).
 */
export type AdminCaste = {
  code: string
  name: string
  name_ur: string | null
  parent_code: string | null
  aliases: string[]
  sort_order: number
  is_active: boolean
}

export type CreateCasteBody = {
  code: string
  name: string
  name_ur?: string
  parent_code?: string
  aliases?: string[]
  sort_order?: number
}

export type UpdateCasteBody = {
  name?: string
  name_ur?: string | null
  aliases?: string[]
  sort_order?: number
  is_active?: boolean
}

// ---------------------------------------------------------------------------
// 7. Settings, releases, announcements
// ---------------------------------------------------------------------------

export type SettingValue = unknown

export type AdminSetting = {
  key: string
  value: SettingValue
  default: SettingValue
  updated_by_email: string | null
  updated_at: string | null
}

export type AnnouncementBanner = { text_en: string; text_ur?: string; url?: string }

/** A row of `app_releases`; 18 section 7.2 lists the fields of the create body. */
export type AdminRelease = {
  id: string
  platform: 'android'
  version_code: number
  version_name: string
  min_supported_version_code: number
  download_url: string
  release_notes: string | null
  created_at: string
}

export type CreateReleaseBody = {
  platform: 'android'
  version_code: number
  version_name: string
  min_supported_version_code: number
  download_url: string
  release_notes?: string
}

export type AnnouncementBody = { text_en: string; text_ur?: string; url?: string }
export type AnnouncementResult = { recipients_estimate: number }

// ---------------------------------------------------------------------------
// 8. Audit log
// ---------------------------------------------------------------------------

export type AuditFilters = {
  actor_user_id?: string
  target_type?: string
  target_id?: string
  action?: string
}

// ---------------------------------------------------------------------------
// 9. Overview
// ---------------------------------------------------------------------------

export type AdminOverview = {
  generated_at: string
  queues: {
    profiles_pending: number
    photos_pending: number
    /** Subset of photos_pending whose automatic result is 'flag'. */
    photos_flagged: number
    texts_pending: number
    verifications_pending: number
    reports_open: number
    reports_in_review: number
    caste_suggestions_pending: number
    /** Created time of the longest-waiting item, null when the queue is empty. */
    oldest_waiting: {
      profiles: string | null
      photos: string | null
      verifications: string | null
      reports: string | null
    }
  }
  metrics: {
    users_total: number
    signups_today: number
    signups_7d: number
    profiles_by_status: {
      draft: number
      pending_review: number
      changes_requested: number
      active: number
      paused: number
      closed: number
      suspended: number
    }
    active_male: number
    active_female: number
    active_id_verified: number
    active_photo_verified: number
    /** Active profiles with last_active_at in the last 7 days. */
    active_last_7d: number
    interests_sent_today: number
    interests_sent_7d: number
    interests_accepted_7d: number
    connections_active: number
    connections_created_7d: number
    stage_counts: {
      chatting: number
      families_talking: number
      engaged: number
      nikah_done: number
    }
    messages_7d: number
    reports_filed_7d: number
    users_suspended: number
    users_banned: number
    deletions_scheduled: number
    jobs_dead: number
  }
}

/**
 * Request and response types of the Khandani Rishta API, as defined in
 * specs/15-api-contract.md sections 4 to 14.
 *
 * `packages/api-contract/openapi.json` does not describe these routes yet: the API only
 * exposes its health and meta routes so far. Until it does, these types are the single
 * place the web app takes its API shapes from. Once the API publishes the routes, run
 * `pnpm generate:api-client` and replace each type here with a re-export from
 * `components['schemas']` of `@khandani/api-contract`. Field names must stay exactly as in
 * the contract so that swap is mechanical.
 */

// ---------------------------------------------------------------------------
// 4.1 Small types
// ---------------------------------------------------------------------------

export type Gate =
  | 'banned'
  | 'suspended'
  | 'deletion_scheduled'
  | 'consent_required'
  | 'onboarding'
  | 'changes_requested'
  | 'pending_review'
  | 'ok'

export type ConsentDocument =
  | 'terms'
  | 'privacy'
  | 'community_guidelines'
  | 'age_declaration'
  | 'candidate_consent'

export type Badge = 'phone_verified' | 'photo_verified' | 'id_verified' | 'new'
export type LastActive = 'online' | 'today' | 'this_week' | 'this_month' | 'earlier'
export type Importance = 'must' | 'high' | 'medium' | 'low'
export type Tier = 'self' | 'connection' | 'interest_from_owner' | 'interest_to_owner' | 'member'
export type TextStatus = 'approved' | 'pending' | 'rejected'
export type Gender = 'male' | 'female'
export type ManagedBy = 'self' | 'parent' | 'sibling' | 'relative' | 'friend'

/** Groups of fields that privacy settings can hide (09 section 5). */
export type LockedGroup =
  | 'full_name'
  | 'photos'
  | 'caste'
  | 'income'
  | 'family'
  | 'career_details'
  | 'home'
  | 'area'
  | 'health'

export type CityRef = {
  id: number
  name: string
  region_id: number | null
  region_name: string | null
  country_code: string
}

/** A page of a cursor-paginated list (15 section 1). */
export type Page<T> = {
  items: T[]
  next_cursor: string | null
}

// ---------------------------------------------------------------------------
// 4.2 Me
// ---------------------------------------------------------------------------

export type UserRole = 'member' | 'moderator' | 'admin'
export type UserStatus = 'active' | 'suspended' | 'banned' | 'deletion_scheduled'
export type ProfileStatus =
  | 'draft'
  | 'pending_review'
  | 'changes_requested'
  | 'active'
  | 'paused'
  | 'closed'
  | 'suspended'

export type Locale = 'en' | 'ur'

export type Announcement = { text_en: string; text_ur: string | null; url: string | null }

export type Counters = {
  /** Connections with unread messages. */
  unread_chats: number
  /** Received, pending. */
  pending_interests: number
  /** Received, pending. */
  pending_photo_requests: number
  unread_notifications: number
}

export type Me = {
  user: {
    id: string
    email: string | null
    email_verified: boolean
    phone_e164: string | null
    phone_verified: boolean
    role: UserRole
    status: UserStatus
    status_reason: string | null
    suspended_until: string | null
    purge_after: string | null
    locale: Locale
    timezone: string
    created_at: string
  }
  profile: {
    id: string
    public_code: string
    status: ProfileStatus
    status_reason: string | null
    /** See 03 section 4.3. */
    onboarding_step: string
    first_name: string | null
    gender: Gender | null
    managed_by: ManagedBy | null
    /** Primary photo, if any. */
    photo: OwnPhoto | null
    /** 0..100 */
    completeness: number
    badges: Badge[]
  }
  gate: Gate
  consents_required: ConsentDocument[]
  counters: Counters
  usage: {
    interests_sent_today: number
    /** The limit that applies to this profile. */
    interests_per_day: number
  }
  config: {
    identity_required: boolean
    photo_required: boolean
    photos_max: number
    legal: { terms_version: string; privacy_version: string; guidelines_version: string }
    support_email: string
    /** account.deletion_grace_days, for the text of the delete dialog. */
    deletion_grace_days: number
    announcement: Announcement | null
  }
}

export type PatchMeBody = { locale?: Locale; timezone?: string }
export type ConsentsBody = { documents: ConsentDocument[] }
export type DeletionBody = { reason?: string; confirm: 'DELETE' }

export type DataExport = {
  status: 'queued' | 'ready' | 'failed' | 'expired'
  download_url: string | null
  expires_at: string | null
}

// ---------------------------------------------------------------------------
// 4.3 Own profile
// ---------------------------------------------------------------------------

export type ProfileSectionKey =
  | 'account_for'
  | 'basics'
  | 'community'
  | 'location'
  | 'education_career'
  | 'family'
  | 'lifestyle'
  | 'contacts'

export type AccountForSection = {
  managed_by: ManagedBy | null
  manager_name: string | null
}

/** `account_for` additionally accepts the consents to record (15 section 7). */
export type AccountForBody = AccountForSection & { consents?: ConsentDocument[] }

export type BasicsSection = {
  first_name: string | null
  last_name: string | null
  gender: Gender | null
  date_of_birth: string | null
  marital_status: string | null
  children_status: string | null
  children_count: number | null
  current_wives_count: number | null
  height_cm: number | null
}

export type CommunitySection = {
  religion_code: string | null
  sect_code: string | null
  caste_code: string | null
  caste_other: string | null
  sub_caste_code: string | null
  sub_caste_other: string | null
  mother_tongue_code: string | null
  /** Languages besides the mother tongue. */
  language_codes: string[]
}

export type LocationSection = {
  nationality_code: string | null
  country_code: string | null
  region_id: number | null
  city_id: number | null
  city_other: string | null
  area: string | null
  residency_status: string | null
  origin_city_id: number | null
  origin_other: string | null
  relocation: string | null
}

export type EducationCareerSection = {
  education_level_code: string | null
  education_field_code: string | null
  degree_title: string | null
  institute_name: string | null
  employment_type: string | null
  profession_code: string | null
  job_title: string | null
  employer_name: string | null
  income_band_code: string | null
}

export type FamilySection = {
  father_status: string | null
  father_occupation: string | null
  mother_status: string | null
  mother_occupation: string | null
  brothers_count: number | null
  brothers_married: number | null
  sisters_count: number | null
  sisters_married: number | null
  family_type: string | null
  family_class: string | null
  family_values: string | null
  family_country_code: string | null
  family_city_id: number | null
  home_ownership: string | null
  home_type: string | null
  home_size_value: number | null
  home_size_unit: string | null
  about_family: string | null
}

export type LifestyleSection = {
  religiosity: string | null
  prayer_frequency: string | null
  /** Female profiles only. */
  hijab: string | null
  /** Male profiles only. */
  beard: string | null
  religious_education: string | null
  smoking: string | null
  living_arrangement: string | null
  work_after_marriage: string | null
  marriage_timeline: string | null
  jahez_stance: string | null
  weight_kg: number | null
  complexion: string | null
  body_type: string | null
  blood_group: string | null
  disability: string | null
  disability_details: string | null
  hobby_codes: string[]
  about_me: string | null
}

export type ContactsSection = {
  phone_e164: string | null
  whatsapp_e164: string | null
  contact_email: string | null
  guardian_name: string | null
  guardian_relation: string | null
  guardian_phone_e164: string | null
  preferred_contact: 'self' | 'guardian'
  best_time_to_call: string | null
}

/** The body of `PUT /v1/me/profile/sections/{section}` for each section. */
export type SectionBodies = {
  account_for: AccountForBody
  basics: BasicsSection
  community: CommunitySection
  location: LocationSection
  education_career: EducationCareerSection
  family: FamilySection
  lifestyle: LifestyleSection
  contacts: ContactsSection
}

export type IdentityDocumentType = 'cnic' | 'nicop' | 'poc' | 'passport'
export type IdentityStatus = 'unverified' | 'pending' | 'verified' | 'rejected'

export type IdentitySummary = {
  document_type: IdentityDocumentType
  /** For example "*********1234". */
  number_masked: string
  status: IdentityStatus
  verified_at: string | null
}

export type OwnProfile = {
  id: string
  public_code: string
  status: ProfileStatus
  status_reason: string | null
  onboarding_step: string
  completeness: number
  /** Completeness item keys not yet met, most valuable first (08 section 6.2). */
  missing: string[]
  /** Fields the owner can no longer edit (03 section 8 rule 15). */
  locked_fields: string[]
  account_for: AccountForSection
  basics: BasicsSection
  community: CommunitySection
  location: LocationSection & { city: CityRef | null; origin_city: CityRef | null }
  education_career: EducationCareerSection
  family: FamilySection
  lifestyle: LifestyleSection
  contacts: ContactsSection
  photos: OwnPhoto[]
  identity: IdentitySummary | null
  verification: {
    phone_verified: boolean
    photo_verified: boolean
    id_verified: boolean
    pending: { id_document: boolean; selfie: boolean }
  }
  text_status: { about_me: TextStatus; about_family: TextStatus; partner_notes: TextStatus }
}

export type IdentityBody = { document_type: IdentityDocumentType; number: string }

export type CloseReason = 'found_match_here' | 'found_match_elsewhere' | 'taking_a_break' | 'other'

// ---------------------------------------------------------------------------
// 4.4 Photos
// ---------------------------------------------------------------------------

export type OwnPhotoStatus = 'processing' | 'pending_review' | 'approved' | 'rejected' | 'failed'

/** A member's own photo. */
export type OwnPhoto = {
  id: string
  status: OwnPhotoStatus
  rejection_reason: string | null
  is_primary: boolean
  position: number
  /** null while processing */
  thumb_url: string | null
  medium_url: string | null
  large_url: string | null
  created_at: string
}

/** Another member's photo as the viewer is allowed to see it. */
export type PhotoView = {
  id: string
  is_primary: boolean
  is_blurred: boolean
  /** Blurred variant when is_blurred. */
  thumb_url: string
  /** Blurred variant when is_blurred. */
  medium_url: string
  /** null when is_blurred */
  large_url: string | null
}

export type UploadContentType = 'image/jpeg' | 'image/png' | 'image/webp'

export type UploadTicket = {
  upload_key: string
  upload_url: string
  headers: { 'Content-Type': string }
  expires_at: string
}

// ---------------------------------------------------------------------------
// 4.5 Preferences and privacy
// ---------------------------------------------------------------------------

export type ChildrenAcceptance = 'any' | 'not_living_with_partner' | 'none'

export type Preferences = {
  age_min: number
  age_max: number
  age_importance: Importance
  height_min_cm: number | null
  height_max_cm: number | null
  height_importance: Importance
  marital_statuses: string[]
  marital_status_importance: Importance
  children_acceptance: ChildrenAcceptance
  children_importance: Importance
  religion_codes: string[]
  religion_importance: Importance
  sect_codes: string[]
  sect_importance: Importance
  caste_codes: string[]
  caste_importance: Importance
  mother_tongue_codes: string[]
  mother_tongue_importance: Importance
  country_codes: string[]
  region_ids: number[]
  city_ids: number[]
  location_importance: Importance
  education_min_rank: number | null
  education_importance: Importance
  employment_types: string[]
  profession_codes: string[]
  profession_importance: Importance
  income_min_rank: number | null
  income_importance: Importance
  religiosity_levels: string[]
  religiosity_importance: Importance
  hijab_types: string[]
  beard_types: string[]
  appearance_importance: Importance
  family_values: string[]
  family_types: string[]
  family_importance: Importance
  living_arrangements: string[]
  living_arrangement_importance: Importance
  work_after_marriage_options: string[]
  work_after_marriage_importance: Importance
  smoking_options: string[]
  smoking_importance: Importance
  notes: string | null
}

export type Visibility3 = 'members' | 'connections' | 'nobody'

export type Privacy = {
  discovery_visibility: 'everyone' | 'preference_match' | 'hidden'
  interest_permission: 'everyone' | 'verified_only' | 'preference_match'
  name_display:
    | 'full_name'
    | 'first_name_last_initial'
    | 'first_name_only'
    | 'initials'
    | 'code_only'
  photo_visibility: 'members' | 'interests_and_connections' | 'connections' | 'approved_only'
  caste_visibility: Visibility3
  income_visibility: Visibility3
  family_visibility: Visibility3
  career_details_visibility: Visibility3
  home_visibility: Visibility3
  area_visibility: Visibility3
  health_visibility: Visibility3
  show_last_active: boolean
  show_online_status: boolean
  record_my_visits: boolean
  send_read_receipts: boolean
  allow_photo_requests: boolean
}

// ---------------------------------------------------------------------------
// 4.6 Other members' profiles
// ---------------------------------------------------------------------------

/** Compact form used in every list. */
export type ProfileCard = {
  id: string
  public_code: string
  /** Already reduced according to the owner's name_display. */
  display_name: string
  age: number
  gender: Gender
  managed_by: string
  height_cm: number
  marital_status: string
  religion_code: string
  sect_code: string | null
  /** Caste name or the owner's typed value; null when hidden or not stated. */
  caste_label: string | null
  mother_tongue_code: string
  city_name: string
  region_name: string | null
  country_code: string
  education_level_code: string
  employment_type: string
  profession_code: string | null
  /** Primary photo; null when the profile has no approved photo. */
  photo: PhotoView | null
  photo_count: number
  badges: Badge[]
  /** null when the owner hides it. */
  last_active: LastActive | null
  /** 0..100 */
  compat: number | null
  /** Reason codes, at most 3 (10 section 7). */
  reasons: string[]
  relation: {
    tier: Tier
    interest_status: 'pending' | null
    interest_direction: 'sent' | 'received' | null
    connection_id: string | null
    is_shortlisted: boolean
    /** The same result as Relation.can_send_interest. */
    can_send_interest: boolean
  }
}

export type CannotSendReason =
  | 'already_pending'
  | 'already_connected'
  | 'cooldown'
  | 'daily_limit'
  | 'pending_limit'
  | 'connection_limit'
  | 'not_permitted_by_member'
  | 'own_profile_not_active'

export type PhotoAccessState = 'visible' | 'can_request' | 'requested' | 'denied' | 'requests_off'

export type Relation = {
  tier: Tier
  interest: {
    id: string
    direction: 'sent' | 'received'
    status: 'pending'
    message: string | null
    created_at: string
    expires_at: string
  } | null
  connection_id: string | null
  is_shortlisted: boolean
  shortlist_note: string | null
  is_passed: boolean
  photo_access: PhotoAccessState
  can_send_interest: boolean
  cannot_send_reason: CannotSendReason | null
  /** Set only with 'not_permitted_by_member' (09 section 7). */
  cannot_send_detail: 'verified_only' | 'preference_match' | null
  /** Date, for 'cooldown'. */
  can_send_interest_after: string | null
}

/** What the owner is looking for, as display lines, each marked with whether the viewer fits. */
export type LookingFor = {
  lines: {
    /** Dimension key from 10 section 4, for example 'age'. */
    dimension: string
    /** Codes or formatted values, for example ['25', '32'] for an age range. */
    summary_values: string[]
    importance: Importance
    /** null when the viewer's value is unknown. */
    viewer_matches: boolean | null
  }[]
  /** Lines where viewer_matches is true. */
  matched: number
  /** Lines where viewer_matches is not null. */
  total: number
}

export type Compatibility = {
  /** 0..100 */
  compat: number
  reasons: string[]
  /** 0..100: how well the owner fits the viewer's preferences. */
  viewer_fit: number
  /** 0..100: how well the viewer fits the owner's preferences. */
  owner_fit: number
  dimensions: {
    dimension: string
    /** The viewer's importance for it. */
    importance: Importance
    /** 0..1, how well the owner satisfies the viewer on it. */
    score: number
    matched: boolean
  }[]
}

/** Full form used on the profile screen. A hidden value is null. */
export type ProfileDetail = {
  card: ProfileCard
  is_online: boolean | null
  photos: PhotoView[]
  basics: {
    marital_status: string
    children_status: string | null
    children_count: number | null
    current_wives_count: number | null
    height_cm: number
    weight_kg: number | null
    complexion: string | null
    body_type: string | null
  }
  community: {
    religion_code: string
    sect_code: string | null
    caste_label: string | null
    sub_caste_label: string | null
    mother_tongue_code: string
    language_codes: string[]
  }
  location: {
    country_code: string
    region_name: string | null
    city_name: string
    area: string | null
    nationality_code: string | null
    residency_status: string | null
    origin_label: string | null
    relocation: string | null
  }
  education_career: {
    education_level_code: string
    education_field_code: string | null
    degree_title: string | null
    institute_name: string | null
    employment_type: string
    profession_code: string | null
    job_title: string | null
    employer_name: string | null
    income_band_code: string | null
  }
  family:
    | (Omit<FamilySection, 'family_city_id' | 'about_family'> & {
        family_city_name: string | null
      })
    | null
  lifestyle: Omit<LifestyleSection, 'weight_kg' | 'complexion' | 'body_type' | 'about_me'>
  about_me: string | null
  about_family: string | null
  partner_notes: string | null
  looking_for: LookingFor
  /** null only in the owner's own preview. */
  compatibility: Compatibility | null
  locked: LockedGroup[]
  relation: Relation
}

// ---------------------------------------------------------------------------
// 4.7 Interests, connections, messages
// ---------------------------------------------------------------------------

export type InterestStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired'
export type InterestDisplayStatus =
  | 'pending'
  | 'accepted'
  | 'no_response'
  | 'closed'
  | 'withdrawn'
  | 'declined'

export type Interest = {
  id: string
  direction: 'sent' | 'received'
  status: InterestStatus
  display_status: InterestDisplayStatus
  message: string | null
  compat_score: number | null
  seen: boolean
  created_at: string
  responded_at: string | null
  expires_at: string
  connection_id: string | null
  /** The other profile; null when it is no longer visible to the caller. */
  profile: ProfileCard | null
}

export type Stage = 'chatting' | 'families_talking' | 'engaged' | 'nikah_done'

export type ContactShare = {
  share_phone: boolean
  share_whatsapp: boolean
  share_email: boolean
  share_guardian: boolean
  status: 'active' | 'revoked'
  created_at: string
}

export type SharedContact = {
  phone_e164: string | null
  whatsapp_e164: string | null
  contact_email: string | null
  guardian: { name: string | null; relation: string | null; phone_e164: string | null } | null
  preferred_contact: 'self' | 'guardian'
  best_time_to_call: string | null
}

export type Connection = {
  id: string
  status: 'active' | 'ended'
  stage: Stage
  pending_stage_proposal: {
    id: string
    stage: string
    proposed_by: 'me' | 'them'
    created_at: string
  } | null
  /** Returned only to the member who ended it; null for the other member. */
  ended_reason: string | null
  ended_by: 'me' | 'them' | 'system' | null
  ended_at: string | null
  created_at: string
  /** null: the other account is unavailable; show "Member no longer available". */
  other: ProfileCard | null
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
  is_muted: boolean
  is_archived: boolean
  /** null unless both members have send_read_receipts on (09 section 9). */
  their_last_read_message_id: string | null
  my_contact_share: ContactShare | null
  their_contact: SharedContact | null
}

export type SafetyNotice = 'money' | 'off_platform' | 'contact_info'

export type Message = {
  id: string
  connection_id: string
  sender: 'me' | 'them' | 'system'
  kind: 'text' | 'system'
  /** null when deleted */
  body: string | null
  is_deleted: boolean
  system_event: string | null
  system_data: Record<string, unknown> | null
  client_message_id: string | null
  /** Only on messages from 'them', see 13 section 5. */
  safety_notice: SafetyNotice | null
  created_at: string
}

export type MessagePage = { items: Message[]; has_more: boolean }

export type EndConnectionReason =
  | 'not_compatible'
  | 'family_declined'
  | 'no_response'
  | 'found_someone_else'
  | 'inappropriate_behaviour'
  | 'other'

export type ContactShareBody = {
  share_phone: boolean
  share_whatsapp: boolean
  share_email: boolean
  share_guardian: boolean
}

// ---------------------------------------------------------------------------
// 4.8 Search filters
// ---------------------------------------------------------------------------

/** Keys match Preferences. A missing key, null or an empty array means no filter. */
export type SearchFilters = {
  /** Exact profile code; when set, all other filters are ignored. */
  public_code?: string
  age_min?: number
  age_max?: number
  height_min_cm?: number
  height_max_cm?: number
  marital_statuses?: string[]
  children_acceptance?: ChildrenAcceptance
  religion_codes?: string[]
  sect_codes?: string[]
  caste_codes?: string[]
  mother_tongue_codes?: string[]
  country_codes?: string[]
  region_ids?: number[]
  city_ids?: number[]
  education_min_rank?: number
  employment_types?: string[]
  profession_codes?: string[]
  income_min_rank?: number
  religiosity_levels?: string[]
  hijab_types?: string[]
  beard_types?: string[]
  family_values?: string[]
  family_types?: string[]
  living_arrangements?: string[]
  work_after_marriage_options?: string[]
  smoking_options?: string[]
  managed_by?: string[]
  has_photo?: boolean
  /** id_verified or photo_verified */
  verified_only?: boolean
  /** 1, 7 or 30 */
  active_within_days?: number
  /** 7 or 30 */
  joined_within_days?: number
}

export type SearchSort = 'best_match' | 'newest' | 'recently_active'

export type SearchBody = {
  filters: SearchFilters
  sort: SearchSort
  limit?: number
  cursor?: string
}

export type SearchPage = Page<ProfileCard> & { total_estimate: number | null }

export type SavedSearch = {
  id: string
  name: string
  filters: SearchFilters
  notify_new: boolean
  created_at: string
}

// ---------------------------------------------------------------------------
// 5. Meta and reference data
// ---------------------------------------------------------------------------

export type AppRelease = {
  version_code: number
  version_name: string
  min_supported_version_code: number
  download_url: string
  release_notes: string | null
}

export type OptionItem = { code: string; label: string; label_ur: string | null }
type Named = { code: string; name: string; name_ur: string | null }

export type ReferenceBootstrap = {
  /** Changes whenever any list changes; equals the ETag. */
  version: string
  options: { [list: string]: OptionItem[] }
  religions: (Named & { sects: Named[] })[]
  castes: (Named & { aliases: string[]; sub_castes: Named[] })[]
  languages: Named[]
  education_levels: (Named & { rank: number })[]
  education_fields: Named[]
  profession_categories: Named[]
  income_bands: {
    code: string
    currency_code: string
    label: string
    label_ur: string | null
    rank: number
  }[]
  hobbies: (Named & { category: string })[]
  countries: (Named & { dial_code: string | null })[]
}

export type Region = { id: number; name: string; name_ur: string | null }

// ---------------------------------------------------------------------------
// 9. Verification
// ---------------------------------------------------------------------------

export type VerificationKind = 'id_document' | 'selfie'

export type VerificationRequest = {
  id: string
  kind: VerificationKind
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  rejection_reason: string | null
  created_at: string
  reviewed_at: string | null
}

export type Verifications = {
  phone_verified: boolean
  photo_verified: boolean
  id_verified: boolean
  identity: IdentitySummary | null
  /** Newest first, at most 10. */
  requests: VerificationRequest[]
}

export type SelfieGesture = 'peace_sign' | 'thumbs_up' | 'open_palm' | 'hand_on_head'

export type VerificationSubmitBody =
  | {
      kind: 'id_document'
      front_key: string
      back_key: string | null
      selfie_key: string
      gesture: string
    }
  | { kind: 'selfie'; selfie_key: string; gesture: string }

// ---------------------------------------------------------------------------
// 10. Discovery
// ---------------------------------------------------------------------------

export type NudgeCode =
  | 'add_photo'
  | 'verify_identity'
  | 'verify_photo'
  | 'complete_profile'
  | 'set_preferences'
  | 'add_about_me'
  | 'add_contact_details'

export type RelaxationHint = { dimension: string; extra_profiles: number }

export type Home = {
  /** Top 10 */
  recommendations: ProfileCard[]
  /** Up to 10, joined in the last 7 days, passing the viewer's must-haves. */
  new_members: ProfileCard[]
  /** Up to 10, same city, then same region. */
  nearby: ProfileCard[]
  /** Up to 5 */
  recent_visitors: ProfileCard[]
  visitors_count_7d: number
  pending_interests: number
  completeness: number
  /** At most 3, highest priority first. */
  nudges: { code: NudgeCode; priority: number }[]
  /** true when there are no more candidates under the current must-haves. */
  pool_exhausted: boolean
  /** At most 2; which must-have to loosen (10 section 8). */
  relaxation_hints: RelaxationHint[]
}

export type RecommendationsPage = Page<ProfileCard> & {
  refreshed_at: string | null
  is_refreshing: boolean
  pool_exhausted: boolean
  relaxation_hints: RelaxationHint[]
}

export type Visit = { profile: ProfileCard; last_viewed_at: string; view_count: number }
export type VisitorsPage = Page<Visit> & { hidden_because_private?: boolean }

// ---------------------------------------------------------------------------
// 11 to 13. Interests, shortlist, blocks, photo access, reports
// ---------------------------------------------------------------------------

export type InterestBox = 'received' | 'sent'
export type InterestListStatus = 'pending' | 'accepted' | 'closed'

export type SendInterestResult = { interest: Interest; connection: Connection | null }
export type AcceptInterestResult = { interest: Interest; connection: Connection }

export type ShortlistEntry = {
  profile_id: string
  profile: ProfileCard | null
  note: string | null
  created_at: string
}

export type BlockEntry = {
  profile_id: string
  display_name: string
  public_code: string
  created_at: string
}

export type PhotoAccessEntry = {
  id: string
  profile_id: string
  status: string
  created_at: string
  profile: ProfileCard | null
}

export type ReportSubject = 'profile' | 'photo' | 'message'

export type ReportBody = {
  target_profile_id: string
  subject_type: ReportSubject
  photo_id?: string
  message_id?: string
  /** reports.reason values */
  reason: string
  details?: string
  also_block?: boolean
}

// ---------------------------------------------------------------------------
// 14. Notifications
// ---------------------------------------------------------------------------

export type NotificationItem = {
  id: string
  /** notifications.type values */
  type: string
  actor: { profile_id: string; display_name: string; photo: PhotoView | null } | null
  /** Per type, see 14 section 3. */
  data: Record<string, unknown>
  is_read: boolean
  created_at: string
}

/** Columns of notification_preferences except user_id and timestamps (14 section 6). */
export type NotificationPreferences = Record<string, boolean | string | number | null>

// ---------------------------------------------------------------------------
// 2. Errors
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'account_banned'
  | 'account_suspended'
  | 'account_deletion_scheduled'
  | 'consent_required'
  | 'onboarding_required'
  | 'profile_not_active'
  | 'not_found'
  | 'invalid_state'
  | 'already_exists'
  | 'identity_already_registered'
  | 'interest_already_pending'
  | 'already_connected'
  | 'cooldown_active'
  | 'not_permitted_by_member'
  | 'connection_ended'
  | 'payload_too_large'
  | 'upgrade_required'
  | 'rate_limited'
  | 'limit_reached'
  | 'internal_error'
  | 'service_unavailable'
  /** Set by the client when the request never reached the API. */
  | 'network_error'

export type FieldErrorCode =
  | 'required'
  | 'invalid'
  | 'too_short'
  | 'too_long'
  | 'out_of_range'
  | 'unknown_code'
  | 'not_allowed'
  | 'too_young'
  | 'contains_contact_info'
  | 'inappropriate'
  | 'mismatch'
  | 'locked'

export type ApiFieldError = { field: string; code: FieldErrorCode | string; message: string }

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode | string
    message: string
    fields?: ApiFieldError[]
    details?: Record<string, unknown>
    request_id?: string
  }
}

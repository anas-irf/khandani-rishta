# 15. API Contract

| | |
|---|---|
| Status | Design complete, not implemented |
| Implemented in | `apps/api` (Rust, Axum, `utoipa`). The generated `packages/api-contract/openapi.json` must match this document. |
| Related | [03-domain-model.md](03-domain-model.md) for states and gates, [04-database-schema.md](04-database-schema.md) for field names and allowed values |

Every screen document refers to endpoints by the method and path given here. Field names in request and response bodies are the column names from the schema unless stated otherwise.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | `https://api.khandanirishta.app` (production), `https://api-staging.khandanirishta.app` (staging), `http://localhost:8787` (local). All product routes start with `/v1`. |
| Format | JSON, UTF-8, `snake_case` keys. Requests with a body send `Content-Type: application/json`. |
| Authentication | `Authorization: Bearer <Clerk session token>`. Details in 06 section 6. |
| IDs | UUID strings. Lookup values are their `code`. `region_id` and `city_id` are integers. |
| Time | Timestamps are RFC 3339 in UTC, for example `2026-11-20T10:15:00Z`. Dates are `YYYY-MM-DD`. |
| Nulls | Optional values that are not set are returned as `null`, never left out, so generated clients have stable types. |
| Unknown fields | Request bodies with unknown keys are rejected with `400 bad_request` (`#[serde(deny_unknown_fields)]`). |
| Enumerations | Sent and returned as the lowercase codes listed in the schema `CHECK` constraints. |
| Lists | Cursor pagination: `?limit=20&cursor=<opaque>`. Response `{ "items": [...], "next_cursor": "..." }`, with `next_cursor: null` on the last page. `limit` defaults to 20, maximum 50. |
| Request id | Every response carries `x-request-id`. Clients show it on error screens and include it in support requests. |
| Versioning | Additive changes (new fields, new endpoints, new enum values for display-only fields) stay in `/v1`. Anything that breaks an installed Android build needs `/v2`. Clients must ignore unknown response fields and unknown enum values. |

## 2. Errors

Every non-2xx response has this body:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Some fields need your attention.",
    "fields": [
      { "field": "date_of_birth", "code": "too_young", "message": "The candidate must be at least 18 years old." }
    ],
    "details": {},
    "request_id": "0193a2c4-..."
  }
}
```

- `code` is stable and is what clients branch on. `message` is English text suitable for display as a fallback.
- `fields` is present only for `validation_failed`. `field` is the JSON key of the request body (dot-separated for nested keys).
- `details` carries extra data for some codes, listed below.

### 2.1 Error codes

| HTTP | `code` | When | `details` |
|---|---|---|---|
| 400 | `bad_request` | Malformed JSON, unknown key, wrong type | |
| 400 | `validation_failed` | One or more fields are invalid | |
| 401 | `unauthenticated` | Missing, expired or invalid token | |
| 403 | `forbidden` | Authenticated but not allowed (wrong role, not a member of the connection) | |
| 403 | `account_banned` | `users.status = 'banned'` | `reason` |
| 403 | `account_suspended` | `users.status = 'suspended'` | `reason`, `suspended_until` |
| 403 | `account_deletion_scheduled` | Deletion pending | `purge_after` |
| 403 | `consent_required` | A new legal document version must be accepted | `documents` |
| 403 | `onboarding_required` | Profile is `draft` | `onboarding_step` |
| 403 | `profile_not_active` | Profile status does not allow the action (03 section 5) | `status` |
| 404 | `not_found` | Resource does not exist, is not visible to the caller, or a block exists | |
| 409 | `invalid_state` | The transition is not allowed from the current state | `status` |
| 409 | `already_exists` | Duplicate create | |
| 409 | `identity_already_registered` | The identity document number belongs to another profile or is banned | |
| 409 | `interest_already_pending` | A pending interest to this profile exists | `interest_id` |
| 409 | `already_connected` | An active connection exists | `connection_id` |
| 409 | `cooldown_active` | A waiting period applies | `retry_after_date` |
| 409 | `not_permitted_by_member` | The other member's settings do not allow this action from the caller | `reason` |
| 409 | `connection_ended` | The connection is no longer active | |
| 413 | `payload_too_large` | Body or declared upload too large | `max_bytes` |
| 426 | `upgrade_required` | Android build older than `min_supported_version_code` | `download_url` |
| 429 | `rate_limited` | Too many requests in a short time. Has a `Retry-After` header. | `retry_after_seconds` |
| 429 | `limit_reached` | A daily or total product limit is used up (03 section 7) | `limit`, `used`, `resets_at`; for the connection cap also `side` (`you` or `them`: whose cap is full) |
| 500 | `internal_error` | Unexpected failure | |
| 503 | `service_unavailable` | Database or a dependency is down | |

### 2.2 Field error codes

`required`, `invalid`, `too_short`, `too_long`, `out_of_range`, `unknown_code`, `not_allowed`, `too_young`, `contains_contact_info`, `inappropriate`, `mismatch`, `locked`.

## 3. Access levels

Each endpoint below names one access level. The level is enforced by Axum extractors in this order: token, user status, profile status.

| Level | Requirement | Fails with |
|---|---|---|
| `public` | None | |
| `auth` | Valid token. Any user status. | `unauthenticated` |
| `open` | `auth`, plus `users.status = 'active'` and profile not `suspended` | `account_banned`, `account_suspended`, `account_deletion_scheduled` |
| `connected` | `open`, plus consents current, plus profile `active`, `paused` or `closed` | `consent_required`, `onboarding_required`, `profile_not_active` |
| `engage` | `connected`, plus profile `active` or `paused` | `profile_not_active` |
| `browse` | `connected`, plus profile `active` | `profile_not_active` |
| `moderator` | `auth`, plus `users.status = 'active'` and role `moderator` or `admin` | `forbidden` |
| `admin` | Same with role `admin` | `forbidden` |

Android clients also send `x-app-platform: android` and `x-app-version-code: <int>`. When the version code is below the newest `app_releases.min_supported_version_code`, every `/v1` route except `/v1/meta/*` answers `426 upgrade_required`.

### 3.1 Rate limits

In-memory limits (a GCRA limiter in the API process), keyed by user id when authenticated, otherwise by `CF-Connecting-IP`. A request whose token is missing, malformed, invalid or expired is not authenticated, whatever route it calls: it counts against its IP in the Unauthenticated group. On `public` routes a valid token is optional; when one is sent, the request counts per user in its group.

| Group | Limit | Applies to |
|---|---|---|
| Default | 120 requests per minute | Everything not listed below |
| Writes | 40 per minute | `POST`, `PUT`, `PATCH`, `DELETE` |
| Search | 30 per minute | `POST /v1/search`, `GET /v1/reference/cities` |
| Uploads | 20 per hour | Upload URL endpoints |
| Unauthenticated | 60 per minute per IP | Requests without a valid token: `public` routes, and refused tokens on any route |
| Webhooks | 300 per minute | `POST /webhooks/clerk` |

Product limits such as interests per day are separate and return `limit_reached`.

## 4. Shared objects

Types are written in TypeScript notation. `T | null` means the key is always present.

### 4.1 Small types

```ts
type Gate = 'banned' | 'suspended' | 'deletion_scheduled' | 'consent_required'
          | 'onboarding' | 'changes_requested' | 'pending_review' | 'ok'

type ConsentDocument = 'terms' | 'privacy' | 'community_guidelines' | 'age_declaration' | 'candidate_consent'
type Badge = 'phone_verified' | 'photo_verified' | 'id_verified' | 'new'
type LastActive = 'online' | 'today' | 'this_week' | 'this_month' | 'earlier'
type Importance = 'must' | 'high' | 'medium' | 'low'
type Tier = 'self' | 'connection' | 'interest_from_owner' | 'interest_to_owner' | 'member'
type TextStatus = 'approved' | 'pending' | 'rejected'

// Groups of fields that privacy settings can hide (09 section 5)
type LockedGroup = 'full_name' | 'photos' | 'caste' | 'income' | 'family'
                 | 'career_details' | 'home' | 'area' | 'health'

type CityRef = { id: number; name: string; region_id: number | null; region_name: string | null; country_code: string }
```

### 4.2 Me

Returned by `GET /v1/me` and by every endpoint that changes the gate.

```ts
type Me = {
  user: {
    id: string
    email: string | null
    email_verified: boolean
    phone_e164: string | null
    phone_verified: boolean
    role: 'member' | 'moderator' | 'admin'
    status: 'active' | 'suspended' | 'banned' | 'deletion_scheduled'
    status_reason: string | null
    suspended_until: string | null
    purge_after: string | null
    locale: 'en' | 'ur'
    timezone: string
    created_at: string
  }
  profile: {
    id: string
    public_code: string
    status: 'draft' | 'pending_review' | 'changes_requested' | 'active' | 'paused' | 'closed' | 'suspended'
    status_reason: string | null
    onboarding_step: string            // see 03 section 4.3
    first_name: string | null
    gender: 'male' | 'female' | null
    managed_by: 'self' | 'parent' | 'sibling' | 'relative' | 'friend' | null
    photo: OwnPhoto | null             // primary photo, if any
    completeness: number               // 0..100
    badges: Badge[]
  }
  gate: Gate
  consents_required: ConsentDocument[]
  counters: {
    unread_chats: number               // connections with unread messages
    pending_interests: number          // received, pending
    pending_photo_requests: number     // received, pending
    unread_notifications: number
  }
  usage: {
    interests_sent_today: number
    interests_per_day: number          // the limit that applies to this profile
  }
  config: {
    identity_required: boolean
    photo_required: boolean
    photos_max: number
    legal: { terms_version: string; privacy_version: string; guidelines_version: string }
    support_email: string
    deletion_grace_days: number        // account.deletion_grace_days, for the text of the delete dialog
    announcement: { text_en: string; text_ur: string | null; url: string | null } | null
  }
}
```

### 4.3 Own profile

The owner's complete view. Section objects are exactly the bodies accepted by `PUT /v1/me/profile/sections/{section}`.

```ts
type OwnProfile = {
  id: string
  public_code: string
  status: string
  status_reason: string | null
  onboarding_step: string
  completeness: number
  missing: string[]                    // completeness item keys not yet met, most valuable first (08 section 6.2)
  locked_fields: string[]              // fields the owner can no longer edit (03 section 8 rule 15)
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

type AccountForSection = {
  managed_by: 'self' | 'parent' | 'sibling' | 'relative' | 'friend' | null
  manager_name: string | null
}

type BasicsSection = {
  first_name: string | null
  last_name: string | null
  gender: 'male' | 'female' | null
  date_of_birth: string | null
  marital_status: string | null
  children_status: string | null
  children_count: number | null
  current_wives_count: number | null
  height_cm: number | null
}

type CommunitySection = {
  religion_code: string | null
  sect_code: string | null
  caste_code: string | null
  caste_other: string | null
  sub_caste_code: string | null
  sub_caste_other: string | null
  mother_tongue_code: string | null
  language_codes: string[]             // languages besides the mother tongue
}

type LocationSection = {
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

type EducationCareerSection = {
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

type FamilySection = {
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

type LifestyleSection = {
  religiosity: string | null
  prayer_frequency: string | null
  hijab: string | null                 // female profiles only
  beard: string | null                 // male profiles only
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

type ContactsSection = {
  phone_e164: string | null
  whatsapp_e164: string | null
  contact_email: string | null
  guardian_name: string | null
  guardian_relation: string | null
  guardian_phone_e164: string | null
  preferred_contact: 'self' | 'guardian'
  best_time_to_call: string | null
}

type IdentitySummary = {
  document_type: 'cnic' | 'nicop' | 'poc' | 'passport'
  number_masked: string                // for example "*********1234"
  status: 'unverified' | 'pending' | 'verified' | 'rejected'
  verified_at: string | null
}
```

### 4.4 Photos

```ts
// A member's own photo.
type OwnPhoto = {
  id: string
  status: 'processing' | 'pending_review' | 'approved' | 'rejected' | 'failed'
  rejection_reason: string | null
  is_primary: boolean
  position: number
  thumb_url: string | null             // null while processing
  medium_url: string | null
  large_url: string | null
  created_at: string
}

// Another member's photo as the viewer is allowed to see it.
type PhotoView = {
  id: string
  is_primary: boolean
  is_blurred: boolean
  thumb_url: string                    // blurred variant when is_blurred
  medium_url: string                   // blurred variant when is_blurred
  large_url: string | null             // null when is_blurred
}
```

Photo URLs are presigned R2 URLs that stay valid for at least 60 minutes after the response. Clients must not store them beyond that. See 08 section 5.4.

### 4.5 Preferences and privacy

`Preferences` has exactly the columns of `partner_preferences` except `profile_id`, `notes_status` and the timestamps. `Privacy` has exactly the columns of `profile_privacy` except `profile_id` and the timestamps.

```ts
type Preferences = {
  age_min: number; age_max: number; age_importance: Importance
  height_min_cm: number | null; height_max_cm: number | null; height_importance: Importance
  marital_statuses: string[]; marital_status_importance: Importance
  children_acceptance: 'any' | 'not_living_with_partner' | 'none'; children_importance: Importance
  religion_codes: string[]; religion_importance: Importance
  sect_codes: string[]; sect_importance: Importance
  caste_codes: string[]; caste_importance: Importance
  mother_tongue_codes: string[]; mother_tongue_importance: Importance
  country_codes: string[]; region_ids: number[]; city_ids: number[]; location_importance: Importance
  education_min_rank: number | null; education_importance: Importance
  employment_types: string[]; profession_codes: string[]; profession_importance: Importance
  income_min_rank: number | null; income_importance: Importance
  religiosity_levels: string[]; religiosity_importance: Importance
  hijab_types: string[]; beard_types: string[]; appearance_importance: Importance
  family_values: string[]; family_types: string[]; family_importance: Importance
  living_arrangements: string[]; living_arrangement_importance: Importance
  work_after_marriage_options: string[]; work_after_marriage_importance: Importance
  smoking_options: string[]; smoking_importance: Importance
  notes: string | null
}

type Privacy = {
  discovery_visibility: 'everyone' | 'preference_match' | 'hidden'
  interest_permission: 'everyone' | 'verified_only' | 'preference_match'
  name_display: 'full_name' | 'first_name_last_initial' | 'first_name_only' | 'initials' | 'code_only'
  photo_visibility: 'members' | 'interests_and_connections' | 'connections' | 'approved_only'
  caste_visibility: 'members' | 'connections' | 'nobody'
  income_visibility: 'members' | 'connections' | 'nobody'
  family_visibility: 'members' | 'connections' | 'nobody'
  career_details_visibility: 'members' | 'connections' | 'nobody'
  home_visibility: 'members' | 'connections' | 'nobody'
  area_visibility: 'members' | 'connections' | 'nobody'
  health_visibility: 'members' | 'connections' | 'nobody'
  show_last_active: boolean
  show_online_status: boolean
  record_my_visits: boolean
  send_read_receipts: boolean
  allow_photo_requests: boolean
}
```

### 4.6 Other members' profiles

```ts
// Compact form used in every list.
type ProfileCard = {
  id: string
  public_code: string
  display_name: string                 // already reduced according to the owner's name_display
  age: number
  gender: 'male' | 'female'
  managed_by: string
  height_cm: number
  marital_status: string
  religion_code: string
  sect_code: string | null
  caste_label: string | null           // caste name or the owner's typed value; null when hidden or not stated
  mother_tongue_code: string
  city_name: string
  region_name: string | null
  country_code: string
  education_level_code: string
  employment_type: string
  profession_code: string | null
  photo: PhotoView | null              // primary photo; null when the profile has no approved photo
  photo_count: number
  badges: Badge[]
  last_active: LastActive | null       // null when the owner hides it
  compat: number | null                // 0..100
  reasons: string[]                    // reason codes, at most 3 (10 section 7)
  relation: {
    tier: Tier
    interest_status: 'pending' | null
    interest_direction: 'sent' | 'received' | null
    connection_id: string | null
    is_shortlisted: boolean
    can_send_interest: boolean         // the same result as Relation.can_send_interest, so lists can offer "Send interest"
  }
}

// Full form used on the profile screen. A hidden value is null. Which groups are then listed in `locked` is defined in 09 section 5.5.
type ProfileDetail = {
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
  family: Omit<FamilySection, 'family_city_id' | 'about_family'> & { family_city_name: string | null } | null
  lifestyle: Omit<LifestyleSection, 'weight_kg' | 'complexion' | 'body_type' | 'about_me'>
  about_me: string | null
  about_family: string | null
  partner_notes: string | null
  looking_for: LookingFor
  compatibility: Compatibility | null   // null only in the owner's own preview (section 7)
  locked: LockedGroup[]
  relation: Relation
}

type Relation = {
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
  photo_access: 'visible' | 'can_request' | 'requested' | 'denied' | 'requests_off'
  can_send_interest: boolean
  cannot_send_reason: null | 'already_pending' | 'already_connected' | 'cooldown' | 'daily_limit'
                    | 'pending_limit' | 'connection_limit' | 'not_permitted_by_member' | 'own_profile_not_active'
  cannot_send_detail: null | 'verified_only' | 'preference_match'   // set only with 'not_permitted_by_member' (09 section 7)
  can_send_interest_after: string | null   // date, for 'cooldown'
}

// What the owner is looking for, as display lines, each marked with whether the viewer fits.
type LookingFor = {
  lines: {
    dimension: string                  // dimension key from 10 section 4, for example 'age'
    summary_values: string[]           // codes or formatted values, for example ['25', '32'] for an age range
    importance: Importance
    viewer_matches: boolean | null     // null when the viewer's value is unknown
  }[]
  matched: number                      // lines where viewer_matches is true
  total: number                        // lines where viewer_matches is not null
}

type Compatibility = {
  compat: number                       // 0..100
  reasons: string[]
  viewer_fit: number                   // 0..100: how well the owner fits the viewer's preferences
  owner_fit: number                    // 0..100: how well the viewer fits the owner's preferences
  dimensions: {
    dimension: string
    importance: Importance             // the viewer's importance for it
    score: number                      // 0..1, how well the owner satisfies the viewer on it
    matched: boolean
  }[]
}
```

### 4.7 Interests, connections, messages

```ts
type Interest = {
  id: string
  direction: 'sent' | 'received'
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired'
  display_status: 'pending' | 'accepted' | 'no_response' | 'closed' | 'withdrawn' | 'declined'
  message: string | null
  compat_score: number | null
  seen: boolean
  created_at: string
  responded_at: string | null
  expires_at: string
  connection_id: string | null
  profile: ProfileCard | null          // the other profile; null when it is no longer visible to the caller
}

type Connection = {
  id: string
  status: 'active' | 'ended'
  stage: 'chatting' | 'families_talking' | 'engaged' | 'nikah_done'
  pending_stage_proposal: {
    id: string
    stage: string
    proposed_by: 'me' | 'them'
    created_at: string
  } | null
  ended_reason: string | null          // returned only to the member who ended it; null for the other member
  ended_by: 'me' | 'them' | 'system' | null
  ended_at: string | null
  created_at: string
  other: ProfileCard | null            // null: the other account is deleted, scheduled for deletion, suspended or banned; show "Member no longer available"
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
  is_muted: boolean
  is_archived: boolean
  their_last_read_message_id: string | null   // null unless both members have send_read_receipts on (09 section 9)
  my_contact_share: ContactShare | null
  their_contact: SharedContact | null
}

type ContactShare = {
  share_phone: boolean
  share_whatsapp: boolean
  share_email: boolean
  share_guardian: boolean
  status: 'active' | 'revoked'
  created_at: string
}

type SharedContact = {
  phone_e164: string | null
  whatsapp_e164: string | null
  contact_email: string | null
  guardian: { name: string | null; relation: string | null; phone_e164: string | null } | null
  preferred_contact: 'self' | 'guardian'
  best_time_to_call: string | null
}

type Message = {
  id: string
  connection_id: string
  sender: 'me' | 'them' | 'system'
  kind: 'text' | 'system'
  body: string | null                  // null when deleted
  is_deleted: boolean
  system_event: string | null
  system_data: object | null
  client_message_id: string | null
  safety_notice: 'money' | 'off_platform' | 'contact_info' | null   // only on messages from 'them', see 13 section 5
  created_at: string
}
```

`display_status` for `Interest` hides declines from senders (03 section 4.7):

| Caller is | `status` | `display_status` |
|---|---|---|
| Sender | `declined` | `no_response` until `expires_at` has passed, then `closed` |
| Sender | `expired` | `closed` |
| Receiver | `declined` | `declined` |
| Receiver | `expired` | `closed` |
| Either | `pending`, `accepted`, `withdrawn` | Same as `status` |

For a sender, `status` itself is also reported as `pending` or `expired` in place of `declined`, following the same rule, so the real value never reaches the client.

### 4.8 Search filters

Keys match `Preferences` so that "search with my preferences" is a direct copy. Every key is optional. A missing key, `null` or an empty array means no filter.

```ts
type SearchFilters = {
  public_code?: string                 // exact profile code; when set, all other filters are ignored
  age_min?: number; age_max?: number
  height_min_cm?: number; height_max_cm?: number
  marital_statuses?: string[]
  children_acceptance?: 'any' | 'not_living_with_partner' | 'none'
  religion_codes?: string[]; sect_codes?: string[]; caste_codes?: string[]; mother_tongue_codes?: string[]
  country_codes?: string[]; region_ids?: number[]; city_ids?: number[]
  education_min_rank?: number
  employment_types?: string[]; profession_codes?: string[]
  income_min_rank?: number
  religiosity_levels?: string[]; hijab_types?: string[]; beard_types?: string[]
  family_values?: string[]; family_types?: string[]
  living_arrangements?: string[]; work_after_marriage_options?: string[]; smoking_options?: string[]
  managed_by?: string[]
  has_photo?: boolean
  verified_only?: boolean              // id_verified or photo_verified
  active_within_days?: number          // 1, 7 or 30
  joined_within_days?: number          // 7 or 30
}
```

## 5. Meta and reference data

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/healthz` | public | Process is up |
| GET | `/readyz` | public | Database is reachable |
| GET | `/v1/meta` | public | Name, version, environment (exists today) |
| GET | `/v1/meta/app-release?platform=android` | public | Latest Android release |
| GET | `/v1/reference/bootstrap` | public | All small lookup lists and option labels |
| GET | `/v1/reference/regions?country_code=PK` | public | Regions of a country |
| GET | `/v1/reference/cities` | public | City search |

**`GET /v1/meta/app-release`** returns `{ "version_code": 12, "version_name": "1.3.0", "min_supported_version_code": 9, "download_url": "https://download.khandanirishta.app/khandani-rishta-1.3.0.apk", "release_notes": "..." }`, or `404 not_found` when no release exists.

**`GET /v1/reference/bootstrap`** returns everything a client needs to render pickers. It supports `ETag` / `If-None-Match` and `Cache-Control: public, max-age=3600`. Clients cache it on disk and revalidate at start.

```ts
type ReferenceBootstrap = {
  version: string                                          // changes whenever any list changes; equals the ETag
  options: { [list: string]: { code: string; label: string; label_ur: string | null }[] }
  religions: { code: string; name: string; name_ur: string | null;
               sects: { code: string; name: string; name_ur: string | null }[] }[]
  castes: { code: string; name: string; name_ur: string | null; aliases: string[];
            sub_castes: { code: string; name: string; name_ur: string | null }[] }[]
  languages: { code: string; name: string; name_ur: string | null }[]
  education_levels: { code: string; name: string; name_ur: string | null; rank: number }[]
  education_fields: { code: string; name: string; name_ur: string | null }[]
  profession_categories: { code: string; name: string; name_ur: string | null }[]
  income_bands: { code: string; currency_code: string; label: string; label_ur: string | null; rank: number }[]
  hobbies: { code: string; name: string; name_ur: string | null; category: string }[]
  countries: { code: string; name: string; name_ur: string | null; dial_code: string | null }[]
}
```

`options` holds one entry per closed list, keyed by the list name. The list names and their labels are defined in 05 section 2 (for example `marital_status`, `employment_type`, `prayer_frequency`). Only active rows are returned, in `sort_order`.

**`GET /v1/reference/regions?country_code=PK`** returns `{ "items": [{ "id": 3, "name": "Punjab", "name_ur": "..." }] }` sorted by name.

**`GET /v1/reference/cities`** query parameters: `country_code` (required), `region_id` (optional), `q` (optional, at least 2 characters, prefix and trigram match), `limit` (default 20, maximum 50). Returns `{ "items": CityRef[] }`. Without `q` it returns the cities with `is_major = true` first, then by population.

## 6. Account

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/v1/me` | auth | Session bootstrap: user, profile summary, gate, counters |
| PATCH | `/v1/me` | open | Change `locale` or `timezone` |
| POST | `/v1/me/consents` | open | Accept new versions of legal documents |
| POST | `/v1/me/deletion` | auth | Schedule account deletion |
| DELETE | `/v1/me/deletion` | auth | Cancel a scheduled deletion |
| POST | `/v1/me/exports` | open | Request a data export |
| GET | `/v1/me/exports/latest` | open | Status and download link of the latest export |
| POST | `/v1/me/devices` | open | Register a push token |
| DELETE | `/v1/me/devices/{push_token}` | auth | Remove a push token (on sign-out) |
| GET | `/v1/me/notification-preferences` | open | Read notification settings |
| PUT | `/v1/me/notification-preferences` | open | Replace notification settings |
| POST | `/v1/events` | auth | Record client-side product events (20 section 8.3) |

**`GET /v1/me`** returns `Me`. It never fails with a gate error. On the first call for a Clerk user it creates the `users`, `profiles`, `profile_privacy` and `notification_preferences` rows (06 section 5). Clients call it at start, after sign-in, when the app returns to the foreground, and after any response whose error code is a gate code.

**`PATCH /v1/me`** body `{ "locale"?: "en" | "ur", "timezone"?: string }`. Returns `Me`.

**`POST /v1/me/consents`** body `{ "documents": ConsentDocument[] }`. Records the current version of each listed document. Returns `Me`. `age_declaration` and `candidate_consent` have no version setting of their own: they are recorded with the current `legal.terms_version`, and only `terms`, `privacy` and `community_guidelines` can make the gate `consent_required`.

**`POST /v1/me/deletion`** body `{ "reason"?: string, "confirm": "DELETE" }`. Sets `users.status = 'deletion_scheduled'` and `purge_after`. Returns `Me`. Errors: `invalid_state` when already scheduled. For a `banned` or `suspended` user the status is kept and only the two timestamps are set, so a sanction cannot be escaped by cancelling (06 section 9).

**`DELETE /v1/me/deletion`** returns `Me` with the user `active` again (a banned or suspended user keeps that status; only the timestamps are cleared). Errors: `invalid_state` when no deletion is scheduled.

**`POST /v1/me/exports`** returns `202` with `{ "status": "queued" }`. At most one request per 24 hours (`limit_reached`).

**`GET /v1/me/exports/latest`** returns `{ "status": "queued" | "ready" | "failed" | "expired", "download_url": string | null, "expires_at": string | null }` or `404`.

**`POST /v1/me/devices`** body `{ "platform": "android" | "web", "push_token": string, "app_version"?: string, "device_model"?: string }`. Upserts on `push_token` (a token moves to the current user). Returns `204`.

**Notification preferences** use the columns of `notification_preferences` except `user_id` and timestamps.

**`POST /v1/events`** body `{ "events": [{ "name": string, "properties"?: object, "occurred_at"?: string }] }`, at most 20 events per call.

- `name` must match `^[a-z][a-z0-9_]{2,49}$`. `properties` may have at most 10 keys whose values are strings (up to 100 characters), numbers or booleans.
- The API writes one `info` log line per event with `event = "client.<name>"`, the platform header and the properties. Nothing is stored in the database.
- Events that break these rules are dropped silently. The response is always `204`, so a client never retries or blocks on it.

## 7. Onboarding and own profile

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/v1/me/profile` | open | Own profile, all sections |
| GET | `/v1/me/profile/preview` | open | Own profile as another member would see it |
| PUT | `/v1/me/profile/sections/{section}` | open | Replace one section |
| POST | `/v1/me/onboarding/continue` | open | Mark the current onboarding step as done |
| POST | `/v1/me/onboarding/complete` | open | Finish onboarding |
| POST | `/v1/me/profile/resubmit` | open | Send a `changes_requested` profile back to review |
| POST | `/v1/me/profile/pause` | connected | `active` to `paused` |
| POST | `/v1/me/profile/resume` | connected | `paused` to `active` |
| POST | `/v1/me/profile/close` | connected | `active` or `paused` to `closed` |
| POST | `/v1/me/profile/reopen` | connected | `closed` to `active` |
| GET | `/v1/me/preferences` | open | Partner preferences |
| PUT | `/v1/me/preferences` | open | Replace partner preferences |
| GET | `/v1/me/privacy` | open | Privacy settings |
| PATCH | `/v1/me/privacy` | open | Change some privacy settings |
| GET | `/v1/me/identity` | open | Identity document summary |
| PUT | `/v1/me/identity` | open | Set the identity document number |

**`GET /v1/me/profile/preview`** query `as=member|connection` (default `member`). Returns a `ProfileDetail` of the caller's own profile, produced by the same visibility code that serves other members (09 section 13), with the tier forced to the requested value. Photos are the real blurred or clear variants that tier would receive. `card.compat` and `compatibility` are `null`, `card.reasons` is empty, every `looking_for.lines[].viewer_matches` is `null`, and `relation` is neutral (`tier` as requested, `interest: null`, `can_send_interest: false`, `cannot_send_reason: null`). It works in any profile status so the member can check before going live. It records no profile view.

**`PUT /v1/me/profile/sections/{section}`**

- `{section}` is one of `account_for`, `basics`, `community`, `location`, `education_career`, `family`, `lifestyle`, `contacts`.
- The body is the matching section type from 4.3. It replaces the whole section: a key sent as `null` clears the value.
- `account_for` additionally accepts `"consents": ConsentDocument[]`, recorded at their current versions.
- Validation rules per field are in 07 (onboarding sections) and 08 section 3 (`contacts`).
- While the profile is `draft`, required fields may be left `null` (the step simply cannot be continued). The exception is a field that a schema constraint ties to another value in the same body, which is required at once: `current_wives_count` with `marital_status = 'married'`, and `children_count` with a `children_status` other than `none`. Once the profile has left `draft`, required fields can no longer be cleared (`validation_failed`, field code `required`).
- Fields in `locked_fields` must be sent with their current value or the request fails with field code `locked`.
- Returns the updated `OwnProfile`. Side effects: recompute `completeness`, set `match_stale = true` (not for the `contacts` section; the full trigger list is in 10 section 8.2), set changed free text to `pending` and enqueue moderation.

**`POST /v1/me/onboarding/continue`** body `{ "step": string }`.

- `step` must equal the current `onboarding_step` (otherwise `invalid_state`, with `details.onboarding_step`), and must not be `review` or `done`.
- Checks the step's requirement (03 section 4.3). On failure: `validation_failed` listing the missing fields.
- Moves `onboarding_step` to the next step and returns `Me`.

**`POST /v1/me/onboarding/complete`** no body.

- Requires `onboarding_step = 'review'`. Re-validates every required field and the 18+ rule.
- Sets `onboarding_step = 'done'`, `onboarding_completed_at`, and the profile status to `active` or `pending_review` (03 section 4.2). Enqueues the first recommendations refresh.
- Returns `Me`.

**`POST /v1/me/profile/resubmit`** no body. Requires `profiles.status = 'changes_requested'` (`invalid_state` otherwise). Re-validates every required field as `complete` does (`validation_failed`). Sets the status to `pending_review` and clears `status_reason`. Returns `Me`.

**`POST /v1/me/profile/close`** body `{ "reason": "found_match_here" | "found_match_elsewhere" | "taking_a_break" | "other" }`. **`POST /v1/me/profile/reopen`** body `{ "confirm": true }`. All four status endpoints return `Me`.

**`PUT /v1/me/preferences`** body `Preferences`. Creates the row if missing. Validates codes, ranges and array sizes. Sets `match_stale = true`. Returns `Preferences`. `GET` returns the stored row, or the computed defaults (07 section 12) when no row exists yet.

**`PATCH /v1/me/privacy`** body: any subset of `Privacy`. Returns the full `Privacy`. Changing `discovery_visibility` or `photo_visibility` takes effect immediately for all viewers.

**`PUT /v1/me/identity`** body `{ "document_type": "cnic" | "nicop" | "poc" | "passport", "number": string }`.

- Validation in 12 section 3. Errors: `validation_failed` (field `number`, codes `required`, `invalid` or `mismatch`), `identity_already_registered`, `invalid_state` when the profile has no gender yet (the number is checked against it), and `invalid_state` when the current identity is `pending` or `verified` (a verified number can only be changed by support).
- Returns `IdentitySummary`. The number is never returned.

## 8. Photos

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/v1/me/photos/uploads` | open | Get a presigned upload URL |
| POST | `/v1/me/photos` | open | Confirm an upload and start processing |
| GET | `/v1/me/photos` | open | Own photos with status |
| PATCH | `/v1/me/photos/{photo_id}` | open | Make a photo primary |
| PUT | `/v1/me/photos/order` | open | Reorder photos |
| DELETE | `/v1/me/photos/{photo_id}` | open | Delete a photo |

**`POST /v1/me/photos/uploads`** body `{ "content_type": "image/jpeg" | "image/png" | "image/webp", "size_bytes": number }`.

- Errors: `payload_too_large` over 10 MB; `limit_reached` when the profile already has `limits.photos_max` photos that are not `rejected` or `failed`.
- Returns `{ "upload_key": string, "upload_url": string, "headers": { "Content-Type": string }, "expires_at": string }`. The client sends the file with `PUT upload_url` and exactly those headers. The URL is valid for 10 minutes.

**`POST /v1/me/photos`** body `{ "upload_key": string }`. Verifies the object exists and belongs to the caller, creates the row with status `processing`, enqueues the `process_photo` job. Returns `201` with `OwnPhoto`. Confirming the same `upload_key` again returns the existing photo with `200` and creates nothing.

**`PATCH /v1/me/photos/{photo_id}`** body `{ "is_primary": true }`. Only an `approved` photo can be primary (`invalid_state`). Returns `OwnPhoto[]`.

**`PUT /v1/me/photos/order`** body `{ "photo_ids": string[] }` listing every photo of the profile once. Returns `OwnPhoto[]`.

**`DELETE /v1/me/photos/{photo_id}`** returns `204`. Deletes the R2 objects through a job.

Clients learn about status changes through the `photo.updated` WebSocket event or by refetching `GET /v1/me/photos`.

## 9. Verification

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/v1/me/verifications` | open | Verification state and history |
| GET | `/v1/me/verifications/selfie-challenge` | open | The gesture to perform in the selfie |
| POST | `/v1/me/verifications/uploads` | open | Presigned upload URL for a verification image |
| POST | `/v1/me/verifications` | open | Submit a verification request |
| DELETE | `/v1/me/verifications/{request_id}` | open | Cancel a pending request |

**`GET /v1/me/verifications`** returns:

```ts
{
  phone_verified: boolean
  photo_verified: boolean
  id_verified: boolean
  identity: IdentitySummary | null
  requests: {
    id: string
    kind: 'id_document' | 'selfie'
    status: 'pending' | 'approved' | 'rejected' | 'cancelled'
    rejection_reason: string | null
    created_at: string
    reviewed_at: string | null
  }[]                                  // newest first, at most 10
}
```

**`GET /v1/me/verifications/selfie-challenge`** returns `{ "gesture": "peace_sign" | "thumbs_up" | "open_palm" | "hand_on_head" }`. The gesture is derived from the profile id and the current date, so it is stable for a day and needs no storage.

**`POST /v1/me/verifications/uploads`** body `{ "slot": "front" | "back" | "selfie", "content_type": string, "size_bytes": number }`. Same response shape as photo uploads. Keys are under the `verification/` prefix.

**`POST /v1/me/verifications`** body:

```ts
{ kind: 'id_document'; front_key: string; back_key: string | null; selfie_key: string; gesture: string }
| { kind: 'selfie'; selfie_key: string; gesture: string }
```

- `id_document` requires an identity number to be set first (`invalid_state` otherwise). `back_key` is required for `cnic`, `nicop` and `poc`.
- `gesture` must equal the challenge of today or of yesterday, so a selfie taken just before midnight is accepted (`validation_failed`, field `gesture`, code `mismatch`).
- `selfie` requires at least one `approved` photo (`invalid_state`).
- Errors: `already_exists` when a pending request of the same kind exists; `profile_not_active` when the profile is `closed` (03 section 5).
- Returns `201` with the request summary.

## 10. Discovery

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/v1/home` | browse | Everything the home screen needs in one call |
| GET | `/v1/recommendations` | browse | Ranked matches, paginated |
| POST | `/v1/recommendations/refresh` | browse | Recompute recommendations now |
| POST | `/v1/search` | browse | Search with filters |
| GET | `/v1/profiles/{profile_id}` | connected | Another member's profile |
| GET | `/v1/profiles/by-code/{public_code}` | browse | Resolve a profile code to an id |
| GET | `/v1/me/visitors` | browse | Who viewed my profile |
| GET | `/v1/me/visited` | browse | Profiles I viewed |
| GET | `/v1/me/saved-searches` | browse | List saved searches |
| POST | `/v1/me/saved-searches` | browse | Save a search |
| PATCH | `/v1/me/saved-searches/{id}` | browse | Rename or toggle notifications |
| DELETE | `/v1/me/saved-searches/{id}` | browse | Delete a saved search |

**`GET /v1/home`** returns:

```ts
{
  recommendations: ProfileCard[]       // top 10
  new_members: ProfileCard[]           // up to 10, joined in the last 7 days, passing the viewer's must-haves
  nearby: ProfileCard[]                // up to 10, same city, then same region
  recent_visitors: ProfileCard[]       // up to 5
  visitors_count_7d: number
  pending_interests: number
  completeness: number
  nudges: {
    code: 'add_photo' | 'verify_identity' | 'verify_photo' | 'complete_profile'
        | 'set_preferences' | 'add_about_me' | 'add_contact_details'
    priority: number
  }[]                                  // at most 3, highest priority first
  pool_exhausted: boolean              // true when there are no more candidates under the current must-haves
  relaxation_hints: { dimension: string; extra_profiles: number }[]   // at most 2; which must-have to loosen (10 section 8)
}
```

**`GET /v1/recommendations`** returns `{ "items": ProfileCard[], "next_cursor": string | null, "refreshed_at": string | null, "is_refreshing": boolean, "pool_exhausted": boolean, "relaxation_hints": { "dimension": string, "extra_profiles": number }[] }`. `relaxation_hints` has at most 2 entries and is empty unless `pool_exhausted` is true (10 section 8). If recommendations are stale (10 section 8), the API refreshes them before answering when that takes less than 2 seconds, otherwise it answers with the old list, sets `is_refreshing: true` and finishes in the background. Each returned candidate has its `shown_count` increased.

**`POST /v1/recommendations/refresh`** returns `202`. At most once per 10 minutes (`rate_limited`).

**`POST /v1/search`** body `{ "filters": SearchFilters, "sort": "best_match" | "newest" | "recently_active", "limit"?: number, "cursor"?: string }`. Returns `{ "items": ProfileCard[], "next_cursor": string | null, "total_estimate": number | null }`. Search rules are in 10 section 9. `total_estimate` is exact up to 500 and `null` above.

**`GET /v1/profiles/{profile_id}`** returns `ProfileDetail`.

- Access: the caller's profile must be `active`, or the target must be a connection or an interest counterpart of the caller (03 section 5).
- Returns `404 not_found` whenever the caller may not open the target under the rules of 09 section 2. In short: the target does not exist, is the same gender, is blocked in either direction, is not `active` (unless it is a connection, or it is `paused` and a pending interest exists between the two), its owner's account is not `active`, or its `discovery_visibility` does not admit the caller and no relation exists.
- Records a profile view (09 section 8) and counts against `limits.profile_views_per_day` (`limit_reached`). Viewing a connection is not counted.

**`GET /v1/profiles/by-code/{public_code}`** returns `{ "profile_id": string }` or `404` under the same visibility rules.

**`GET /v1/me/visitors`** returns a page of `{ "profile": ProfileCard, "last_viewed_at": string, "view_count": number }`, last 30 days, private visits excluded. When the caller's own `record_my_visits` is false, the response is `{ "items": [], "next_cursor": null, "hidden_because_private": true }` (09 section 8).

**`GET /v1/me/visited`** same item shape, the caller's own history for the last 30 days.

**Saved searches:** `POST` body `{ "name": string, "filters": SearchFilters, "notify_new": boolean }`, returns `201` with `{ "id", "name", "filters", "notify_new", "created_at" }`. `PATCH` accepts `name` and `notify_new`. Errors: `limit_reached` at 10.

## 11. Interests

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/v1/interests` | browse | Send an interest |
| GET | `/v1/interests` | engage | List received or sent interests |
| GET | `/v1/interests/{interest_id}` | engage | One interest |
| POST | `/v1/interests/{interest_id}/accept` | engage | Accept a received interest |
| POST | `/v1/interests/{interest_id}/decline` | engage | Decline a received interest |
| POST | `/v1/interests/{interest_id}/withdraw` | engage | Withdraw a sent interest |
| POST | `/v1/interests/seen` | engage | Mark received interests as seen |

**`POST /v1/interests`** body `{ "receiver_profile_id": string, "message"?: string }`.

Checks, in order, with the error returned on failure:

| # | Check | Error |
|---|---|---|
| 1 | Receiver is `active` and the caller may open it under 09 section 2 (exists, opposite gender, no block either way, its `discovery_visibility` admits the caller, the second-marriage rule) | `not_found` |
| 2 | No active connection with the receiver | `already_connected` |
| 3 | No pending interest from the caller to the receiver | `interest_already_pending` |
| 4 | No cooldown applies (03 section 4.7 and 4.8) | `cooldown_active` |
| 5 | Receiver's `interest_permission` allows the caller (09 section 7) | `not_permitted_by_member` with `reason` `verified_only` or `preference_match` |
| 6 | Caller has fewer than `limits.pending_interests_max` pending sent interests | `limit_reached` |
| 7 | Caller has fewer than `limits.active_connections_max` active connections | `limit_reached` |
| 8 | Caller is under the daily limit | `limit_reached` |
| 9 | `message` passes text rules (13 section 3) | `validation_failed` |

If the receiver already has a pending interest to the caller, that interest is accepted instead (mutual interest) and checks 5, 6 and 8 are skipped.

Returns `201` with `{ "interest": Interest, "connection": Connection | null }`. `connection` is set when a mutual interest created one.

**`GET /v1/interests`** query: `box=received|sent` (required), `status=pending|accepted|closed` (default `pending`; `closed` covers declined, withdrawn and expired), pagination. Returns a page of `Interest`, newest first.

**`POST /v1/interests/{interest_id}/accept`** only the receiver, only `pending`. Checks the receiver's and the sender's `limits.active_connections_max` (`limit_reached`). Creates the connection, two `connection_members` rows and a `connected` system message, in one transaction. Returns `{ "interest": Interest, "connection": Connection }`.

**`POST /v1/interests/{interest_id}/decline`** only the receiver, only `pending`. Body `{ "also_block"?: boolean }`. Returns `Interest`.

**`POST /v1/interests/{interest_id}/withdraw`** only the sender, only `pending`. Returns `Interest`.

**`POST /v1/interests/seen`** body `{ "interest_ids": string[] }`. Sets `seen_at` on the caller's received interests. Returns `204`.

## 12. Connections and chat

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/v1/connections` | connected | Chat list |
| GET | `/v1/connections/{connection_id}` | connected | One connection |
| PATCH | `/v1/connections/{connection_id}` | connected | Mute or archive |
| POST | `/v1/connections/{connection_id}/end` | connected | End the connection |
| GET | `/v1/connections/{connection_id}/messages` | connected | Message history |
| POST | `/v1/connections/{connection_id}/messages` | engage | Send a message |
| DELETE | `/v1/connections/{connection_id}/messages/{message_id}` | engage | Remove own message |
| POST | `/v1/connections/{connection_id}/read` | connected | Mark messages as read |
| PUT | `/v1/connections/{connection_id}/contact-share` | engage | Share or update shared contact details |
| DELETE | `/v1/connections/{connection_id}/contact-share` | connected | Stop sharing contact details |
| POST | `/v1/connections/{connection_id}/stage-proposals` | engage | Propose the next stage |
| POST | `/v1/connections/{connection_id}/stage-proposals/{proposal_id}/confirm` | engage | Confirm a proposal |
| POST | `/v1/connections/{connection_id}/stage-proposals/{proposal_id}/decline` | engage | Decline a proposal |
| DELETE | `/v1/connections/{connection_id}/stage-proposals/{proposal_id}` | engage | Cancel own proposal |
| GET | `/v1/ws` | Token in the first frame, then level `open` | WebSocket upgrade (19 section 4). The HTTP upgrade request itself carries no token. |

All connection routes return `404 not_found` when the caller is not one of the two members.

**`GET /v1/connections`** query: `filter=active|archived|ended` (default `active`, which excludes archived), pagination. Returns a page of `Connection` ordered by `last_message_at` descending (connections without messages by `created_at`).

**`PATCH /v1/connections/{connection_id}`** body `{ "is_muted"?: boolean, "is_archived"?: boolean }`. Returns `Connection`.

**`POST /v1/connections/{connection_id}/end`** body `{ "reason": string, "also_block"?: boolean }` with `reason` one of `not_compatible`, `family_declined`, `no_response`, `found_someone_else`, `inappropriate_behaviour`, `other`. Returns `Connection`. Effects in 03 section 4.8.

**`GET /v1/connections/{connection_id}/messages`** query: `before=<message_id>` (optional), `limit` (default 30, maximum 100). Returns `{ "items": Message[], "has_more": boolean }`, newest first. Clients reverse for display. To fetch messages newer than one already held, use `after=<message_id>` (ascending, same limit).

**`POST /v1/connections/{connection_id}/messages`** body `{ "body": string, "client_message_id": string }`.

- `body` is 1 to 2000 characters after trimming. `client_message_id` is a UUID generated by the client; sending the same one again returns the original message with `200` and creates nothing.
- Errors: `connection_ended`; `invalid_state` with `details.status = 'other_unavailable'` when the other member's account is suspended, banned or scheduled for deletion (`Connection.other` is `null`); `rate_limited` and `limit_reached` for the message limits.
- Effects: insert the message; update `connections.last_message_at` and `last_message_preview`; increase the other member's `unread_count`; clear both members' `is_archived`; push `message.new` over WebSocket to both; enqueue a push notification for the other member if they have no open socket and the connection is not muted.
- Returns `201` with `Message`.

**`DELETE .../messages/{message_id}`** only the sender, within 15 minutes of sending (`invalid_state` after). Clears the body and sets `deleted_at`. Returns `Message`.

**`POST /v1/connections/{connection_id}/read`** body `{ "up_to_message_id": string }`. Sets `last_read_message_id`, `last_read_at` and recomputes `unread_count`. Pushes `message.read` to the other member only if both members have `send_read_receipts` on (09 section 9). Returns `204`.

**`PUT .../contact-share`** body `{ "share_phone": boolean, "share_whatsapp": boolean, "share_email": boolean, "share_guardian": boolean }`, at least one true.

- Each selected item must have a value in `profile_contacts` (`validation_failed`, field code `required`, so the client can open the contact details form).
- Creates or updates the share with status `active` and posts a `contact_shared` system message. Returns `Connection`.

**`DELETE .../contact-share`** sets the share to `revoked` and posts `contact_share_revoked`. Returns `Connection`.

**`POST .../stage-proposals`** body `{ "stage": "families_talking" | "engaged" | "nikah_done" }`. The stage must be later than the current one (`invalid_state`) and no proposal may be pending (`already_exists`). After a proposal was declined, the member who made it can propose the same stage again only after 7 days (`cooldown_active`, 11 section 9). The other member is not bound. Posts a `stage_proposed` system message. Returns `Connection`.

**Confirm / decline:** only the member who did not propose. Confirm applies the effects in 03 section 4.8. Both return `Connection`.

## 13. Shortlist, pass, block, photo access, report

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/v1/shortlist` | browse | Shortlisted profiles |
| PUT | `/v1/shortlist/{profile_id}` | browse | Add to shortlist or update the note |
| DELETE | `/v1/shortlist/{profile_id}` | browse | Remove from shortlist |
| PUT | `/v1/passes/{profile_id}` | browse | Mark as not interested |
| DELETE | `/v1/passes/{profile_id}` | browse | Undo |
| GET | `/v1/blocks` | connected | Blocked profiles |
| PUT | `/v1/blocks/{profile_id}` | connected | Block |
| DELETE | `/v1/blocks/{profile_id}` | connected | Unblock |
| POST | `/v1/profiles/{profile_id}/photo-access` | browse | Ask to see photos |
| GET | `/v1/me/photo-access` | engage | Requests received or sent |
| POST | `/v1/me/photo-access/{id}/grant` | engage | Approve a request |
| POST | `/v1/me/photo-access/{id}/deny` | engage | Deny a request |
| PUT | `/v1/me/photo-access/grants/{profile_id}` | engage | Grant access without a request |
| DELETE | `/v1/me/photo-access/grants/{profile_id}` | engage | Revoke access |
| POST | `/v1/reports` | connected | Report a member |

**Shortlist:** `PUT` body `{ "note"?: string }`, returns `204`. At most 200 entries (`limit_reached`). `GET` returns a page of `{ "profile_id": string, "profile": ProfileCard | null, "note": string | null, "created_at": string }`; `profile` is `null` when the profile is no longer visible (the client shows "No longer available" with a remove button).

**Pass:** `PUT` returns `204`, sets `expires_at`, removes the profile from the caller's `match_recommendations`, and removes any shortlist entry.

**Block:** `PUT` returns `204`. Effects, in one transaction: insert the block; end an active connection with `ended_reason = 'blocked'`; close pending interests (03 section 4.7); revoke photo access both ways; delete shortlist entries both ways; delete `match_recommendations` rows both ways. `GET /v1/blocks` returns a page of `{ "profile_id": string, "display_name": string, "public_code": string, "created_at": string }` (no photo, no other data). `DELETE` only removes the block; nothing else is restored.

**`POST /v1/profiles/{profile_id}/photo-access`** no body. Errors: `invalid_state` when the caller can already see the photos; `already_exists` when a request is already pending; `not_permitted_by_member` when `allow_photo_requests` is false; `cooldown_active`; `limit_reached`. Returns `201` with `{ "status": "pending" }`.

**`GET /v1/me/photo-access`** query `box=received|sent`, `status` (default `pending`). Returns a page of `{ "id": string, "profile_id": string, "status": string, "created_at": string, "profile": ProfileCard | null }`. `profile_id` is the other profile, present even when `profile` is `null`, so a grant can still be revoked.

**`POST /v1/reports`** body:

```ts
{
  target_profile_id: string
  subject_type: 'profile' | 'photo' | 'message'
  photo_id?: string
  message_id?: string
  reason: string                       // reports.reason values
  details?: string
  also_block?: boolean
}
```

Returns `201` with `{ "id": string }`. For `subject_type = 'message'` the API stores the 20 messages before and the 5 after the reported one in the report record so moderators have context (13 section 6). The caller must be able to see the subject (`not_found` otherwise). Errors: `limit_reached`.

## 14. Notifications

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/v1/notifications` | open | Notification feed |
| POST | `/v1/notifications/read` | open | Mark as read |

**`GET /v1/notifications`** returns a page of:

```ts
{
  id: string
  type: string                         // notifications.type values
  actor: { profile_id: string; display_name: string; photo: PhotoView | null } | null
  data: object                         // per type, see 14 section 3
  is_read: boolean
  created_at: string
}
```

**`POST /v1/notifications/read`** body `{ "ids": string[] }` or `{ "all": true }`. Returns `204`.

## 15. Webhooks

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/webhooks/clerk` | Svix signature | Clerk user events (06 section 7) |

Returns `204` on success and on duplicates. Returns `400` on a bad signature.

## 16. Admin

All paths start with `/v1/admin`. Behaviour of each queue and the screens that use these routes are in [18-admin-console.md](18-admin-console.md). Every state-changing route writes `admin_audit_log`.

The table lists the routes and their main body fields. The complete request bodies and every response type (`AdminOverview`, `AdminProfile`, `AdminPhotoItem`, `AdminTextItem`, `AdminVerificationDetail`, `AdminReportDetail`, `AdminUser`, `CasteSuggestionItem`, `AuditEntry`) are defined in 18, next to the screen that uses them.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/overview` | moderator | Queue sizes and headline numbers |
| GET | `/profiles` | moderator | Search profiles (`status`, `q`, pagination) |
| GET | `/profiles/{profile_id}` | moderator | Full profile with private fields, history, reports, sanctions |
| POST | `/profiles/{profile_id}/approve` | moderator | `pending_review` to `active` |
| POST | `/profiles/{profile_id}/request-changes` | moderator | `pending_review` to `changes_requested`, body `{ "reason": string }` |
| PATCH | `/profiles/{profile_id}/locked-fields` | admin | Correct name, gender or date of birth on the owner's behalf. Body: the changed fields plus a required `reason` |
| GET | `/photos` | moderator | Photo queue (`status`, default `pending_review`) |
| POST | `/photos/{photo_id}/approve` | moderator | Approve a photo |
| POST | `/photos/{photo_id}/reject` | moderator | Reject, body `{ "reason": string }` (`profile_photos.rejection_reason` values) |
| GET | `/texts` | moderator | Free text awaiting review |
| POST | `/texts/{profile_id}/{field}/approve` | moderator | `field` is `about_me`, `about_family` or `partner_notes`. Body `{ "text_sha256": string }` (the hash of the text the moderator read) |
| POST | `/texts/{profile_id}/{field}/reject` | moderator | Body `{ "text_sha256": string, "note"?: string }` |
| GET | `/verifications` | moderator | Verification queue |
| GET | `/verifications/{request_id}` | moderator | Images (signed URLs), profile data to compare, decrypted number |
| POST | `/verifications/{request_id}/approve` | moderator | Approve. Body `{ "photos_match"?: boolean }` |
| POST | `/verifications/{request_id}/reject` | moderator | Body `{ "reason": string, "note"?: string }` |
| GET | `/reports` | moderator | Report queue (`status`) |
| GET | `/reports/{report_id}` | moderator | Report with context |
| POST | `/reports/{report_id}/claim` | moderator | `open` to `in_review` |
| POST | `/reports/{report_id}/resolve` | moderator | Body `{ "outcome": "actioned" | "dismissed", "note": string }` |
| GET | `/users` | moderator | Search users (`q` matches email, phone, profile code, name) |
| GET | `/users/{user_id}` | moderator | Account, sanctions, devices |
| POST | `/users/{user_id}/warn` | moderator | Body `{ "reason": string, "report_id"?: string }` |
| POST | `/users/{user_id}/suspend` | moderator | Body `{ "reason": string, "days": number, "report_id"?: string }` |
| POST | `/users/{user_id}/unsuspend` | moderator | Lift a suspension |
| POST | `/users/{user_id}/ban` | admin | Body `{ "reason": string, "report_id"?: string }` |
| POST | `/users/{user_id}/unban` | admin | Lift a ban |
| PATCH | `/users/{user_id}/role` | admin | Body `{ "role": "member" | "moderator" | "admin" }` |
| GET | `/caste-suggestions` | moderator | Suggested castes by usage |
| POST | `/caste-suggestions/{id}/promote` | admin | Body `{ "code": string, "name": string, "name_ur"?: string, "parent_code"?: string }` |
| POST | `/caste-suggestions/{id}/reject` | moderator | Reject a suggestion |
| GET | `/castes` | moderator | All castes and sub-castes, including inactive ones, with `sort_order` and `is_active` |
| POST | `/castes` | admin | Add a caste or sub-caste |
| PATCH | `/castes/{code}` | admin | Rename, add aliases, deactivate |
| GET | `/settings` | admin | All `app_settings` |
| PUT | `/settings/{key}` | admin | Body `{ "value": any }` |
| GET | `/releases` | admin | Android releases |
| POST | `/releases` | admin | Publish a release record |
| POST | `/announcements` | admin | Send an announcement notification to all members. Answers `202` |
| GET | `/audit-log` | admin | Audit entries (`actor_user_id`, `target_type`, `target_id`) |

## 17. Endpoint to module map

Suggested layout of `apps/api/src/routes/`, one file per row. Each file exposes `pub fn router() -> OpenApiRouter<AppState>` like the existing `meta.rs`.

| File | Sections |
|---|---|
| `health.rs`, `meta.rs` | 5 (existing files; add `app-release`) |
| `reference.rs` | 5 |
| `me.rs` | 6 |
| `profile.rs` | 7 |
| `photos.rs` | 8 |
| `verifications.rs` | 9 |
| `discovery.rs` | 10 |
| `interests.rs` | 11 |
| `connections.rs` | 12 |
| `relations.rs` | 13 |
| `notifications.rs` | 14 |
| `webhooks.rs` | 15 |
| `admin/*.rs` | 16 |
| `ws.rs` | 12 (`GET /v1/ws`) |

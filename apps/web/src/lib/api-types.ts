/**
 * Request and response types of the Khandani Rishta API.
 *
 * Every type comes from the OpenAPI contract generated from the API
 * (`packages/api-contract`, regenerated with `pnpm generate:api-client`). The names below are
 * the ones the web app has always imported; most are plain aliases of `components['schemas']`.
 * Only frontend helpers with no generated counterpart are written out here.
 */

import type { components, operations } from '@khandani/api-contract'

type Schemas = components['schemas']

/**
 * The contract types a free-form JSON object (`{ "type": "object" }`) as `unknown`. The fields
 * below always hold a JSON object (or `null`), so they are narrowed to one here.
 */
type JsonObject = Record<string, unknown>
type WithJsonObject<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: null extends T[P] ? JsonObject | null : JsonObject
}

/**
 * `T` with every key present and never `undefined`. Schemas that are also request bodies (the
 * profile sections, `Preferences`) have optional keys in the contract; a form holds a value or
 * `null` for every field.
 */
export type Filled<T> = { [K in keyof T]-?: Exclude<T[K], undefined> }

// ---------------------------------------------------------------------------
// 4.1 Small types
// ---------------------------------------------------------------------------

export type Gate = Schemas['Gate']

export type ConsentDocument = Schemas['ConsentDocument']

export type Badge = Schemas['Badge']
export type LastActive = Schemas['LastActive']
export type Importance = Schemas['Importance']
export type Tier = Schemas['Tier']
export type TextStatus = Schemas['TextStatus']
export type Gender = Schemas['Gender']
export type ManagedBy = Schemas['ManagedBy']

/** Groups of fields that privacy settings can hide (09 section 5). */
export type LockedGroup = Schemas['LockedGroup']

export type CityRef = Schemas['CityRef']

/**
 * A page of a cursor-paginated list (15 section 1). The contract has one schema per list
 * (`InterestPage`, `ShortlistPage`, ...), all of this shape.
 */
export type Page<T> = {
  items: T[]
  next_cursor: string | null
}

// ---------------------------------------------------------------------------
// 4.2 Me
// ---------------------------------------------------------------------------

export type UserRole = Schemas['UserRole']
export type UserStatus = Schemas['UserStatus']
export type ProfileStatus = Schemas['ProfileStatus']

export type Locale = Schemas['Locale']

export type Announcement = Schemas['AnnouncementBanner']

export type Counters = Schemas['Counters']

export type Me = Schemas['Me']

export type PatchMeBody = Schemas['PatchMe']
export type ConsentsBody = Schemas['ConsentsBody']
export type DeletionBody = Schemas['DeletionBody']

export type DataExport = Schemas['LatestExport']

// ---------------------------------------------------------------------------
// 4.3 Own profile
// ---------------------------------------------------------------------------

export type ProfileSectionKey = operations['put_section']['parameters']['path']['section']

export type AccountForSection = Schemas['AccountForSection']

/** `account_for` additionally accepts the consents to record (15 section 7). */
export type AccountForBody = Schemas['AccountForBody']

export type BasicsSection = Schemas['BasicsSection']

export type CommunitySection = Schemas['CommunitySection']

export type LocationSection = Schemas['LocationSection']

export type EducationCareerSection = Schemas['EducationCareerSection']

export type FamilySection = Schemas['FamilySection']

export type LifestyleSection = Schemas['LifestyleSection']

export type ContactsSection = Schemas['ContactsSection']

/**
 * The body of `PUT /v1/me/profile/sections/{section}` for each section. The contract only has
 * the union of them all (`SectionBody`).
 */
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

export type IdentityDocumentType = Schemas['DocumentType']
export type IdentityStatus = Schemas['IdentityStatus']

export type IdentitySummary = Schemas['IdentitySummary']

export type OwnProfile = Schemas['OwnProfile']

export type IdentityBody = Schemas['IdentityBody']

export type CloseReason = Schemas['ClosedReason']

// ---------------------------------------------------------------------------
// 4.4 Photos
// ---------------------------------------------------------------------------

export type OwnPhotoStatus = Schemas['PhotoStatus']

/** A member's own photo. */
export type OwnPhoto = Schemas['OwnPhoto']

/** Another member's photo as the viewer is allowed to see it. */
export type PhotoView = Schemas['PhotoView']

/** `UploadRequest.content_type` is a plain string in the contract; these are the accepted values. */
export type UploadContentType = 'image/jpeg' | 'image/png' | 'image/webp'

export type UploadTicket = Schemas['UploadTicket']

// ---------------------------------------------------------------------------
// 4.5 Preferences and privacy
// ---------------------------------------------------------------------------

export type ChildrenAcceptance = Schemas['ChildrenAcceptance']

export type Preferences = Schemas['Preferences']

export type Visibility3 = Schemas['FieldVisibility']

export type Privacy = Schemas['Privacy']

// ---------------------------------------------------------------------------
// 4.6 Other members' profiles
// ---------------------------------------------------------------------------

/** Compact form used in every list. */
export type ProfileCard = Schemas['ProfileCard']

export type CannotSendReason = Schemas['CannotSendReason']

export type PhotoAccessState = Schemas['RelationPhotoAccess']

export type Relation = Schemas['Relation']

/** What the owner is looking for, as display lines, each marked with whether the viewer fits. */
export type LookingFor = Schemas['LookingFor']

export type Compatibility = Schemas['Compatibility']

/** Full form used on the profile screen. A hidden value is null. */
export type ProfileDetail = Schemas['ProfileDetail']

// ---------------------------------------------------------------------------
// 4.7 Interests, connections, messages
// ---------------------------------------------------------------------------

export type InterestStatus = Schemas['InterestStatus']
export type InterestDisplayStatus = Schemas['DisplayStatus']

export type Interest = Schemas['Interest']

export type Stage = Schemas['ConnectionStage']
/** The stages a member can propose: every stage after `chatting`. */
export type ProposableStage = Schemas['ProposableStage']

export type ContactShare = Schemas['ContactShare']

export type SharedContact = Schemas['SharedContact']

export type Connection = Schemas['Connection']

export type SafetyNotice = Schemas['SafetyFlag']

export type Message = WithJsonObject<Schemas['Message'], 'system_data'>

export type MessagePage = Omit<Schemas['MessagesPage'], 'items'> & { items: Message[] }

/** The reasons a member may give; `blocked` and `account_closed` are set by the system. */
export type EndConnectionReason = Schemas['MemberEndReason']

export type ContactShareBody = Schemas['ContactShareBody']

// ---------------------------------------------------------------------------
// 4.8 Search filters
// ---------------------------------------------------------------------------

/** Keys match Preferences. A missing key, null or an empty array means no filter. */
export type SearchFilters = Schemas['SearchFilters']

export type SearchSort = Schemas['SearchSort']

export type SearchBody = Schemas['SearchRequest']

export type SearchPage = Schemas['SearchResults']

export type SavedSearch = Schemas['SavedSearch']

// ---------------------------------------------------------------------------
// 5. Meta and reference data
// ---------------------------------------------------------------------------

export type AppRelease = Schemas['AppRelease']

export type OptionItem = Schemas['OptionItem']

export type ReferenceBootstrap = Schemas['ReferenceBootstrap']

export type Region = Schemas['RegionItem']

// ---------------------------------------------------------------------------
// 9. Verification
// ---------------------------------------------------------------------------

export type VerificationKind = Schemas['VerificationKind']

export type VerificationRequest = Schemas['VerificationRequestSummary']

export type Verifications = Schemas['VerificationOverview']

export type SelfieGesture = Schemas['Gesture']

export type VerificationSubmitBody = Schemas['SubmitVerification']

// ---------------------------------------------------------------------------
// 10. Discovery
// ---------------------------------------------------------------------------

export type NudgeCode = Schemas['NudgeCode']

export type RelaxationHint = Schemas['RelaxationHint']

export type Home = Schemas['Home']

export type RecommendationsPage = Schemas['RecommendationsPage']

export type Visit = Schemas['VisitorItem']
export type VisitorsPage = Schemas['VisitorsPage']

// ---------------------------------------------------------------------------
// 11 to 13. Interests, shortlist, blocks, photo access, reports
// ---------------------------------------------------------------------------

type InterestListQuery = operations['list_interests']['parameters']['query']
export type InterestBox = InterestListQuery['box']
export type InterestListStatus = NonNullable<InterestListQuery['status']>

export type SendInterestResult = Schemas['SentInterest']
export type AcceptInterestResult = Schemas['AcceptedInterest']

export type ShortlistEntry = Schemas['ShortlistItem']

export type BlockEntry = Schemas['BlockItem']

export type PhotoAccessEntry = Schemas['PhotoAccessItem']

export type ReportSubject = Schemas['ReportSubject']

export type ReportBody = Schemas['FileReportBody']

// ---------------------------------------------------------------------------
// 14. Notifications
// ---------------------------------------------------------------------------

/** `data` has a shape per type, see 14 section 3. */
export type NotificationItem = WithJsonObject<Schemas['Notification'], 'data'>

/** Columns of notification_preferences except user_id and timestamps (14 section 6). */
export type NotificationPreferences = Schemas['NotificationPreferences']

// ---------------------------------------------------------------------------
// 2. Errors
// ---------------------------------------------------------------------------

/** Error codes of 15 section 2.1. The contract types `ErrorDetail.code` as a plain string. */
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

export type FieldErrorCode = Schemas['FieldCode']

export type ApiFieldError = Schemas['FieldError']

export type ApiErrorBody = Schemas['ErrorBody']

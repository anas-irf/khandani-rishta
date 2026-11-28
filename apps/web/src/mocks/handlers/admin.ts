import { HttpResponse, http } from 'msw'
import { sha256Hex } from '~/features/admin/hash'
import { SETTING_RULES, validateSetting } from '~/features/admin/settings-spec'
import type {
  AdminCaste,
  AdminOverview,
  AdminPhotoItem,
  AdminProfile,
  AdminProfileListItem,
  AdminRelease,
  AdminReportDetail,
  AdminReportListItem,
  AdminSetting,
  AdminTextField,
  AdminTextItem,
  AdminUser,
  AdminUserListItem,
  AdminVerificationDetail,
  AdminVerificationKind,
  AdminVerificationListItem,
  AuditEntry,
  AuditTargetType,
  CasteSuggestionItem,
  PhotoStatus,
  ReportContextMessage,
  ReportReason,
  ReportSource,
  ReportStatus,
  VerificationRejectionReason,
  VerificationStatus,
} from '~/features/admin/types'
import { isOneOf, USER_ROLES, VERIFICATION_REJECTION_REASONS } from '~/lib/api-enums'
import type {
  ApiFieldError,
  Gender,
  ManagedBy,
  OwnPhoto,
  OwnProfile,
  ProfileStatus,
  ReportSubject,
  TextStatus,
  UserRole,
  UserStatus,
} from '~/lib/api-types'
import { ageFromDateOfBirth } from '~/lib/format'
import { db } from '../db'
import {
  makeOwnPhoto,
  makeOwnProfile,
  makePreferences,
  makePrivacy,
  placeholderPhotoUrl,
} from '../factories'
import { referenceBootstrap } from '../fixtures/reference'
import { apiError, apiUrl, noContent, nowIso, paginate, readJson, validationError } from '../http'

/**
 * 15 section 16: the admin routes, backed by realistic in-memory data kept under
 * `db.extra.admin` (created on first use, so a test or scenario reset starts clean). Access
 * levels follow 15 section 3: `moderator` needs the role moderator or admin, `admin` needs admin.
 */

const HOUR = 3_600_000

type Person = {
  index: number
  userId: string
  profileId: string
  code: string
  first: string
  last: string
  gender: Gender
  dob: string
  city: string
  managedBy: ManagedBy
  maritalStatus: NonNullable<OwnProfile['basics']['marital_status']>
  role: UserRole
  userStatus: UserStatus
  profileStatus: ProfileStatus
  statusReason: string | null
  suspendedUntil: string | null
  email: string
  phone: string
  createdAt: string
  lastSeen: string | null
  onboardingCompletedAt: string | null
  texts: Record<AdminTextField, string | null>
  textStatus: Record<AdminTextField, TextStatus>
  hue: number
  idVerified: boolean
  photoVerified: boolean
  sanctions: AdminUser['sanctions']
  isMe?: boolean
}

type PhotoRec = {
  id: string
  profileId: string
  status: PhotoStatus
  isPrimary: boolean
  createdAt: string
  hue: number
  moderation: Record<string, unknown> | null
}

type VerificationRec = {
  id: string
  profileId: string
  kind: AdminVerificationKind
  status: VerificationStatus
  createdAt: string
  gesture: string
  gestureValid: boolean
  documentNumber: string | null
  purged: boolean
  rejectionReason: VerificationRejectionReason | null
}

type ReportRec = {
  id: string
  source: ReportSource
  reason: ReportReason
  subjectType: ReportSubject
  status: ReportStatus
  targetPersonIndex: number
  reporterPersonIndex: number | null
  details: string | null
  photoId: string | null
  handledByEmail: string | null
  handledAt: string | null
  resolutionNote: string | null
  createdAt: string
}

type AdminState = {
  people: Person[]
  photos: PhotoRec[]
  verifications: VerificationRec[]
  reports: ReportRec[]
  suggestions: CasteSuggestionItem[]
  castes: AdminCaste[]
  settings: Map<string, { value: unknown; by: string | null; at: string | null }>
  releases: AdminRelease[]
  audit: AuditEntry[]
  lastAnnouncementAt: number | null
  counter: number
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/** Default settings (03 section 7). */
const SETTING_DEFAULTS: Record<string, unknown> = {
  'limits.interests_per_day': 10,
  'limits.interests_per_day_verified': 20,
  'limits.pending_interests_max': 50,
  'limits.profile_views_per_day': 150,
  'limits.photo_requests_per_day': 10,
  'limits.messages_per_minute': 20,
  'limits.messages_per_day': 500,
  'limits.reports_per_day': 10,
  'limits.photos_max': 6,
  'limits.saved_searches_max': 10,
  'limits.active_connections_max': 30,
  'interest.expiry_days': 21,
  'interest.cooldown_after_decline_days': 90,
  'interest.cooldown_after_expiry_days': 30,
  'interest.cooldown_after_withdraw_days': 7,
  'connection.cooldown_after_end_days': 90,
  'photo_access.retry_days': 30,
  'pass.duration_days': 180,
  'moderation.profile_review': 'auto',
  'moderation.photo_review': 'manual',
  'moderation.text_review': 'auto',
  'onboarding.identity_required': true,
  'onboarding.photo_required': false,
  'matching.candidate_pool_size': 600,
  'matching.recommendations_size': 200,
  'matching.refresh_hours': 24,
  'account.deletion_grace_days': 30,
  'verification.media_retention_days': 30,
  'legal.terms_version': '2026-11-20',
  'legal.privacy_version': '2026-11-20',
  'legal.guidelines_version': '2026-11-20',
  'support.email': 'support@example.com',
  'announcement.banner': null,
}

const PEOPLE: [string, string, Gender, string, string, ManagedBy][] = [
  ['Ayesha', 'Khan', 'female', '1999-04-12', 'Lahore', 'self'],
  ['Bilal', 'Rehman', 'male', '1995-09-03', 'Karachi', 'parent'],
  ['Fatima', 'Siddiqui', 'female', '1998-01-22', 'Islamabad', 'self'],
  ['Usman', 'Malik', 'male', '1993-06-30', 'Faisalabad', 'sibling'],
  ['Hira', 'Chaudhry', 'female', '2000-11-15', 'Lahore', 'parent'],
  ['Hamza', 'Qureshi', 'male', '1996-02-08', 'Rawalpindi', 'self'],
  ['Maryam', 'Sheikh', 'female', '1997-07-19', 'Multan', 'relative'],
  ['Zain', 'Abbasi', 'male', '1994-12-01', 'Peshawar', 'self'],
  ['Sana', 'Butt', 'female', '1996-05-25', 'Lahore', 'self'],
  ['Omar', 'Farooq', 'male', '1992-03-14', 'Karachi', 'self'],
  ['Noor', 'Javed', 'female', '1999-08-09', 'Sialkot', 'parent'],
  ['Saad', 'Mirza', 'male', '1995-10-27', 'Lahore', 'self'],
  ['Kashif', 'Naveed', 'male', '1990-01-05', 'Gujranwala', 'self'],
  ['Amna', 'Tariq', 'female', '1998-09-17', 'Hyderabad', 'self'],
]

const ABOUT_ME = [
  'I value honesty, family and faith. I enjoy reading and travelling with family.',
  'Looking for a kind, family-oriented partner. I work in software and love cooking on weekends.',
  'Call me on 0300-0000000 or message me on WhatsApp to talk before the families meet.',
  'Simple person who respects elders. I enjoy cricket and long walks.',
]

const hoursAgo = (now: number, hours: number) => new Date(now - hours * HOUR).toISOString()

function createState(): AdminState {
  const now = Date.now()
  const me = db.me.user
  const id = (prefix: string, n: number) =>
    `${prefix}000000-0000-4000-8000-${String(n).padStart(12, '0')}`

  const people: Person[] = PEOPLE.map(([first, last, gender, dob, city, managedBy], index) => {
    const pending = index < 8
    return {
      index,
      userId: id('a2', index + 1),
      profileId: id('a1', index + 1),
      code: `KR${(2000 + index * 13).toString(36).toUpperCase()}`,
      first,
      last,
      gender,
      dob,
      city,
      managedBy,
      maritalStatus: index % 7 === 6 ? 'divorced' : 'never_married',
      role: 'member',
      userStatus: index === 11 ? 'suspended' : index === 12 ? 'banned' : 'active',
      profileStatus: pending
        ? 'pending_review'
        : index === 10
          ? 'changes_requested'
          : index === 11
            ? 'suspended'
            : 'active',
      statusReason:
        index === 11 ? 'You continued to contact a member after they asked you to stop.' : null,
      suspendedUntil: index === 11 ? hoursAgo(now, -24 * 20) : null,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      phone: `+92300${String(1000000 + index * 7919).slice(0, 7)}`,
      createdAt: hoursAgo(now, 24 * (30 - index)),
      lastSeen: index % 4 === 3 ? null : hoursAgo(now, index * 5 + 1),
      onboardingCompletedAt: pending ? hoursAgo(now, 40 - index * 4) : null,
      texts: {
        about_me: ABOUT_ME[index % ABOUT_ME.length] ?? null,
        about_family:
          index % 2 === 0
            ? 'A close family of five, based in the same city for generations.'
            : null,
        partner_notes:
          index % 3 === 0 ? 'Looking for someone who values education and family.' : null,
      },
      textStatus: {
        about_me: index < 5 ? 'pending' : 'approved',
        about_family: index < 3 ? 'pending' : 'approved',
        partner_notes: index === 0 ? 'pending' : 'approved',
      },
      hue: (index * 47) % 360,
      idVerified: index === 8 || index === 9,
      photoVerified: index === 9,
      sanctions:
        index === 11
          ? [
              {
                id: id('a8', 1),
                type: 'suspension',
                reason: 'You continued to contact a member after they asked you to stop.',
                report_id: null,
                starts_at: hoursAgo(now, 24 * 10),
                ends_at: hoursAgo(now, -24 * 20),
                created_by_email: 'mod@example.com',
                revoked_at: null,
                revoked_by_email: null,
              },
            ]
          : [],
    }
  })

  // Staff: the signed-in user (role follows `db.me`), another moderator and another admin.
  const staff: [string, string, UserRole, boolean][] = [
    [me.email?.split('@')[0] ?? 'staff', 'Member', 'member', true],
    ['Sana', 'Mirza', 'moderator', false],
    ['Imran', 'Qadir', 'admin', false],
  ]
  staff.forEach(([first, last, role, isMe], offset) => {
    const index = people.length
    people.push({
      index,
      userId: isMe ? me.id : id('a2', 100 + offset),
      profileId: id('a1', 100 + offset),
      code: `KS${offset + 1}M${offset + 4}Q`,
      first: isMe ? (db.me.profile.first_name ?? 'Staff') : first,
      last,
      gender: 'female',
      dob: '1990-01-01',
      city: 'Lahore',
      managedBy: 'self',
      maritalStatus: 'never_married',
      role,
      userStatus: 'active',
      profileStatus: 'active',
      statusReason: null,
      suspendedUntil: null,
      email: isMe ? (me.email ?? 'staff@example.com') : `${first.toLowerCase()}@example.com`,
      phone: '+923001110000',
      createdAt: hoursAgo(now, 24 * 90),
      lastSeen: hoursAgo(now, 1),
      onboardingCompletedAt: null,
      texts: { about_me: null, about_family: null, partner_notes: null },
      textStatus: { about_me: 'approved', about_family: 'approved', partner_notes: 'approved' },
      hue: 200 + offset * 30,
      idVerified: true,
      photoVerified: true,
      sanctions: [],
      isMe,
    })
  })

  const photos: PhotoRec[] = []
  for (let index = 0; index < 8; index += 1) {
    const person = people[index]
    if (!person) continue
    if (index % 3 === 0) {
      photos.push({
        id: id('a3', index * 10 + 1),
        profileId: person.profileId,
        status: 'approved',
        isPrimary: true,
        createdAt: hoursAgo(now, 100 + index),
        hue: person.hue,
        moderation: null,
      })
    }
    photos.push({
      id: id('a3', index * 10 + 2),
      profileId: person.profileId,
      status: 'pending_review',
      isPrimary: false,
      createdAt: hoursAgo(now, 30 - index * 3),
      hue: (person.hue + 20) % 360,
      moderation: {
        result: index % 4 === 1 ? 'flag' : 'pass',
        nsfw_score: index % 4 === 1 ? 0.41 : 0.02,
        face_count: index % 5 === 2 ? 3 : 1,
      },
    })
  }
  // An already approved photo that was reported (18 section 4.2).
  const reported = people[9]
  if (reported) {
    photos.push({
      id: id('a3', 901),
      profileId: reported.profileId,
      status: 'approved',
      isPrimary: true,
      createdAt: hoursAgo(now, 300),
      hue: reported.hue,
      moderation: { result: 'pass', nsfw_score: 0.05, face_count: 1 },
    })
  }

  const verifications: VerificationRec[] = [
    ['id_document', 0, 30],
    ['selfie', 1, 20],
    ['id_document', 2, 12],
    ['id_document', 3, 5],
  ].map(([kind, personIndex, hours], n) => ({
    id: id('a5', n + 1),
    profileId: people[personIndex as number]?.profileId ?? '',
    kind: kind as 'id_document' | 'selfie',
    status: 'pending',
    createdAt: hoursAgo(now, hours as number),
    gesture: ['peace_sign', 'thumbs_up', 'open_palm', 'hand_on_head'][n % 4] ?? 'peace_sign',
    gestureValid: n !== 2,
    documentNumber: kind === 'id_document' ? `3520${n}-123456${n}-${n % 2 === 0 ? 2 : 1}` : null,
    purged: false,
    rejectionReason: null,
  }))
  verifications.push({
    id: id('a5', 9),
    profileId: people[8]?.profileId ?? '',
    kind: 'id_document',
    status: 'approved',
    createdAt: hoursAgo(now, 24 * 12),
    gesture: 'peace_sign',
    gestureValid: true,
    documentNumber: '35202-1234567-2',
    purged: true,
    rejectionReason: null,
  })

  const report = (
    n: number,
    reason: ReportReason,
    subjectType: ReportRec['subjectType'],
    target: number,
    reporter: number | null,
    hours: number,
    extra: Partial<ReportRec> = {},
  ): ReportRec => ({
    id: id('a4', n),
    source: reporter === null ? 'system' : 'member',
    reason,
    subjectType,
    status: 'open',
    targetPersonIndex: target,
    reporterPersonIndex: reporter,
    details: reporter === null ? null : 'This member keeps asking for money and will not stop.',
    photoId: null,
    handledByEmail: null,
    handledAt: null,
    resolutionNote: null,
    createdAt: hoursAgo(now, hours),
    ...extra,
  })

  const reports: ReportRec[] = [
    report(1, 'harassment', 'message', 3, 4, 26),
    report(2, 'harassment', 'profile', 3, 6, 20),
    report(3, 'inappropriate_photo', 'photo', 9, 13, 14, { photoId: id('a3', 901) }),
    report(4, 'fake_profile', 'profile', 5, 13, 40),
    // The automatic report of 13 section 5.5.
    report(5, 'asking_for_money', 'profile', 7, null, 3),
    report(6, 'asking_for_money', 'message', 12, 2, 8, {
      status: 'in_review',
      handledByEmail: me.email ?? 'staff@example.com',
      handledAt: hoursAgo(now, 2),
    }),
    report(7, 'offensive_content', 'profile', 1, 13, 200, {
      status: 'actioned',
      handledByEmail: 'mod@example.com',
      handledAt: hoursAgo(now, 150),
      resolutionNote: 'The text was rejected and the member was warned.',
    }),
    report(8, 'misleading_information', 'profile', 4, 0, 300, {
      status: 'dismissed',
      handledByEmail: 'mod@example.com',
      handledAt: hoursAgo(now, 290),
      resolutionNote: 'Checked the details against the verified document: no problem found.',
    }),
  ]

  const suggestion = (
    n: number,
    name: string,
    usage: number,
    parentCode: string | null,
    similar: { code: string; name: string }[] = [],
  ): CasteSuggestionItem => ({
    id: id('a6', n),
    name,
    normalized_name: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    parent_code: parentCode,
    parent_name: parentCode
      ? (referenceBootstrap.castes.find((c) => c.code === parentCode)?.name ?? null)
      : null,
    usage_count: usage,
    status: 'pending',
    similar,
    created_at: hoursAgo(now, 24 * (n + 3)),
  })

  const castes: AdminCaste[] = referenceBootstrap.castes.flatMap((caste, index) => [
    {
      code: caste.code,
      name: caste.name,
      name_ur: caste.name_ur,
      parent_code: null,
      aliases: caste.aliases,
      sort_order: (index + 1) * 10,
      is_active: true,
    },
    ...caste.sub_castes.map((sub, subIndex) => ({
      code: sub.code,
      name: sub.name,
      name_ur: sub.name_ur,
      parent_code: caste.code,
      aliases: [],
      sort_order: subIndex + 1,
      is_active: true,
    })),
  ])
  castes.push({
    code: 'retired_example',
    name: 'Retired example',
    name_ur: null,
    parent_code: null,
    aliases: [],
    sort_order: 9999,
    is_active: false,
  })

  const releaseRows: [number, string, number, string | null, number][] = [
    [12, '1.3.0', 9, 'Faster chat and clearer photo requests.', 5],
    [11, '1.2.1', 9, 'Fixes for notifications.', 20],
    [9, '1.2.0', 7, null, 45],
  ]
  const releases: AdminRelease[] = releaseRows.map(([code, name, min, notes, days]) => ({
    id: id('a9', code),
    platform: 'android',
    version_code: code,
    version_name: name,
    min_supported_version_code: min,
    download_url: `https://download.example.com/khandani-rishta-${name}.apk`,
    release_notes: notes,
    released_at: hoursAgo(now, days * 24),
  }))

  const state: AdminState = {
    people,
    photos,
    verifications,
    reports,
    suggestions: [
      suggestion(1, 'Kharal', 14, null),
      suggestion(2, 'Chaudhary', 9, null, [{ code: 'chaudhry', name: 'Chaudhry' }]),
      suggestion(3, 'Gondal', 6, 'jutt'),
      suggestion(4, 'Qureshi Hashmi', 2, 'qureshi'),
    ],
    castes,
    settings: new Map(),
    releases,
    audit: [],
    lastAnnouncementAt: null,
    counter: 100,
  }

  const seedAudit = (
    n: number,
    action: string,
    type: AuditTargetType,
    target: string,
    details: Record<string, unknown>,
    hours: number,
  ) =>
    state.audit.push({
      id: id('a7', n),
      actor: { user_id: id('a2', 101), email: 'sana@example.com' },
      action,
      target_type: type,
      target_id: target,
      details,
      created_at: hoursAgo(now, hours),
    })
  seedAudit(1, 'profile.approve', 'profile', people[8]?.profileId ?? '', {}, 60)
  seedAudit(
    2,
    'report.resolve',
    'report',
    id('a4', 7),
    { outcome: 'actioned', note: 'The text was rejected.' },
    150,
  )
  seedAudit(
    3,
    'user.warn',
    'user',
    people[1]?.userId ?? '',
    { reason: 'Please keep the wording respectful.', report_id: null, sanction_id: id('a8', 2) },
    151,
  )
  seedAudit(
    4,
    'user.suspend',
    'user',
    people[11]?.userId ?? '',
    {
      reason: 'You continued to contact a member after they asked you to stop.',
      days: 30,
      ends_at: hoursAgo(now, -24 * 20),
      report_id: null,
      sanction_id: id('a8', 1),
    },
    240,
  )
  seedAudit(
    5,
    'setting.update',
    'app_setting',
    'limits.messages_per_day',
    { from: 400, to: 500 },
    400,
  )
  return state
}

function state(): AdminState {
  const extra = db.extra as { admin?: AdminState }
  extra.admin ??= createState()
  return extra.admin
}

function newId(s: AdminState, prefix: string): string {
  s.counter += 1
  return `${prefix}000000-0000-4000-8000-${String(s.counter).padStart(12, '0')}`
}

// ---------------------------------------------------------------------------
// Access, audit and shapes
// ---------------------------------------------------------------------------

function role(): UserRole {
  return db.me.user.role
}

/** `moderator` access: role moderator or admin. `admin` access: role admin (15 section 3). */
function denied(level: 'moderator' | 'admin') {
  const current = role()
  const allowed =
    level === 'admin' ? current === 'admin' : current === 'moderator' || current === 'admin'
  return allowed ? null : apiError(403, 'forbidden', 'You are not allowed to do this.')
}

function logAudit(
  action: string,
  targetType: AuditTargetType,
  targetId: string,
  details: Record<string, unknown> = {},
) {
  state().audit.unshift({
    id: newId(state(), 'a7'),
    actor: { user_id: db.me.user.id, email: db.me.user.email },
    action,
    target_type: targetType,
    target_id: targetId,
    details,
    created_at: nowIso(),
  })
}

function invalidState(status?: string) {
  return apiError(409, 'invalid_state', 'This is not allowed in the current state.', {
    details: status ? { status } : {},
  })
}

function bad(...fields: ApiFieldError[]) {
  return validationError(fields)
}

function personOf(s: AdminState, key: { profileId?: string; userId?: string }): Person | undefined {
  return s.people.find((p) => p.profileId === key.profileId || p.userId === key.userId)
}

function roleOf(person: Person): UserRole {
  return person.isMe ? role() : person.role
}

function ownPhotos(s: AdminState, person: Person): OwnPhoto[] {
  return s.photos
    .filter((photo) => photo.profileId === person.profileId)
    .map((photo, position) => {
      const url = placeholderPhotoUrl(person.first, photo.hue)
      return makeOwnPhoto({
        id: photo.id,
        status: photo.status as OwnPhoto['status'],
        is_primary: photo.isPrimary,
        position,
        thumb_url: url,
        medium_url: url,
        large_url: url,
        created_at: photo.createdAt,
      })
    })
}

function photoUrl(s: AdminState, person: Person): string | null {
  const photo = s.photos.find((entry) => entry.profileId === person.profileId)
  return photo ? placeholderPhotoUrl(person.first, photo.hue) : null
}

function profileListItem(s: AdminState, p: Person): AdminProfileListItem {
  return {
    profile_id: p.profileId,
    user_id: p.userId,
    public_code: p.code,
    status: p.profileStatus,
    first_name: p.first,
    last_name: p.last,
    gender: p.gender,
    age: ageFromDateOfBirth(p.dob),
    city_name: p.city,
    managed_by: p.managedBy,
    onboarding_completed_at: p.onboardingCompletedAt,
    photo_thumb_url: photoUrl(s, p),
    open_system_reports: s.reports.filter(
      (r) =>
        r.source === 'system' &&
        r.targetPersonIndex === p.index &&
        r.status !== 'actioned' &&
        r.status !== 'dismissed',
    ).length,
    created_at: p.createdAt,
  }
}

function userListItem(p: Person): AdminUserListItem {
  return {
    user_id: p.userId,
    profile_id: p.profileId,
    public_code: p.code,
    email: p.email,
    role: roleOf(p),
    status: p.userStatus,
    profile_status: p.profileStatus,
    first_name: p.first,
    last_name: p.last,
    gender: p.gender,
    created_at: p.createdAt,
    last_seen_at: p.lastSeen,
  }
}

function reportListItem(s: AdminState, r: ReportRec): AdminReportListItem {
  const target = s.people[r.targetPersonIndex] as Person
  const reporter = r.reporterPersonIndex === null ? null : s.people[r.reporterPersonIndex]
  const priority: 1 | 2 | 3 =
    r.source === 'system' || r.reason === 'underage' || r.reason === 'asking_for_money'
      ? 1
      : ['harassment', 'inappropriate_photo', 'offensive_content', 'impersonation'].includes(
            r.reason,
          )
        ? 2
        : 3
  return {
    report_id: r.id,
    source: r.source,
    priority,
    reason: r.reason,
    subject_type: r.subjectType,
    status: r.status,
    target: {
      profile_id: target.profileId,
      user_id: target.userId,
      public_code: target.code,
      first_name: target.first,
    },
    reporter: reporter
      ? { profile_id: reporter.profileId, public_code: reporter.code, first_name: reporter.first }
      : null,
    open_reports_on_target: s.reports.filter(
      (other) =>
        other.targetPersonIndex === r.targetPersonIndex &&
        (other.status === 'open' || other.status === 'in_review'),
    ).length,
    handled_by_email: r.handledByEmail,
    created_at: r.createdAt,
  }
}

function reportsAgainst(s: AdminState, p: Person, limit: number): AdminReportListItem[] {
  return s.reports
    .filter((r) => r.targetPersonIndex === p.index)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((r) => reportListItem(s, r))
}

function filedSummary(s: AdminState, p: Person) {
  const { total, actioned, dismissed } = reportsFiled(s, p)
  return { filed: total, actioned, dismissed }
}

function reportsFiled(s: AdminState, p: Person) {
  const filed = s.reports.filter((r) => r.reporterPersonIndex === p.index)
  return {
    total: filed.length,
    actioned: filed.filter((r) => r.status === 'actioned').length,
    dismissed: filed.filter((r) => r.status === 'dismissed').length,
  }
}

function auditFor(s: AdminState, p: Person, limit: number): AuditEntry[] {
  return s.audit
    .filter((entry) => entry.target_id === p.profileId || entry.target_id === p.userId)
    .slice(0, limit)
}

function profileDetail(s: AdminState, p: Person): AdminProfile {
  const moderator = role() === 'moderator'
  const base = makeOwnProfile({
    id: p.profileId,
    public_code: p.code,
    status: p.profileStatus as AdminProfile['profile']['status'],
    status_reason: p.profileStatus === 'changes_requested' ? p.statusReason : null,
    basics: {
      first_name: p.first,
      last_name: p.last,
      gender: p.gender,
      date_of_birth: p.dob,
      marital_status: p.maritalStatus,
      children_status: null,
      children_count: null,
      current_wives_count: null,
      height_cm: p.gender === 'male' ? 176 : 160,
    },
    account_for: {
      managed_by: p.managedBy as 'self',
      manager_name: p.managedBy === 'self' ? null : 'Tariq Khan',
    },
    photos: ownPhotos(s, p),
    text_status: p.textStatus as AdminProfile['profile']['text_status'],
    verification: {
      phone_verified: true,
      photo_verified: p.photoVerified,
      id_verified: p.idVerified,
      pending: { id_document: false, selfie: false },
    },
  })
  base.location.city = {
    id: 1,
    name: p.city,
    region_id: 1,
    region_name: 'Punjab',
    country_code: 'PK',
  }
  base.lifestyle.about_me = p.texts.about_me
  base.family.about_family = p.texts.about_family
  base.education_career.job_title = 'Software engineer'
  const contacts = moderator
    ? null
    : { ...base.contacts, phone_e164: p.phone, contact_email: p.email }

  return {
    user: {
      id: p.userId,
      email: p.email,
      email_verified: true,
      phone_e164: moderator ? null : p.phone,
      role: roleOf(p),
      status: p.userStatus,
      status_reason: p.userStatus === 'active' ? null : p.statusReason,
      suspended_until: p.suspendedUntil,
      created_at: p.createdAt,
      last_seen_at: p.lastSeen,
    },
    profile: { ...base, contacts },
    preferences: makePreferences({ notes: p.texts.partner_notes }),
    privacy: makePrivacy(),
    first_activated_at: p.profileStatus === 'pending_review' ? null : p.createdAt,
    last_active_at: p.lastSeen,
    stats: {
      interests_sent: 6 + p.index,
      interests_received: 4 + p.index,
      interests_accepted_by_others: 2,
      active_connections: p.index % 3,
      connections_ended_by_others: p.index % 2,
      money_flags_30d: p.userStatus === 'banned' ? 3 : 0,
      blocks_received: p.index % 4,
    },
    reports_against: reportsAgainst(s, p, 10),
    reports_filed: reportsFiled(s, p),
    sanctions: p.sanctions,
    verification_requests: s.verifications
      .filter((v) => v.profileId === p.profileId)
      .map((v) => ({
        id: v.id,
        kind: v.kind,
        status: v.status,
        rejection_reason: v.rejectionReason,
        created_at: v.createdAt,
        reviewed_at: v.status === 'pending' ? null : v.createdAt,
      })),
    audit: auditFor(s, p, 20),
  }
}

function userDetail(s: AdminState, p: Person): AdminUser {
  const moderator = role() === 'moderator'
  return {
    ...userListItem(p),
    email_verified: true,
    phone_e164: moderator ? null : p.phone,
    phone_verified: true,
    status_reason: p.userStatus === 'active' ? null : p.statusReason,
    suspended_until: p.suspendedUntil,
    deletion_requested_at: null,
    purge_after: null,
    locale: 'en',
    devices: [
      {
        platform: 'android',
        app_version: '1.3.0',
        device_model: 'Samsung A54',
        last_seen_at: p.lastSeen ?? p.createdAt,
      },
      { platform: 'web', app_version: null, device_model: null, last_seen_at: p.createdAt },
    ],
    consents: [
      { document: 'terms', version: '2026-11-20', accepted_at: p.createdAt },
      { document: 'privacy', version: '2026-11-20', accepted_at: p.createdAt },
    ],
    sanctions: p.sanctions,
    reports_against: reportsAgainst(s, p, 20),
    reports_filed: reportsFiled(s, p),
    flags: {
      reporter_misuse: p.index === 13,
      money_flags_30d: p.userStatus === 'banned' ? 3 : 0,
      shared_device_with_sanctioned_user: p.index === 12,
    },
    audit: auditFor(s, p, 50),
  }
}

function photoItem(s: AdminState, photo: PhotoRec): AdminPhotoItem {
  const person = personOf(s, { profileId: photo.profileId }) as Person
  const others = s.photos.filter(
    (other) => other.profileId === photo.profileId && other.id !== photo.id,
  )
  return {
    photo_id: photo.id,
    profile_id: photo.profileId,
    public_code: person.code,
    first_name: person.first,
    gender: person.gender,
    age: ageFromDateOfBirth(person.dob),
    status: photo.status,
    created_at: photo.createdAt,
    large_url: placeholderPhotoUrl(person.first, photo.hue),
    moderation: photo.moderation,
    would_be_primary: !s.photos.some(
      (other) =>
        other.profileId === photo.profileId && other.status === 'approved' && other.id !== photo.id,
    ),
    profile_is_photo_verified: person.photoVerified,
    other_photos: others.map((other) => ({
      photo_id: other.id,
      status: other.status,
      is_primary: other.isPrimary,
      medium_url: placeholderPhotoUrl(person.first, other.hue),
    })),
  }
}

async function textItems(s: AdminState): Promise<AdminTextItem[]> {
  const items: AdminTextItem[] = []
  for (const p of s.people) {
    for (const field of ['about_me', 'about_family', 'partner_notes'] as const) {
      const text = p.texts[field]
      if (p.textStatus[field] !== 'pending' || !text) continue
      items.push({
        profile_id: p.profileId,
        public_code: p.code,
        first_name: p.first,
        gender: p.gender,
        field,
        text,
        text_sha256: await sha256Hex(text),
        updated_at: hoursAgo(Date.now(), 20 - p.index),
      })
    }
  }
  return items.sort((a, b) => a.updated_at.localeCompare(b.updated_at))
}

function verificationDetail(s: AdminState, v: VerificationRec): AdminVerificationDetail {
  const p = personOf(s, { profileId: v.profileId }) as Person
  const label = (text: string) => placeholderPhotoUrl(text, 210)
  return {
    request_id: v.id,
    kind: v.kind,
    status: v.status,
    gesture: v.gesture,
    gesture_valid: v.gestureValid,
    created_at: v.createdAt,
    images: {
      front_url: v.purged || v.kind === 'selfie' ? null : label('CNIC front'),
      back_url: v.purged || v.kind === 'selfie' ? null : label('CNIC back'),
      selfie_url: v.purged ? null : placeholderPhotoUrl(`${p.first} selfie`, p.hue),
    },
    media_purged: v.purged,
    identity: v.documentNumber
      ? {
          document_type: 'cnic',
          number: v.documentNumber,
          status: v.status === 'approved' ? 'verified' : 'pending',
        }
      : null,
    profile: {
      profile_id: p.profileId,
      public_code: p.code,
      first_name: p.first,
      last_name: p.last,
      gender: p.gender,
      date_of_birth: p.dob,
      age: ageFromDateOfBirth(p.dob),
      marital_status: p.maritalStatus,
      managed_by: p.managedBy,
      manager_name: p.managedBy === 'self' ? null : 'Tariq Khan',
      photos: s.photos
        .filter((photo) => photo.profileId === p.profileId && photo.status === 'approved')
        .map((photo) => ({
          photo_id: photo.id,
          status: photo.status,
          is_primary: photo.isPrimary,
          large_url: placeholderPhotoUrl(p.first, photo.hue),
        })),
    },
    previous_requests: s.verifications
      .filter((other) => other.profileId === v.profileId && other.id !== v.id)
      .map((other) => ({
        id: other.id,
        kind: other.kind,
        status: other.status,
        rejection_reason: other.rejectionReason,
        created_at: other.createdAt,
      })),
  }
}

function reportDetail(s: AdminState, r: ReportRec): AdminReportDetail {
  const target = s.people[r.targetPersonIndex] as Person
  const reporter = r.reporterPersonIndex === null ? null : (s.people[r.reporterPersonIndex] ?? null)
  const photo = r.photoId ? s.photos.find((entry) => entry.id === r.photoId) : null

  let context: Record<string, unknown> | null = null
  if (r.subjectType === 'message') {
    const t = (n: number) => hoursAgo(Date.parse(r.createdAt) + 24 * HOUR, 24 - n)
    const messages: ReportContextMessage[] = [
      { id: 'm1', sender: 'system', body: 'You are now connected.', created_at: t(1) },
      {
        id: 'm2',
        sender: 'reporter',
        body: 'Assalam o Alaikum, thank you for accepting.',
        created_at: t(2),
      },
      {
        id: 'm3',
        sender: 'target',
        body: 'Walaikum Assalam. Can you send me some money for an emergency?',
        safety_flag: 'money',
        created_at: t(3),
      },
      { id: 'm4', sender: 'reporter', body: 'I am not comfortable with this.', created_at: t(4) },
      { id: 'm5', sender: 'target', body: null, created_at: t(5) },
    ]
    context = { connection_id: 'c1', reported_message_id: 'm3', messages }
  } else if (r.subjectType === 'profile') {
    context = {
      first_name: target.first,
      last_name: target.last,
      managed_by: target.managedBy,
      about_me: target.texts.about_me,
      about_family: target.texts.about_family,
      job_title: 'Software engineer',
    }
  }

  return {
    ...reportListItem(s, r),
    details: r.details,
    context,
    photo: photo
      ? {
          photo_id: photo.id,
          status: photo.status,
          large_url: placeholderPhotoUrl(target.first, photo.hue),
        }
      : null,
    resolution_note: r.resolutionNote,
    handled_at: r.handledAt,
    target_summary: {
      user_status: target.userStatus,
      profile_status: target.profileStatus,
      reports_against_total: s.reports.filter((other) => other.targetPersonIndex === target.index)
        .length,
      reports_against_actioned: s.reports.filter(
        (other) => other.targetPersonIndex === target.index && other.status === 'actioned',
      ).length,
      sanctions: target.sanctions,
      is_id_verified: target.idVerified,
      is_photo_verified: target.photoVerified,
    },
    reporter_summary: reporter ? filedSummary(s, reporter) : null,
    related_reports: s.reports
      .filter(
        (other) =>
          other.id !== r.id &&
          other.targetPersonIndex === r.targetPersonIndex &&
          (other.status === 'open' || other.status === 'in_review'),
      )
      .map((other) => reportListItem(s, other)),
  }
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function overview(s: AdminState): AdminOverview {
  const pendingProfiles = s.people.filter((p) => p.profileStatus === 'pending_review')
  const pendingPhotos = s.photos.filter((p) => p.status === 'pending_review')
  const pendingVerifications = s.verifications.filter((v) => v.status === 'pending')
  const openReports = s.reports.filter((r) => r.status === 'open')
  const inReview = s.reports.filter((r) => r.status === 'in_review')
  const oldest = (dates: (string | null)[]) => {
    const present = dates.filter((d): d is string => Boolean(d)).sort()
    return present[0] ?? null
  }
  const count = (status: string) => s.people.filter((p) => p.profileStatus === status).length
  const texts = s.people.reduce(
    (total, p) =>
      total +
      (['about_me', 'about_family', 'partner_notes'] as const).filter(
        (field) => p.textStatus[field] === 'pending' && p.texts[field],
      ).length,
    0,
  )
  return {
    generated_at: nowIso(),
    queues: {
      profiles_pending: pendingProfiles.length,
      photos_pending: pendingPhotos.length,
      photos_flagged: pendingPhotos.filter((p) => p.moderation?.result === 'flag').length,
      texts_pending: texts,
      verifications_pending: pendingVerifications.length,
      reports_open: openReports.length,
      reports_in_review: inReview.length,
      caste_suggestions_pending: s.suggestions.filter((x) => x.status === 'pending').length,
      oldest_waiting: {
        profiles: oldest(pendingProfiles.map((p) => p.onboardingCompletedAt)),
        photos: oldest(pendingPhotos.map((p) => p.createdAt)),
        verifications: oldest(pendingVerifications.map((v) => v.createdAt)),
        reports: oldest([...openReports, ...inReview].map((r) => r.createdAt)),
      },
    },
    metrics: {
      users_total: 1284 + s.people.length,
      signups_today: 9,
      signups_7d: 71,
      profiles_by_status: {
        draft: 42,
        pending_review: count('pending_review'),
        changes_requested: count('changes_requested'),
        active: 640 + count('active'),
        paused: 38,
        closed: 17,
        suspended: count('suspended'),
      },
      active_male: 352,
      active_female: 296,
      active_id_verified: 301,
      active_photo_verified: 188,
      active_last_7d: 417,
      interests_sent_today: 63,
      interests_sent_7d: 402,
      interests_accepted_7d: 118,
      connections_active: 211,
      connections_created_7d: 37,
      stage_counts: { chatting: 160, families_talking: 41, engaged: 8, nikah_done: 2 },
      messages_7d: 5120,
      reports_filed_7d: 12,
      users_suspended: s.people.filter((p) => p.userStatus === 'suspended').length,
      users_banned: s.people.filter((p) => p.userStatus === 'banned').length,
      deletions_scheduled: 3,
      jobs_dead: 0,
    },
  }
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

const REASON_LIMITS = { min: 3, max: 500 }

function checkText(field: string, value: unknown, min: number, max: number): ApiFieldError | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length === 0) return { field, code: 'required', message: 'This field is required.' }
  if (text.length < min)
    return { field, code: 'too_short', message: `Write at least ${min} characters.` }
  if (text.length > max)
    return { field, code: 'too_long', message: `Write at most ${max} characters.` }
  return null
}

const optionCodes = (list: string) =>
  (referenceBootstrap.options[list] ?? []).map((option) => option.code)

type Sanction = AdminUser['sanctions'][number]

/** 18 section 5.3: staff cannot be sanctioned by moderators, and nobody sanctions themselves. */
function sanctionBlock(target: Person) {
  if (target.isMe) return apiError(403, 'forbidden', 'You cannot do this to your own account.')
  const staff = roleOf(target) !== 'member'
  if (staff && role() !== 'admin')
    return apiError(403, 'forbidden', 'Only an admin can do this to staff.')
  return null
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const handlers = [
  http.get(apiUrl('/v1/admin/overview'), () => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    return HttpResponse.json(overview(state()))
  }),

  // Profiles ---------------------------------------------------------------
  http.get(apiUrl('/v1/admin/profiles'), ({ request }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const params = new URL(request.url).searchParams
    const status = params.get('status')
    const q = params.get('q')?.trim().toLowerCase()
    const items = s.people
      .filter((p) => (status ? p.profileStatus === status : true))
      .filter((p) =>
        q ? [p.code, p.first, p.last].some((value) => value.toLowerCase().startsWith(q)) : true,
      )
      .sort((a, b) =>
        (a.onboardingCompletedAt ?? '9').localeCompare(b.onboardingCompletedAt ?? '9'),
      )
      .map((p) => profileListItem(s, p))
    return HttpResponse.json(paginate(items, request))
  }),

  http.get(apiUrl('/v1/admin/profiles/:profileId'), ({ params }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const p = personOf(s, { profileId: String(params.profileId) })
    if (!p) return apiError(404, 'not_found', 'Not found.')
    return HttpResponse.json(profileDetail(s, p))
  }),

  http.post(apiUrl('/v1/admin/profiles/:profileId/approve'), ({ params }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const p = personOf(state(), { profileId: String(params.profileId) })
    if (!p) return apiError(404, 'not_found', 'Not found.')
    if (p.profileStatus !== 'pending_review') return invalidState(p.profileStatus)
    p.profileStatus = 'active'
    p.statusReason = null
    logAudit('profile.approve', 'profile', p.profileId)
    return noContent()
  }),

  http.post(
    apiUrl('/v1/admin/profiles/:profileId/request-changes'),
    async ({ params, request }) => {
      const blocked = denied('moderator')
      if (blocked) return blocked
      const p = personOf(state(), { profileId: String(params.profileId) })
      if (!p) return apiError(404, 'not_found', 'Not found.')
      const body = await readJson<{ reason?: string }>(request)
      const problem = checkText('reason', body.reason, 10, 500)
      if (problem) return bad(problem)
      if (p.profileStatus !== 'pending_review') return invalidState(p.profileStatus)
      p.profileStatus = 'changes_requested'
      p.statusReason = (body.reason ?? '').trim()
      logAudit('profile.request_changes', 'profile', p.profileId, { reason: p.statusReason })
      return noContent()
    },
  ),

  http.patch(apiUrl('/v1/admin/profiles/:profileId/locked-fields'), async ({ params, request }) => {
    const blocked = denied('admin')
    if (blocked) return blocked
    const p = personOf(state(), { profileId: String(params.profileId) })
    if (!p) return apiError(404, 'not_found', 'Not found.')
    const body = await readJson<{
      first_name?: string
      last_name?: string
      gender?: Gender
      date_of_birth?: string
      reason?: string
    }>(request)
    const problem = checkText('reason', body.reason, 10, 500)
    if (problem) return bad(problem)
    if (body.date_of_birth && ageFromDateOfBirth(body.date_of_birth) < 18) {
      return bad({
        field: 'date_of_birth',
        code: 'too_young',
        message: 'The candidate must be at least 18 years old.',
      })
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    if (body.first_name && body.first_name !== p.first)
      changes.first_name = { from: p.first, to: body.first_name }
    if (body.last_name && body.last_name !== p.last)
      changes.last_name = { from: p.last, to: body.last_name }
    if (body.date_of_birth && body.date_of_birth !== p.dob)
      changes.date_of_birth = { from: p.dob, to: body.date_of_birth }
    if (body.gender && body.gender !== p.gender)
      changes.gender = { from: p.gender, to: body.gender }
    if (changes.first_name) p.first = body.first_name as string
    if (changes.last_name) p.last = body.last_name as string
    if (changes.date_of_birth) p.dob = body.date_of_birth as string
    if (changes.gender) p.gender = body.gender as Gender
    logAudit('profile.locked_fields_change', 'profile', p.profileId, {
      reason: body.reason,
      changes,
    })
    return noContent()
  }),

  // Photos -----------------------------------------------------------------
  http.get(apiUrl('/v1/admin/photos'), ({ request }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const status = new URL(request.url).searchParams.get('status') ?? 'pending_review'
    const items = s.photos
      .filter((photo) => photo.status === status)
      .map((photo) => photoItem(s, photo))
      .sort((a, b) => {
        const flag = (item: AdminPhotoItem) => (item.moderation?.result === 'flag' ? 0 : 1)
        return flag(a) - flag(b) || a.created_at.localeCompare(b.created_at)
      })
    return HttpResponse.json(paginate(items, request))
  }),

  http.post(apiUrl('/v1/admin/photos/:photoId/approve'), ({ params }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const photo = s.photos.find((entry) => entry.id === params.photoId)
    if (!photo) return apiError(404, 'not_found', 'Not found.')
    if (photo.status !== 'pending_review' && photo.status !== 'approved')
      return invalidState(photo.status)
    if (
      !s.photos.some(
        (other) =>
          other.profileId === photo.profileId && other.isPrimary && other.status === 'approved',
      )
    ) {
      photo.isPrimary = true
    }
    photo.status = 'approved'
    logAudit('photo.approve', 'photo', photo.id, { profile_id: photo.profileId })
    return noContent()
  }),

  http.post(apiUrl('/v1/admin/photos/:photoId/reject'), async ({ params, request }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const photo = s.photos.find((entry) => entry.id === params.photoId)
    if (!photo) return apiError(404, 'not_found', 'Not found.')
    const body = await readJson<{ reason?: string }>(request)
    if (!body.reason || !optionCodes('photo_rejection_reason').includes(body.reason)) {
      return bad({
        field: 'reason',
        code: 'unknown_code',
        message: 'Choose a reason from the list.',
      })
    }
    if (photo.status !== 'pending_review' && photo.status !== 'approved')
      return invalidState(photo.status)
    photo.status = 'rejected'
    photo.isPrimary = false
    logAudit('photo.reject', 'photo', photo.id, {
      profile_id: photo.profileId,
      reason: body.reason,
    })
    return noContent()
  }),

  // Texts ------------------------------------------------------------------
  http.get(apiUrl('/v1/admin/texts'), async ({ request }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    return HttpResponse.json(paginate(await textItems(state()), request))
  }),

  ...(['approve', 'reject'] as const).map((decision) =>
    http.post(
      apiUrl(`/v1/admin/texts/:profileId/:field/${decision}`),
      async ({ params, request }) => {
        const blocked = denied('moderator')
        if (blocked) return blocked
        const p = personOf(state(), { profileId: String(params.profileId) })
        const field = String(params.field) as AdminTextField
        if (!p || !['about_me', 'about_family', 'partner_notes'].includes(field)) {
          return apiError(404, 'not_found', 'Not found.')
        }
        const body = await readJson<{ text_sha256?: string; note?: string }>(request)
        const text = p.texts[field]
        // The hash guards against deciding on text the moderator did not read (18 section 4.3).
        if (
          !text ||
          p.textStatus[field] !== 'pending' ||
          body.text_sha256 !== (await sha256Hex(text))
        ) {
          return invalidState(p.textStatus[field])
        }
        if (body.note && body.note.length > 300) {
          return bad({ field: 'note', code: 'too_long', message: 'Write at most 300 characters.' })
        }
        p.textStatus[field] = decision === 'approve' ? 'approved' : 'rejected'
        logAudit(`text.${decision}`, 'profile', p.profileId, {
          field,
          text_sha256: body.text_sha256,
          ...(decision === 'reject' ? { note: body.note ?? null } : {}),
        })
        return noContent()
      },
    ),
  ),

  // Verifications ----------------------------------------------------------
  http.get(apiUrl('/v1/admin/verifications'), ({ request }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const params = new URL(request.url).searchParams
    const status = params.get('status') ?? 'pending'
    const kind = params.get('kind')
    const items: AdminVerificationListItem[] = s.verifications
      .filter((v) => v.status === status && (!kind || v.kind === kind))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((v) => {
        const p = personOf(s, { profileId: v.profileId }) as Person
        return {
          request_id: v.id,
          kind: v.kind,
          status: v.status,
          profile_id: v.profileId,
          public_code: p.code,
          first_name: p.first,
          created_at: v.createdAt,
        }
      })
    return HttpResponse.json(paginate(items, request))
  }),

  http.get(apiUrl('/v1/admin/verifications/:requestId'), ({ params }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const v = s.verifications.find((entry) => entry.id === params.requestId)
    if (!v) return apiError(404, 'not_found', 'Not found.')
    // Every view is audited, even of a request already decided (18 section 8.1).
    logAudit('verification.view', 'verification_request', v.id, {
      profile_id: v.profileId,
      kind: v.kind,
    })
    return HttpResponse.json(verificationDetail(s, v))
  }),

  http.post(apiUrl('/v1/admin/verifications/:requestId/approve'), async ({ params, request }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const v = s.verifications.find((entry) => entry.id === params.requestId)
    if (!v) return apiError(404, 'not_found', 'Not found.')
    if (v.status !== 'pending') return invalidState(v.status)
    const body = await readJson<{ photos_match?: boolean }>(request)
    v.status = 'approved'
    const p = personOf(s, { profileId: v.profileId })
    if (p) {
      if (v.kind === 'id_document') p.idVerified = true
      if (v.kind === 'selfie' || body.photos_match) p.photoVerified = true
    }
    logAudit('verification.approve', 'verification_request', v.id, {
      profile_id: v.profileId,
      kind: v.kind,
      photos_match: v.kind === 'id_document' ? (body.photos_match ?? null) : null,
    })
    return noContent()
  }),

  http.post(apiUrl('/v1/admin/verifications/:requestId/reject'), async ({ params, request }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const v = s.verifications.find((entry) => entry.id === params.requestId)
    if (!v) return apiError(404, 'not_found', 'Not found.')
    const body = await readJson<{ reason?: string; note?: string }>(request)
    const reason = body.reason
    if (!reason || !isOneOf(VERIFICATION_REJECTION_REASONS, reason)) {
      return bad({
        field: 'reason',
        code: 'unknown_code',
        message: 'Choose a reason from the list.',
      })
    }
    if (v.status !== 'pending') return invalidState(v.status)
    v.status = 'rejected'
    v.rejectionReason = reason
    logAudit('verification.reject', 'verification_request', v.id, {
      profile_id: v.profileId,
      kind: v.kind,
      reason: body.reason,
    })
    return noContent()
  }),

  // Reports ----------------------------------------------------------------
  http.get(apiUrl('/v1/admin/reports'), ({ request }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const status = new URL(request.url).searchParams.get('status') ?? 'open'
    const items = s.reports
      .filter((r) => r.status === status)
      .map((r) => reportListItem(s, r))
      .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
    return HttpResponse.json(paginate(items, request))
  }),

  http.get(apiUrl('/v1/admin/reports/:reportId'), ({ params }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const r = s.reports.find((entry) => entry.id === params.reportId)
    if (!r) return apiError(404, 'not_found', 'Not found.')
    return HttpResponse.json(reportDetail(s, r))
  }),

  http.post(apiUrl('/v1/admin/reports/:reportId/claim'), ({ params }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const r = state().reports.find((entry) => entry.id === params.reportId)
    if (!r) return apiError(404, 'not_found', 'Not found.')
    if (r.status !== 'open') return invalidState(r.status)
    r.status = 'in_review'
    r.handledByEmail = db.me.user.email
    logAudit('report.claim', 'report', r.id)
    return noContent()
  }),

  http.post(apiUrl('/v1/admin/reports/:reportId/resolve'), async ({ params, request }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const r = state().reports.find((entry) => entry.id === params.reportId)
    if (!r) return apiError(404, 'not_found', 'Not found.')
    const body = await readJson<{ outcome?: string; note?: string }>(request)
    if (body.outcome !== 'actioned' && body.outcome !== 'dismissed') {
      return bad({ field: 'outcome', code: 'invalid', message: 'Choose an outcome.' })
    }
    const problem = checkText('note', body.note, 10, 1000)
    if (problem) return bad(problem)
    // From `open` only a dismissal is allowed (bulk dismissal of duplicates).
    if (r.status === 'open' ? body.outcome !== 'dismissed' : r.status !== 'in_review') {
      return invalidState(r.status)
    }
    r.status = body.outcome
    r.resolutionNote = (body.note ?? '').trim()
    r.handledByEmail = db.me.user.email
    r.handledAt = nowIso()
    logAudit('report.resolve', 'report', r.id, { outcome: body.outcome, note: r.resolutionNote })
    return noContent()
  }),

  // Users ------------------------------------------------------------------
  http.get(apiUrl('/v1/admin/users'), ({ request }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const params = new URL(request.url).searchParams
    const q = (params.get('q') ?? '').trim().toLowerCase()
    if (q.length > 0 && q.length < 3) {
      return bad({ field: 'q', code: 'too_short', message: 'Enter at least 3 characters.' })
    }
    const page = Number(params.get('page') ?? '1')
    if (!Number.isInteger(page) || page < 1) {
      return bad({ field: 'page', code: 'out_of_range', message: 'Out of range.' })
    }
    const pageSize = Math.min(Math.max(Number(params.get('page_size') ?? '25') || 25, 1), 100)
    const digits = q.replace(/\D/g, '')
    const status = params.get('status')
    const roleFilter = params.get('role')
    const matching = s.people
      .filter(
        (p) =>
          !q ||
          p.email.toLowerCase() === q ||
          p.code.toLowerCase() === q ||
          (digits.length >= 7 && p.phone.replace(/\D/g, '').endsWith(digits)) ||
          p.first.toLowerCase().startsWith(q) ||
          p.last.toLowerCase().startsWith(q),
      )
      .filter((p) => !status || p.userStatus === status)
      .filter((p) => !roleFilter || roleOf(p) === roleFilter)
      .map(userListItem)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    return HttpResponse.json({
      items: matching.slice((page - 1) * pageSize, page * pageSize),
      total: matching.length,
      page,
      page_size: pageSize,
    })
  }),

  http.get(apiUrl('/v1/admin/users/:userId'), ({ params }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const s = state()
    const p = personOf(s, { userId: String(params.userId) })
    if (!p) return apiError(404, 'not_found', 'Not found.')
    return HttpResponse.json(userDetail(s, p))
  }),

  ...(['warn', 'suspend', 'ban'] as const).map((action) =>
    http.post(apiUrl(`/v1/admin/users/:userId/${action}`), async ({ params, request }) => {
      const blocked = denied(action === 'ban' ? 'admin' : 'moderator')
      if (blocked) return blocked
      const p = personOf(state(), { userId: String(params.userId) })
      if (!p) return apiError(404, 'not_found', 'Not found.')
      const body = await readJson<{ reason?: string; days?: number; report_id?: string }>(request)
      const problems: ApiFieldError[] = []
      const reason = checkText('reason', body.reason, REASON_LIMITS.min, REASON_LIMITS.max)
      if (reason) problems.push(reason)
      if (
        action === 'suspend' &&
        !(Number.isInteger(body.days) && (body.days ?? 0) >= 1 && (body.days ?? 0) <= 365)
      ) {
        problems.push({ field: 'days', code: 'out_of_range', message: 'Choose 1 to 365 days.' })
      }
      if (problems.length > 0) return bad(...problems)
      const forbidden = sanctionBlock(p)
      if (forbidden) return forbidden
      const allowed = action === 'ban' ? ['active', 'suspended'] : ['active']
      if (!allowed.includes(p.userStatus)) return invalidState(p.userStatus)

      const startsAt = nowIso()
      const endsAt =
        action === 'suspend'
          ? new Date(Date.now() + (body.days ?? 0) * 24 * HOUR).toISOString()
          : null
      const sanction: Sanction = {
        id: newId(state(), 'a8'),
        type: action === 'warn' ? 'warning' : action === 'suspend' ? 'suspension' : 'ban',
        reason: (body.reason ?? '').trim(),
        report_id: body.report_id ?? null,
        starts_at: startsAt,
        ends_at: endsAt,
        created_by_email: db.me.user.email,
        revoked_at: null,
        revoked_by_email: null,
      }
      p.sanctions.unshift(sanction)
      if (action === 'suspend') {
        p.userStatus = 'suspended'
        p.profileStatus = 'suspended'
        p.suspendedUntil = endsAt
        p.statusReason = sanction.reason
      } else if (action === 'ban') {
        p.userStatus = 'banned'
        p.statusReason = sanction.reason
      }
      logAudit(`user.${action}`, 'user', p.userId, {
        reason: sanction.reason,
        ...(action === 'suspend' ? { days: body.days, ends_at: endsAt } : {}),
        report_id: body.report_id ?? null,
        sanction_id: sanction.id,
      })
      return noContent()
    }),
  ),

  ...(['unsuspend', 'unban'] as const).map((action) =>
    http.post(apiUrl(`/v1/admin/users/:userId/${action}`), ({ params }) => {
      const blocked = denied(action === 'unban' ? 'admin' : 'moderator')
      if (blocked) return blocked
      const p = personOf(state(), { userId: String(params.userId) })
      if (!p) return apiError(404, 'not_found', 'Not found.')
      const from = action === 'unsuspend' ? 'suspended' : 'banned'
      if (p.userStatus !== from) return invalidState(p.userStatus)
      const type = action === 'unsuspend' ? 'suspension' : 'ban'
      const sanction = p.sanctions.find((entry) => entry.type === type && !entry.revoked_at)
      if (sanction) {
        sanction.revoked_at = nowIso()
        sanction.revoked_by_email = db.me.user.email
      }
      p.userStatus = 'active'
      p.profileStatus = 'active'
      p.suspendedUntil = null
      p.statusReason = null
      logAudit(`user.${action}`, 'user', p.userId, { sanction_id: sanction?.id ?? null })
      return noContent()
    }),
  ),

  http.patch(apiUrl('/v1/admin/users/:userId/role'), async ({ params, request }) => {
    const blocked = denied('admin')
    if (blocked) return blocked
    const p = personOf(state(), { userId: String(params.userId) })
    if (!p) return apiError(404, 'not_found', 'Not found.')
    const body = await readJson<{ role?: string }>(request)
    const newRole = body.role
    if (!newRole || !isOneOf(USER_ROLES, newRole)) {
      return bad({ field: 'role', code: 'unknown_code', message: 'Choose a role.' })
    }
    // Nobody can change their own role, so the last admin cannot be removed (18 section 2).
    if (p.isMe) return apiError(403, 'forbidden', 'You cannot change your own role.')
    if (p.userStatus !== 'active') return invalidState(p.userStatus)
    const from = roleOf(p)
    p.role = newRole
    logAudit('user.role_change', 'user', p.userId, { from, to: newRole })
    return noContent()
  }),

  // Castes -----------------------------------------------------------------
  http.get(apiUrl('/v1/admin/caste-suggestions'), ({ request }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const status = new URL(request.url).searchParams.get('status') ?? 'pending'
    const items = state()
      .suggestions.filter((item) => item.status === status)
      .sort((a, b) => b.usage_count - a.usage_count)
    return HttpResponse.json(paginate(items, request))
  }),

  http.post(apiUrl('/v1/admin/caste-suggestions/:id/promote'), async ({ params, request }) => {
    const blocked = denied('admin')
    if (blocked) return blocked
    const s = state()
    const suggestion = s.suggestions.find((item) => item.id === params.id)
    if (!suggestion) return apiError(404, 'not_found', 'Not found.')
    const body = await readJson<{
      code?: string
      name?: string
      name_ur?: string
      parent_code?: string
    }>(request)
    const problems: ApiFieldError[] = []
    if (!body.code || !/^[a-z][a-z0-9_]*$/.test(body.code)) {
      problems.push({
        field: 'code',
        code: 'invalid',
        message: 'Use lowercase letters, digits and underscores.',
      })
    }
    if (!body.name?.trim())
      problems.push({ field: 'name', code: 'required', message: 'Enter a name.' })
    if (body.parent_code) {
      const parent = s.castes.find((caste) => caste.code === body.parent_code)
      if (!parent || parent.parent_code) {
        problems.push({
          field: 'parent_code',
          code: 'invalid',
          message: 'The parent must be a top-level caste.',
        })
      } else if (body.code && !body.code.startsWith(`${body.parent_code}_`)) {
        problems.push({
          field: 'code',
          code: 'invalid',
          message: 'A sub-caste code starts with its parent code.',
        })
      }
    }
    if (problems.length > 0) return bad(...problems)
    if (suggestion.status !== 'pending') return invalidState(suggestion.status)
    if (s.castes.some((caste) => caste.code === body.code)) {
      return apiError(409, 'already_exists', 'This code is already used.')
    }
    s.castes.push({
      code: body.code as string,
      name: (body.name as string).trim(),
      name_ur: body.name_ur ?? null,
      parent_code: body.parent_code ?? null,
      aliases: [],
      sort_order: 500,
      is_active: true,
    })
    suggestion.status = 'promoted'
    logAudit('caste_suggestion.promote', 'caste_suggestion', suggestion.id, {
      code: body.code,
      profiles_updated: suggestion.usage_count,
    })
    return noContent()
  }),

  http.post(apiUrl('/v1/admin/caste-suggestions/:id/reject'), ({ params }) => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    const suggestion = state().suggestions.find((item) => item.id === params.id)
    if (!suggestion) return apiError(404, 'not_found', 'Not found.')
    if (suggestion.status !== 'pending') return invalidState(suggestion.status)
    suggestion.status = 'rejected'
    logAudit('caste_suggestion.reject', 'caste_suggestion', suggestion.id, {
      name: suggestion.name,
    })
    return noContent()
  }),

  http.get(apiUrl('/v1/admin/castes'), () => {
    const blocked = denied('moderator')
    if (blocked) return blocked
    return HttpResponse.json({ items: state().castes })
  }),

  http.post(apiUrl('/v1/admin/castes'), async ({ request }) => {
    const blocked = denied('admin')
    if (blocked) return blocked
    const s = state()
    const body = await readJson<Partial<AdminCaste> & { sort_order?: number }>(request)
    if (!body.code || !/^[a-z][a-z0-9_]*$/.test(body.code)) {
      return bad({
        field: 'code',
        code: 'invalid',
        message: 'Use lowercase letters, digits and underscores.',
      })
    }
    if (!body.name?.trim())
      return bad({ field: 'name', code: 'required', message: 'Enter a name.' })
    if (body.parent_code) {
      const parent = s.castes.find((caste) => caste.code === body.parent_code)
      if (!parent || parent.parent_code) {
        return bad({
          field: 'parent_code',
          code: 'invalid',
          message: 'The parent must be a top-level caste.',
        })
      }
    }
    if (s.castes.some((caste) => caste.code === body.code)) {
      return apiError(409, 'already_exists', 'This code is already used.')
    }
    s.castes.push({
      code: body.code,
      name: body.name.trim(),
      name_ur: body.name_ur ?? null,
      parent_code: body.parent_code ?? null,
      aliases: body.aliases ?? [],
      sort_order: body.sort_order ?? 500,
      is_active: true,
    })
    logAudit('caste.create', 'caste', body.code, {
      name: body.name,
      parent_code: body.parent_code ?? null,
    })
    return new HttpResponse(null, { status: 201 })
  }),

  http.patch(apiUrl('/v1/admin/castes/:code'), async ({ params, request }) => {
    const blocked = denied('admin')
    if (blocked) return blocked
    const s = state()
    const caste = s.castes.find((entry) => entry.code === params.code)
    if (!caste) return apiError(404, 'not_found', 'Not found.')
    const body = await readJson<Partial<AdminCaste>>(request)
    if (
      body.is_active === false &&
      s.castes.some((entry) => entry.parent_code === caste.code && entry.is_active)
    ) {
      return invalidState('has_active_sub_castes')
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of ['name', 'name_ur', 'aliases', 'sort_order', 'is_active'] as const) {
      if (body[key] !== undefined) {
        changes[key] = { from: caste[key], to: body[key] }
        ;(caste as Record<string, unknown>)[key] = body[key]
      }
    }
    logAudit('caste.update', 'caste', caste.code, { changes })
    return noContent()
  }),

  // Settings ---------------------------------------------------------------
  http.get(apiUrl('/v1/admin/settings'), () => {
    const blocked = denied('admin')
    if (blocked) return blocked
    const s = state()
    const items: AdminSetting[] = Object.keys(SETTING_DEFAULTS).map((key) => {
      const row = s.settings.get(key)
      return {
        key,
        value: row ? row.value : SETTING_DEFAULTS[key],
        default: SETTING_DEFAULTS[key],
        updated_by_email: row?.by ?? null,
        updated_at: row?.at ?? null,
      }
    })
    return HttpResponse.json({ items })
  }),

  http.put(apiUrl('/v1/admin/settings/:key'), async ({ params, request }) => {
    const blocked = denied('admin')
    if (blocked) return blocked
    const s = state()
    const key = String(params.key)
    if (!(key in SETTING_DEFAULTS)) return apiError(404, 'not_found', 'Unknown setting.')
    const body = await readJson<{ value?: unknown }>(request)
    const current = Object.fromEntries(
      Object.keys(SETTING_DEFAULTS).map((name) => [
        name,
        s.settings.get(name)?.value ?? SETTING_DEFAULTS[name],
      ]),
    )
    const problem = SETTING_RULES[key] ? validateSetting(key, body.value, current) : null
    if (problem)
      return bad({
        field: 'value',
        code: problem.code === 'required' ? 'invalid' : 'out_of_range',
        message: 'This value is not allowed.',
      })
    const from = current[key]
    s.settings.set(key, { value: body.value, by: db.me.user.email, at: nowIso() })
    logAudit('setting.update', 'app_setting', key, { from, to: body.value })
    return noContent()
  }),

  // Releases and announcements ---------------------------------------------
  http.get(apiUrl('/v1/admin/releases'), ({ request }) => {
    const blocked = denied('admin')
    if (blocked) return blocked
    const items = [...state().releases].sort((a, b) => b.version_code - a.version_code)
    return HttpResponse.json(paginate(items, request))
  }),

  http.post(apiUrl('/v1/admin/releases'), async ({ request }) => {
    const blocked = denied('admin')
    if (blocked) return blocked
    const s = state()
    const body = await readJson<Partial<AdminRelease>>(request)
    const latest = Math.max(0, ...s.releases.map((release) => release.version_code))
    const currentMin = Math.max(
      0,
      ...s.releases.map((release) => release.min_supported_version_code),
    )
    const problems: ApiFieldError[] = []
    if (!Number.isInteger(body.version_code) || (body.version_code as number) <= latest) {
      problems.push({
        field: 'version_code',
        code: 'out_of_range',
        message: `Must be greater than ${latest}.`,
      })
    }
    if (!body.version_name?.trim()) {
      problems.push({ field: 'version_name', code: 'required', message: 'Enter a version name.' })
    }
    const min = body.min_supported_version_code
    if (
      !Number.isInteger(min) ||
      (min as number) > (body.version_code ?? 0) ||
      (min as number) < currentMin
    ) {
      problems.push({
        field: 'min_supported_version_code',
        code: 'out_of_range',
        message: 'Not allowed.',
      })
    }
    if (!body.download_url?.startsWith('https://download.')) {
      problems.push({
        field: 'download_url',
        code: 'invalid',
        message: 'Must start with https://download.',
      })
    }
    if (body.release_notes && body.release_notes.length > 1000) {
      problems.push({
        field: 'release_notes',
        code: 'too_long',
        message: 'Write at most 1,000 characters.',
      })
    }
    if (problems.length > 0) return bad(...problems)
    const release: AdminRelease = {
      id: newId(s, 'a9'),
      platform: 'android',
      version_code: body.version_code as number,
      version_name: (body.version_name as string).trim(),
      min_supported_version_code: min as number,
      download_url: body.download_url as string,
      release_notes: body.release_notes ?? null,
      released_at: nowIso(),
    }
    s.releases.push(release)
    logAudit('release.create', 'app_release', release.id, {
      version_code: release.version_code,
      min_supported_version_code: release.min_supported_version_code,
    })
    return HttpResponse.json(release, { status: 201 })
  }),

  http.post(apiUrl('/v1/admin/announcements'), async ({ request }) => {
    const blocked = denied('admin')
    if (blocked) return blocked
    const s = state()
    const body = await readJson<{ text_en?: string; text_ur?: string; url?: string }>(request)
    const problems: ApiFieldError[] = []
    const text = checkText('text_en', body.text_en, 1, 300)
    if (text) problems.push(text)
    if (body.url && !body.url.startsWith('https://')) {
      problems.push({ field: 'url', code: 'invalid', message: 'Must start with https://' })
    }
    if (problems.length > 0) return bad(...problems)
    if (s.lastAnnouncementAt && Date.now() - s.lastAnnouncementAt < 24 * HOUR) {
      return apiError(429, 'limit_reached', 'An announcement was already sent today.', {
        details: {
          limit: 1,
          used: 1,
          resets_at: new Date(s.lastAnnouncementAt + 24 * HOUR).toISOString(),
        },
      })
    }
    s.lastAnnouncementAt = Date.now()
    const estimate = 640
    logAudit('announcement.send', 'app_setting', 'announcement', {
      text_en: body.text_en,
      url: body.url ?? null,
      recipients_estimate: estimate,
    })
    return HttpResponse.json({ recipients_estimate: estimate }, { status: 202 })
  }),

  // Audit log --------------------------------------------------------------
  http.get(apiUrl('/v1/admin/audit-log'), ({ request }) => {
    const blocked = denied('admin')
    if (blocked) return blocked
    const params = new URL(request.url).searchParams
    const items = state()
      .audit.filter(
        (entry) =>
          (!params.get('actor_user_id') || entry.actor.user_id === params.get('actor_user_id')) &&
          (!params.get('target_type') || entry.target_type === params.get('target_type')) &&
          (!params.get('target_id') || entry.target_id === params.get('target_id')) &&
          (!params.get('action') || entry.action === params.get('action')),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    return HttpResponse.json(paginate(items, request))
  }),
]

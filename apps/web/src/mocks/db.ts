import type {
  BlockEntry,
  Connection,
  IdentitySummary,
  Interest,
  Me,
  Message,
  NotificationItem,
  NotificationPreferences,
  OwnPhoto,
  OwnProfile,
  PhotoAccessEntry,
  Preferences,
  Privacy,
  ProfileDetail,
  SavedSearch,
  ShortlistEntry,
  VerificationRequest,
} from '~/lib/api-types'
import {
  makeConnection,
  makeInterest,
  makeMe,
  makeMessage,
  makeNotification,
  makeOwnPhoto,
  makeOwnProfile,
  makePhotoView,
  makePreferences,
  makePrivacy,
  makeProfileCard,
  makeProfileDetail,
  placeholderPhotoUrl,
} from './factories'
import { cities } from './fixtures/geography'

/**
 * The in-memory database of the mock API (development `--mode mock` and unit tests).
 * Handlers in `src/mocks/handlers/*` read and change it. `resetDb()` restores a scenario.
 *
 * Scenarios let a developer see every gate without a backend: open any page with
 * `?mock_scenario=<name>` in mock mode (see `src/mocks/browser.ts`).
 */
export type MockScenario =
  | 'active'
  | 'new'
  | 'onboarding_midway'
  | 'onboarding_review'
  | 'pending_review'
  | 'changes_requested'
  | 'consent_required'
  | 'paused'
  | 'closed'
  | 'suspended'
  | 'banned'
  | 'deletion_scheduled'
  | 'admin'

export const MOCK_SCENARIOS: readonly MockScenario[] = [
  'active',
  'new',
  'onboarding_midway',
  'onboarding_review',
  'pending_review',
  'changes_requested',
  'consent_required',
  'paused',
  'closed',
  'suspended',
  'banned',
  'deletion_scheduled',
  'admin',
]

export type MockDb = {
  scenario: MockScenario
  me: Me
  ownProfile: OwnProfile
  /** null until the first PUT (GET then answers the computed defaults). */
  preferences: Preferences | null
  privacy: Privacy
  ownPhotos: OwnPhoto[]
  identity: IdentitySummary | null
  verificationRequests: VerificationRequest[]
  notificationPreferences: NotificationPreferences
  /** Other members, by profile id. */
  profiles: Map<string, ProfileDetail>
  interests: Interest[]
  connections: Connection[]
  messages: Map<string, Message[]>
  shortlist: ShortlistEntry[]
  passes: Set<string>
  blocks: BlockEntry[]
  photoAccess: { received: PhotoAccessEntry[]; sent: PhotoAccessEntry[] }
  notifications: NotificationItem[]
  savedSearches: SavedSearch[]
  /** Free-form state a feature's handlers may keep (key it by feature name). */
  extra: Record<string, unknown>
}

const MALE_NAMES = [
  ['Ahmed', 'R'],
  ['Bilal', 'K'],
  ['Usman', 'A'],
  ['Hamza', 'S'],
  ['Ali', 'H'],
  ['Faisal', 'M'],
  ['Zain', 'T'],
  ['Omar', 'F'],
  ['Saad', 'J'],
  ['Hassan', 'N'],
  ['Imran', 'Q'],
  ['Kashif', 'B'],
  ['Danish', 'I'],
  ['Fahad', 'Z'],
  ['Junaid', 'C'],
  ['Talha', 'W'],
  ['Arslan', 'D'],
  ['Waqas', 'L'],
  ['Shahzaib', 'U'],
  ['Moiz', 'E'],
  ['Haris', 'G'],
  ['Asad', 'P'],
  ['Rehan', 'V'],
  ['Nabeel', 'Y'],
] as const

const FEMALE_NAMES = [
  ['Ayesha', 'K'],
  ['Fatima', 'R'],
  ['Zainab', 'A'],
  ['Maryam', 'S'],
  ['Hira', 'H'],
  ['Sana', 'M'],
  ['Amna', 'T'],
  ['Iqra', 'F'],
  ['Mahnoor', 'J'],
  ['Rabia', 'N'],
  ['Khadija', 'Q'],
  ['Noor', 'B'],
] as const

const EDUCATION = ['bachelors', 'masters', 'professional', 'mphil', 'intermediate', 'doctorate']
const PROFESSIONS = ['software_it', 'engineer', 'doctor', 'teacher', 'banker', 'accountant_auditor']
const EMPLOYMENT: ProfileDetail['card']['employment_type'][] = [
  'private_job',
  'government_job',
  'business_owner',
  'self_employed',
]
const CASTES = ['Arain', 'Awan', 'Rajput', 'Jutt', null, 'Syed', 'Sheikh', null, 'Mughal']
const LANGS = ['urdu', 'punjabi', 'pashto', 'sindhi', 'saraiki']
const REASONS = [
  ['same_city', 'education_fits'],
  ['same_sect', 'family_values_fit', 'age_fits'],
  ['same_mother_tongue', 'you_meet_their_preferences'],
  ['religiosity_fits', 'same_city', 'education_fits'],
  [],
]
const LAST_ACTIVE = ['online', 'today', 'this_week', 'this_month', 'earlier', null] as const

/** A valid profile code (04 section 5: `KR` and 8 Crockford base32 characters), unique per i. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function mockPublicCode(i: number): string {
  let n = i + 1
  let digits = ''
  while (n > 0) {
    digits = (CROCKFORD[n % 32] ?? '0') + digits
    n = Math.floor(n / 32)
  }
  return `KR7F${digits.padStart(6, '0')}`
}

function seededProfiles(gender: 'male' | 'female', count: number): ProfileDetail[] {
  const names = gender === 'male' ? MALE_NAMES : FEMALE_NAMES
  const pkCities = cities.filter((city) => city.country_code === 'PK').slice(0, 10)
  const list: ProfileDetail[] = []
  for (let i = 0; i < count; i += 1) {
    const [first, initial] = names[i % names.length] ?? ['Member', 'X']
    const city = pkCities[i % pkCities.length]
    const id = `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
    const blurred = i % 5 === 3
    const noPhoto = i % 7 === 6
    const photo = noPhoto
      ? null
      : {
          ...makePhotoView({ is_blurred: blurred }),
          id: `${id.slice(0, -4)}ph01`,
          thumb_url: placeholderPhotoUrl(first, (i * 37) % 360, blurred),
          medium_url: placeholderPhotoUrl(first, (i * 37) % 360, blurred),
          large_url: blurred ? null : placeholderPhotoUrl(first, (i * 37) % 360),
        }
    const card = makeProfileCard({
      id,
      public_code: mockPublicCode(i),
      display_name: `${first} ${initial}.`,
      age: 24 + (i % 10),
      gender,
      managed_by: i % 4 === 1 ? 'parent' : 'self',
      height_cm: gender === 'male' ? 168 + (i % 15) : 152 + (i % 12),
      marital_status: i % 9 === 8 ? 'divorced' : 'never_married',
      sect_code: i % 3 === 0 ? 'sunni' : i % 3 === 1 ? 'sunni_barelvi' : 'shia',
      caste_label: CASTES[i % CASTES.length] ?? null,
      mother_tongue_code: LANGS[i % LANGS.length] ?? 'urdu',
      city_name: city?.name ?? 'Lahore',
      region_name: city?.region_name ?? 'Punjab',
      education_level_code: EDUCATION[i % EDUCATION.length] ?? 'bachelors',
      employment_type: EMPLOYMENT[i % EMPLOYMENT.length] ?? 'private_job',
      profession_code: PROFESSIONS[i % PROFESSIONS.length] ?? null,
      photo,
      photo_count: photo ? 1 + (i % 4) : 0,
      badges: i % 4 === 0 ? ['id_verified', 'photo_verified'] : i % 6 === 1 ? ['new'] : [],
      last_active: LAST_ACTIVE[i % LAST_ACTIVE.length] ?? null,
      compat: 95 - ((i * 3) % 40),
      reasons: REASONS[i % REASONS.length] ?? [],
    })
    const photos = photo
      ? Array.from({ length: card.photo_count }, (_, n) => ({
          ...photo,
          id: `${id.slice(0, -4)}ph0${n + 1}`,
          is_primary: n === 0,
        }))
      : []
    list.push(
      makeProfileDetail({
        card,
        photos,
        is_online: card.last_active === 'online',
        about_me:
          i % 2 === 0
            ? 'I value honesty, family and faith. I enjoy reading and travelling with family.'
            : null,
        locked: blurred ? ['photos', 'income'] : ['income'],
        relation: { photo_access: blurred ? 'can_request' : 'visible' },
        looking_for: {
          lines: [
            {
              dimension: 'age',
              summary_values: ['24', '30'],
              importance: 'high',
              viewer_matches: true,
            },
            {
              dimension: 'religion',
              summary_values: ['islam'],
              importance: 'must',
              viewer_matches: true,
            },
            {
              dimension: 'education',
              summary_values: ['bachelors'],
              importance: 'medium',
              viewer_matches: i % 2 === 0,
            },
          ],
          matched: i % 2 === 0 ? 3 : 2,
          total: 3,
        },
        compatibility: {
          compat: card.compat ?? 70,
          reasons: card.reasons,
          viewer_fit: 80,
          owner_fit: 75,
          dimensions: [
            { dimension: 'age', importance: 'high', score: 1, matched: true },
            { dimension: 'religion', importance: 'must', score: 1, matched: true },
            { dimension: 'location', importance: 'medium', score: 0.5, matched: false },
          ],
        },
      }),
    )
  }
  return list
}

function activeMe(): Me {
  return makeMe({
    profile: {
      photo: makeOwnPhoto(),
      badges: ['photo_verified'],
      completeness: 78,
    },
    counters: {
      unread_chats: 1,
      pending_interests: 2,
      pending_photo_requests: 1,
      unread_notifications: 3,
    },
    usage: { interests_sent_today: 2, interests_per_day: 10 },
  })
}

function createDb(scenario: MockScenario): MockDb {
  const me = activeMe()
  const ownProfile = makeOwnProfile({
    location: {
      ...makeOwnProfile().location,
      region_id: 6,
      city_id: 1001,
      city: { id: 1001, name: 'Lahore', region_id: 6, region_name: 'Punjab', country_code: 'PK' },
    },
    photos: [makeOwnPhoto({ id: '20000000-0000-4000-8000-000000000001' })],
  })
  const profiles = seededProfiles('male', 36)
  const byId = new Map(profiles.map((profile) => [profile.card.id, profile]))

  const db: MockDb = {
    scenario,
    me,
    ownProfile,
    preferences: makePreferences(),
    privacy: makePrivacy(),
    ownPhotos: ownProfile.photos,
    identity: {
      document_type: 'cnic',
      number_masked: '*********1234',
      status: 'unverified',
      verified_at: null,
    },
    verificationRequests: [],
    notificationPreferences: {
      push_interests: true,
      push_messages: true,
      push_photo_requests: true,
      push_profile_views: false,
      push_matches: true,
      email_interests: true,
      email_messages: false,
      email_match_digest: 'weekly',
      email_announcements: true,
      quiet_hours_start: null,
      quiet_hours_end: null,
    },
    profiles: byId,
    interests: [],
    connections: [],
    messages: new Map(),
    shortlist: [],
    passes: new Set(),
    blocks: [],
    photoAccess: { received: [], sent: [] },
    notifications: [],
    savedSearches: [],
    extra: {},
  }

  // Two received interests, one sent.
  for (const [index, direction] of (['received', 'received', 'sent'] as const).entries()) {
    const profile = profiles[index + 2]
    if (!profile) continue
    profile.card.relation.interest_status = 'pending'
    profile.card.relation.interest_direction = direction
    profile.card.relation.tier =
      direction === 'received' ? 'interest_from_owner' : 'interest_to_owner'
    profile.relation.tier = profile.card.relation.tier
    const interest = makeInterest({
      id: `30000000-0000-4000-8000-00000000000${index + 1}`,
      direction,
      message:
        direction === 'received' ? 'Assalam o Alaikum. Our families may get along well.' : null,
      profile: profile.card,
      compat_score: profile.card.compat,
    })
    profile.relation.interest = {
      id: interest.id,
      direction,
      status: 'pending',
      message: interest.message,
      created_at: interest.created_at,
      expires_at: interest.expires_at,
    }
    db.interests.push(interest)
  }

  // Two connections with a short conversation.
  for (const index of [0, 1]) {
    const profile = profiles[index]
    if (!profile) continue
    const connectionId = `40000000-0000-4000-8000-00000000000${index + 1}`
    profile.card.relation.tier = 'connection'
    profile.card.relation.connection_id = connectionId
    profile.relation.tier = 'connection'
    profile.relation.connection_id = connectionId
    profile.locked = []
    const messages: Message[] = [
      makeMessage({
        id: `50000000-0000-4000-8000-0000000${index}0001`,
        connection_id: connectionId,
        sender: 'system',
        kind: 'system',
        body: null,
        system_event: 'connected',
        created_at: '2026-11-15T09:00:00Z',
      }),
      makeMessage({
        id: `50000000-0000-4000-8000-0000000${index}0002`,
        connection_id: connectionId,
        sender: 'them',
        body: 'Assalam o Alaikum, thank you for accepting.',
        created_at: '2026-11-15T09:05:00Z',
      }),
      makeMessage({
        id: `50000000-0000-4000-8000-0000000${index}0003`,
        connection_id: connectionId,
        sender: 'me',
        body: 'Walaikum Assalam. Happy to talk.',
        created_at: '2026-11-15T09:20:00Z',
      }),
    ]
    if (index === 0) {
      messages.push(
        makeMessage({
          id: '50000000-0000-4000-8000-000000000004',
          connection_id: connectionId,
          sender: 'them',
          body: 'Could you tell me a little about your family?',
          created_at: '2026-11-19T18:30:00Z',
        }),
      )
    }
    db.messages.set(connectionId, messages)
    const last = messages[messages.length - 1]
    db.connections.push(
      makeConnection({
        id: connectionId,
        other: profile.card,
        last_message_at: last?.created_at ?? null,
        last_message_preview: last?.body ?? null,
        unread_count: index === 0 ? 1 : 0,
        created_at: '2026-11-15T09:00:00Z',
      }),
    )
  }

  // A received photo request.
  const requester = profiles[5]
  if (requester) {
    db.photoAccess.received.push({
      id: '60000000-0000-4000-8000-000000000001',
      profile_id: requester.card.id,
      status: 'pending',
      created_at: '2026-11-18T12:00:00Z',
      profile: requester.card,
    })
  }

  // A few notifications.
  db.notifications.push(
    makeNotification({
      id: '70000000-0000-4000-8000-000000000001',
      type: 'interest_received',
      actor: {
        profile_id: profiles[2]?.card.id ?? '',
        display_name: profiles[2]?.card.display_name ?? '',
        photo: profiles[2]?.card.photo ?? null,
      },
      data: { interest_id: db.interests[0]?.id, profile_id: profiles[2]?.card.id },
      created_at: '2026-11-19T10:00:00Z',
    }),
    makeNotification({
      id: '70000000-0000-4000-8000-000000000002',
      type: 'photo_approved',
      actor: null,
      data: { photo_id: ownProfile.photos[0]?.id },
      created_at: '2026-11-18T10:00:00Z',
    }),
    makeNotification({
      id: '70000000-0000-4000-8000-000000000003',
      type: 'profile_views_summary',
      actor: null,
      data: { count: 6 },
      created_at: '2026-11-17T10:00:00Z',
    }),
  )

  applyScenario(db, scenario)
  return db
}

function applyScenario(db: MockDb, scenario: MockScenario) {
  const { me } = db
  switch (scenario) {
    case 'new':
    case 'onboarding_midway': {
      const step = scenario === 'new' ? 'account_for' : 'education_career'
      me.gate = 'onboarding'
      me.profile.status = 'draft'
      me.profile.onboarding_step = step
      me.profile.photo = null
      me.profile.badges = []
      me.profile.completeness = scenario === 'new' ? 0 : 35
      me.counters = {
        unread_chats: 0,
        pending_interests: 0,
        pending_photo_requests: 0,
        unread_notifications: 0,
      }
      db.ownProfile = {
        ...makeOwnProfile({
          status: 'draft',
          onboarding_step: step,
          completeness: me.profile.completeness,
        }),
        photos: [],
      }
      if (scenario === 'new') {
        db.ownProfile.account_for = { managed_by: null, manager_name: null }
        db.ownProfile.basics = {
          first_name: null,
          last_name: null,
          gender: null,
          date_of_birth: null,
          marital_status: null,
          children_status: null,
          children_count: null,
          current_wives_count: null,
          height_cm: null,
        }
        me.profile.first_name = null
        me.profile.gender = null
        me.profile.managed_by = null
      }
      db.ownPhotos = []
      db.preferences = null
      db.identity = null
      db.interests = []
      db.connections = []
      db.notifications = []
      db.photoAccess = { received: [], sent: [] }
      break
    }
    case 'onboarding_review': {
      // Every step done: only the completion request is left (07 section 14).
      me.gate = 'onboarding'
      me.profile.status = 'draft'
      me.profile.onboarding_step = 'review'
      db.ownProfile.status = 'draft'
      db.ownProfile.onboarding_step = 'review'
      me.counters = {
        unread_chats: 0,
        pending_interests: 0,
        pending_photo_requests: 0,
        unread_notifications: 0,
      }
      db.interests = []
      db.connections = []
      db.notifications = []
      db.photoAccess = { received: [], sent: [] }
      break
    }
    case 'pending_review':
    case 'changes_requested':
      me.gate = scenario
      me.profile.status = scenario
      me.profile.status_reason =
        scenario === 'changes_requested' ? 'Please add a clearer description in About me.' : null
      db.ownProfile.status = scenario
      db.ownProfile.status_reason = me.profile.status_reason
      break
    case 'consent_required':
      me.gate = 'consent_required'
      me.consents_required = ['terms', 'privacy']
      break
    case 'paused':
    case 'closed':
      me.profile.status = scenario
      db.ownProfile.status = scenario
      break
    case 'suspended':
      me.gate = 'suspended'
      me.user.status = 'suspended'
      me.user.status_reason = 'harassment'
      me.user.suspended_until = '2026-12-04T00:00:00Z'
      break
    case 'banned':
      me.gate = 'banned'
      me.user.status = 'banned'
      me.user.status_reason = 'fake_profile'
      break
    case 'deletion_scheduled':
      me.gate = 'deletion_scheduled'
      me.user.status = 'deletion_scheduled'
      me.user.purge_after = '2026-12-20T00:00:00Z'
      break
    case 'admin':
      me.user.role = 'admin'
      break
    default:
      break
  }
}

export let db: MockDb = createDb('active')

export function resetDb(scenario: MockScenario = 'active') {
  db = createDb(scenario)
  return db
}

export function isMockScenario(value: unknown): value is MockScenario {
  return typeof value === 'string' && (MOCK_SCENARIOS as readonly string[]).includes(value)
}

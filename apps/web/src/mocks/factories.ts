import type {
  Connection,
  Interest,
  Me,
  Message,
  NotificationItem,
  OwnPhoto,
  OwnProfile,
  PhotoView,
  Preferences,
  Privacy,
  ProfileCard,
  ProfileDetail,
} from '~/lib/api-types'

/**
 * Factories for API objects, shared by unit tests and the development mock API. Each takes
 * a partial override; nested objects are merged one level deep where that is convenient.
 */

let counter = 0
/** A deterministic UUID-shaped id, unique within the process. */
export function mockId(prefix = '0000'): string {
  counter += 1
  const tail = counter.toString(16).padStart(12, '0')
  return `${prefix.padStart(8, '0').slice(0, 8)}-0000-4000-8000-${tail}`
}

/** A small inline SVG used as a photo in mocks: no network, no member data. */
export function placeholderPhotoUrl(label: string, hue = 170, blurred = false): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,70%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},45%,45%)"/></linearGradient>${blurred ? '<filter id="b"><feGaussianBlur stdDeviation="18"/></filter>' : ''}</defs><rect width="400" height="500" fill="url(#g)"/><g ${blurred ? 'filter="url(#b)"' : ''}><circle cx="200" cy="190" r="80" fill="rgba(255,255,255,.55)"/><rect x="90" y="300" width="220" height="160" rx="100" fill="rgba(255,255,255,.55)"/></g><text x="200" y="480" font-family="sans-serif" font-size="22" text-anchor="middle" fill="rgba(0,0,0,.45)">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function makePhotoView(overrides: Partial<PhotoView> = {}): PhotoView {
  const blurred = overrides.is_blurred ?? false
  const url = placeholderPhotoUrl('photo', 170, blurred)
  return {
    id: mockId('ph'),
    is_primary: true,
    is_blurred: blurred,
    thumb_url: url,
    medium_url: url,
    large_url: blurred ? null : url,
    ...overrides,
  }
}

export function makeOwnPhoto(overrides: Partial<OwnPhoto> = {}): OwnPhoto {
  const status = overrides.status ?? 'approved'
  const url = status === 'processing' ? null : placeholderPhotoUrl('me', 30)
  return {
    id: mockId('op'),
    status,
    rejection_reason: null,
    is_primary: true,
    position: 0,
    thumb_url: url,
    medium_url: url,
    large_url: url,
    created_at: '2026-11-01T10:00:00Z',
    ...overrides,
  }
}

type MeOverrides = {
  user?: Partial<Me['user']>
  profile?: Partial<Me['profile']>
  counters?: Partial<Me['counters']>
  usage?: Partial<Me['usage']>
  config?: Partial<Me['config']>
} & Partial<Omit<Me, 'user' | 'profile' | 'counters' | 'usage' | 'config'>>

export function makeMe(overrides: MeOverrides = {}): Me {
  const { user, profile, counters, usage, config, ...rest } = overrides
  return {
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'member@example.com',
      email_verified: true,
      phone_e164: null,
      phone_verified: false,
      role: 'member',
      status: 'active',
      status_reason: null,
      suspended_until: null,
      purge_after: null,
      locale: 'en',
      timezone: 'Asia/Karachi',
      created_at: '2026-11-01T10:00:00Z',
      ...user,
    },
    profile: {
      id: '00000000-0000-4000-8000-0000000000a1',
      public_code: 'KR7Q2M',
      status: 'active',
      status_reason: null,
      onboarding_step: 'done',
      first_name: 'Ayesha',
      gender: 'female',
      managed_by: 'self',
      photo: null,
      completeness: 80,
      badges: [],
      ...profile,
    },
    gate: 'ok',
    consents_required: [],
    counters: {
      unread_chats: 0,
      pending_interests: 0,
      pending_photo_requests: 0,
      unread_notifications: 0,
      ...counters,
    },
    usage: { interests_sent_today: 0, interests_per_day: 10, ...usage },
    config: {
      identity_required: true,
      photo_required: false,
      photos_max: 6,
      legal: {
        terms_version: '2026-11-20',
        privacy_version: '2026-11-20',
        guidelines_version: '2026-11-20',
      },
      support_email: 'support@example.com',
      deletion_grace_days: 30,
      announcement: null,
      ...config,
    },
    ...rest,
  }
}

export function makeProfileCard(
  overrides: Partial<Omit<ProfileCard, 'relation'>> & {
    relation?: Partial<ProfileCard['relation']>
  } = {},
): ProfileCard {
  const { relation, ...rest } = overrides
  return {
    id: mockId('pc'),
    public_code: 'KR4X9P',
    display_name: 'Ahmed R.',
    age: 29,
    gender: 'male',
    managed_by: 'self',
    height_cm: 178,
    marital_status: 'never_married',
    religion_code: 'islam',
    sect_code: 'sunni',
    caste_label: null,
    mother_tongue_code: 'urdu',
    city_name: 'Lahore',
    region_name: 'Punjab',
    country_code: 'PK',
    education_level_code: 'masters',
    employment_type: 'private_job',
    profession_code: null,
    photo: makePhotoView(),
    photo_count: 1,
    badges: [],
    last_active: 'today',
    compat: 82,
    reasons: [],
    relation: {
      tier: 'member',
      interest_status: null,
      interest_direction: null,
      connection_id: null,
      is_shortlisted: false,
      can_send_interest: true,
      ...relation,
    },
    ...rest,
  }
}

export function makeProfileDetail(
  overrides: Partial<Omit<ProfileDetail, 'relation'>> & {
    relation?: Partial<ProfileDetail['relation']>
  } = {},
): ProfileDetail {
  const { relation, ...rest } = overrides
  const card = overrides.card ?? makeProfileCard()
  return {
    card,
    is_online: false,
    photos: card.photo ? [card.photo] : [],
    basics: {
      marital_status: card.marital_status,
      children_status: null,
      children_count: null,
      current_wives_count: null,
      height_cm: card.height_cm,
      weight_kg: null,
      complexion: null,
      body_type: null,
    },
    community: {
      religion_code: card.religion_code,
      sect_code: card.sect_code,
      caste_label: card.caste_label,
      sub_caste_label: null,
      mother_tongue_code: card.mother_tongue_code,
      language_codes: [],
    },
    location: {
      country_code: card.country_code,
      region_name: card.region_name,
      city_name: card.city_name,
      area: null,
      nationality_code: 'PK',
      residency_status: null,
      origin_label: null,
      relocation: null,
    },
    education_career: {
      education_level_code: card.education_level_code,
      education_field_code: null,
      degree_title: null,
      institute_name: null,
      employment_type: card.employment_type,
      profession_code: card.profession_code,
      job_title: null,
      employer_name: null,
      income_band_code: null,
    },
    family: null,
    lifestyle: {
      religiosity: null,
      prayer_frequency: null,
      hijab: null,
      beard: null,
      religious_education: null,
      smoking: null,
      living_arrangement: null,
      work_after_marriage: null,
      marriage_timeline: null,
      jahez_stance: null,
      blood_group: null,
      disability: null,
      disability_details: null,
      hobby_codes: [],
    },
    about_me: null,
    about_family: null,
    partner_notes: null,
    looking_for: { lines: [], matched: 0, total: 0 },
    compatibility: null,
    locked: [],
    relation: {
      tier: card.relation.tier,
      interest: null,
      connection_id: card.relation.connection_id,
      is_shortlisted: card.relation.is_shortlisted,
      shortlist_note: null,
      is_passed: false,
      photo_access: 'visible',
      can_send_interest: card.relation.can_send_interest,
      cannot_send_reason: null,
      cannot_send_detail: null,
      can_send_interest_after: null,
      ...relation,
    },
    ...rest,
  }
}

export function makeOwnProfile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    public_code: 'KR7Q2M',
    status: 'active',
    status_reason: null,
    onboarding_step: 'done',
    completeness: 80,
    missing: [],
    locked_fields: [],
    account_for: { managed_by: 'self', manager_name: null },
    basics: {
      first_name: 'Ayesha',
      last_name: 'Khan',
      gender: 'female',
      date_of_birth: '1999-04-12',
      marital_status: 'never_married',
      children_status: null,
      children_count: null,
      current_wives_count: null,
      height_cm: 163,
    },
    community: {
      religion_code: 'islam',
      sect_code: 'sunni',
      caste_code: null,
      caste_other: null,
      sub_caste_code: null,
      sub_caste_other: null,
      mother_tongue_code: 'urdu',
      language_codes: [],
    },
    location: {
      nationality_code: 'PK',
      country_code: 'PK',
      region_id: 1,
      city_id: 2,
      city_other: null,
      area: null,
      residency_status: null,
      origin_city_id: null,
      origin_other: null,
      relocation: null,
      city: { id: 2, name: 'Lahore', region_id: 1, region_name: 'Punjab', country_code: 'PK' },
      origin_city: null,
    },
    education_career: {
      education_level_code: 'bachelors',
      education_field_code: null,
      degree_title: null,
      institute_name: null,
      employment_type: 'private_job',
      profession_code: null,
      job_title: null,
      employer_name: null,
      income_band_code: null,
    },
    family: {
      father_status: null,
      father_occupation: null,
      mother_status: null,
      mother_occupation: null,
      brothers_count: null,
      brothers_married: null,
      sisters_count: null,
      sisters_married: null,
      family_type: null,
      family_class: null,
      family_values: null,
      family_country_code: null,
      family_city_id: null,
      home_ownership: null,
      home_type: null,
      home_size_value: null,
      home_size_unit: null,
      about_family: null,
    },
    lifestyle: {
      religiosity: null,
      prayer_frequency: null,
      hijab: null,
      beard: null,
      religious_education: null,
      smoking: null,
      living_arrangement: null,
      work_after_marriage: null,
      marriage_timeline: null,
      jahez_stance: null,
      weight_kg: null,
      complexion: null,
      body_type: null,
      blood_group: null,
      disability: null,
      disability_details: null,
      hobby_codes: [],
      about_me: null,
    },
    contacts: {
      phone_e164: null,
      whatsapp_e164: null,
      contact_email: null,
      guardian_name: null,
      guardian_relation: null,
      guardian_phone_e164: null,
      preferred_contact: 'self',
      best_time_to_call: null,
    },
    photos: [],
    identity: null,
    verification: {
      phone_verified: false,
      photo_verified: false,
      id_verified: false,
      pending: { id_document: false, selfie: false },
    },
    text_status: { about_me: 'approved', about_family: 'approved', partner_notes: 'approved' },
    ...overrides,
  }
}

export function makePreferences(overrides: Partial<Preferences> = {}): Preferences {
  return {
    age_min: 25,
    age_max: 32,
    age_importance: 'high',
    height_min_cm: null,
    height_max_cm: null,
    height_importance: 'low',
    marital_statuses: ['never_married'],
    marital_status_importance: 'high',
    children_acceptance: 'any',
    children_importance: 'medium',
    religion_codes: ['islam'],
    religion_importance: 'must',
    sect_codes: [],
    sect_importance: 'medium',
    caste_codes: [],
    caste_importance: 'low',
    mother_tongue_codes: [],
    mother_tongue_importance: 'low',
    country_codes: ['PK'],
    region_ids: [],
    city_ids: [],
    location_importance: 'medium',
    education_min_rank: null,
    education_importance: 'medium',
    employment_types: [],
    profession_codes: [],
    profession_importance: 'low',
    income_min_rank: null,
    income_importance: 'low',
    religiosity_levels: [],
    religiosity_importance: 'medium',
    hijab_types: [],
    beard_types: [],
    appearance_importance: 'low',
    family_values: [],
    family_types: [],
    family_importance: 'low',
    living_arrangements: [],
    living_arrangement_importance: 'low',
    work_after_marriage_options: [],
    work_after_marriage_importance: 'low',
    smoking_options: [],
    smoking_importance: 'medium',
    notes: null,
    ...overrides,
  }
}

export function makePrivacy(overrides: Partial<Privacy> = {}): Privacy {
  return {
    discovery_visibility: 'everyone',
    interest_permission: 'everyone',
    name_display: 'first_name_last_initial',
    photo_visibility: 'members',
    caste_visibility: 'members',
    income_visibility: 'connections',
    family_visibility: 'members',
    career_details_visibility: 'members',
    home_visibility: 'connections',
    area_visibility: 'connections',
    health_visibility: 'connections',
    show_last_active: true,
    show_online_status: true,
    record_my_visits: true,
    send_read_receipts: true,
    allow_photo_requests: true,
    ...overrides,
  }
}

export function makeInterest(overrides: Partial<Interest> = {}): Interest {
  return {
    id: mockId('in'),
    direction: 'received',
    status: 'pending',
    display_status: 'pending',
    message: null,
    compat_score: 78,
    seen: false,
    created_at: '2026-11-18T09:00:00Z',
    responded_at: null,
    expires_at: '2026-12-09T09:00:00Z',
    connection_id: null,
    profile: makeProfileCard(),
    ...overrides,
  }
}

export function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: mockId('cn'),
    status: 'active',
    stage: 'chatting',
    pending_stage_proposal: null,
    ended_reason: null,
    ended_by: null,
    ended_at: null,
    created_at: '2026-11-10T09:00:00Z',
    other: makeProfileCard({ relation: { tier: 'connection' } }),
    last_message_at: '2026-11-19T18:30:00Z',
    last_message_preview: 'Assalam o Alaikum',
    unread_count: 0,
    is_muted: false,
    is_archived: false,
    their_last_read_message_id: null,
    my_contact_share: null,
    their_contact: null,
    ...overrides,
  }
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: mockId('ms'),
    connection_id: mockId('cn'),
    sender: 'them',
    kind: 'text',
    body: 'Assalam o Alaikum',
    is_deleted: false,
    system_event: null,
    system_data: null,
    client_message_id: null,
    safety_notice: null,
    created_at: '2026-11-19T18:30:00Z',
    ...overrides,
  }
}

export function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: mockId('nt'),
    type: 'interest_received',
    actor: { profile_id: mockId('pc'), display_name: 'Ahmed R.', photo: makePhotoView() },
    data: {},
    is_read: false,
    created_at: '2026-11-19T18:30:00Z',
    ...overrides,
  }
}

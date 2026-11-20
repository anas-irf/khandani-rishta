import { describe, expect, it } from 'vitest'
import { http, seg } from '~/lib/api'
import type { BasicsSection, OwnProfile, SectionBodies } from '~/lib/api-types'
import { todayInKarachi } from '~/lib/format'
import { db, resetDb } from '../db'
import { makeOwnPhoto, makePreferences } from '../factories'

/** YYYY-MM-DD for someone who turns `years` old `days` days from today in Asia/Karachi. */
function birthDate(years: number, days = 0) {
  const [year, month, day] = todayInKarachi().split('-').map(Number)
  return new Date(Date.UTC(year - years, month - 1, day + days)).toISOString().slice(0, 10)
}

const continueStep = (step: OwnProfile['onboarding_step']) =>
  http.post('/v1/me/onboarding/continue', { step })
const putSection = <K extends keyof SectionBodies>(section: K, body: SectionBodies[K]) =>
  http.put(`/v1/me/profile/sections/${seg(section)}`, body)

function atStep(step: OwnProfile['onboarding_step']) {
  resetDb('onboarding_midway')
  db.me.profile.onboarding_step = step
  db.ownProfile.onboarding_step = step
}

const basics = {
  first_name: 'Ayesha',
  last_name: 'Khan',
  gender: 'female',
  date_of_birth: birthDate(26),
  marital_status: 'never_married',
  children_status: null,
  children_count: null,
  current_wives_count: null,
  height_cm: 163,
} satisfies BasicsSection

describe('GET /v1/me/profile', () => {
  it('locks gender and date of birth once onboarding is completed', async () => {
    const profile = await http.get('/v1/me/profile')
    expect(profile.locked_fields).toEqual(expect.arrayContaining(['gender', 'date_of_birth']))
    resetDb('new')
    expect((await http.get('/v1/me/profile')).locked_fields).toEqual([])
  })
})

describe('PUT /v1/me/profile/sections/{section}', () => {
  it('saves a section and updates the Me summary', async () => {
    resetDb('new')
    const profile = await putSection('basics', basics)
    expect(profile.basics.first_name).toBe('Ayesha')
    expect(db.me.profile.first_name).toBe('Ayesha')
    expect(db.me.profile.gender).toBe('female')
  })

  it('answers too_young and out_of_range for the date of birth', async () => {
    resetDb('new')
    await expect(
      putSection('basics', { ...basics, date_of_birth: birthDate(18, 1) }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: [expect.objectContaining({ field: 'date_of_birth', code: 'too_young' })],
    })
    await expect(
      putSection('basics', { ...basics, date_of_birth: birthDate(81) }),
    ).rejects.toMatchObject({
      fields: [expect.objectContaining({ field: 'date_of_birth', code: 'out_of_range' })],
    })
  })

  it('applies the dependent rules of 07 section 4.2', async () => {
    resetDb('new')
    await expect(
      putSection('basics', { ...basics, marital_status: 'married' }),
    ).rejects.toMatchObject({
      fields: expect.arrayContaining([
        expect.objectContaining({ field: 'marital_status', code: 'not_allowed' }),
        expect.objectContaining({ field: 'current_wives_count', code: 'required' }),
      ]),
    })
    const saved = await putSection('basics', {
      ...basics,
      children_status: 'living_with_me',
      children_count: 2,
    })
    expect(saved.basics).toMatchObject({ children_status: 'none', children_count: null })
    // While in draft, a female profile hides photos from members by default (rule 9).
    expect(db.privacy.photo_visibility).toBe('interests_and_connections')
  })

  it('rejects a changed locked field with the code locked', async () => {
    await expect(
      putSection('basics', { ...db.ownProfile.basics, gender: 'male' }),
    ).rejects.toMatchObject({
      fields: [expect.objectContaining({ field: 'gender', code: 'locked' })],
    })
    await expect(putSection('basics', db.ownProfile.basics)).resolves.toBeTruthy()
  })

  it('validates names, typed castes, cities and the about text', async () => {
    resetDb('new')
    await expect(putSection('basics', { ...basics, first_name: 'Ali123' })).rejects.toMatchObject({
      fields: [expect.objectContaining({ field: 'first_name', code: 'invalid' })],
    })
    await expect(
      putSection('community', {
        religion_code: 'islam',
        sect_code: 'catholic',
        caste_code: 'rajput',
        caste_other: 'Other',
        sub_caste_code: null,
        sub_caste_other: null,
        mother_tongue_code: 'urdu',
        language_codes: [],
      }),
    ).rejects.toMatchObject({
      fields: expect.arrayContaining([
        expect.objectContaining({ field: 'sect_code', code: 'mismatch' }),
        expect.objectContaining({ field: 'caste_other', code: 'not_allowed' }),
      ]),
    })
    await expect(
      putSection('lifestyle', {
        ...db.ownProfile.lifestyle,
        about_me: 'Call me on 0300 1234567 any time after six, I am easy to reach.',
      }),
    ).rejects.toMatchObject({
      fields: [expect.objectContaining({ field: 'about_me', code: 'contains_contact_info' })],
    })
  })

  it('stores the city reference and the region of a listed city', async () => {
    resetDb('new')
    const saved = await putSection('location', {
      nationality_code: 'PK',
      country_code: 'PK',
      region_id: null,
      city_id: 1001,
      city_other: null,
      area: null,
      residency_status: null,
      origin_city_id: null,
      origin_other: null,
      relocation: null,
    })
    expect(saved.location).toMatchObject({ region_id: 6, residency_status: 'citizen' })
    expect(saved.location.city?.name).toBe('Lahore')
  })
})

describe('POST /v1/me/onboarding/continue (03 section 4.3)', () => {
  it('answers invalid_state with the current step when another step is sent', async () => {
    atStep('basics')
    await expect(continueStep('account_for')).rejects.toMatchObject({
      status: 409,
      code: 'invalid_state',
      details: expect.objectContaining({ onboarding_step: 'basics' }),
    })
  })

  it.each<[OwnProfile['onboarding_step'], string]>([
    ['account_for', 'managed_by'],
    ['basics', 'first_name'],
    ['community', 'religion_code'],
    ['location', 'country_code'],
    ['education_career', 'education_level_code'],
  ])('checks the requirement of %s', async (step, field) => {
    resetDb('new')
    db.me.profile.onboarding_step = step
    db.ownProfile = {
      ...db.ownProfile,
      account_for: { managed_by: null, manager_name: null },
      community: { ...db.ownProfile.community, religion_code: null },
      location: { ...db.ownProfile.location, country_code: null, city_id: null },
      education_career: { ...db.ownProfile.education_career, education_level_code: null },
    }
    await expect(continueStep(step)).rejects.toMatchObject({
      code: 'validation_failed',
      fields: expect.arrayContaining([expect.objectContaining({ field, code: 'required' })]),
    })
  })

  it('requires the consents of account_for, and candidate consent for a managed profile', async () => {
    resetDb('new')
    await putSection('account_for', { managed_by: 'parent', manager_name: 'Rukhsana Khan' })
    await expect(continueStep('account_for')).rejects.toMatchObject({
      fields: [expect.objectContaining({ field: 'consents', code: 'required' })],
    })
    await putSection('account_for', {
      managed_by: 'parent',
      manager_name: 'Rukhsana Khan',
      consents: ['terms', 'privacy', 'community_guidelines', 'age_declaration'],
    })
    await expect(continueStep('account_for')).rejects.toMatchObject({
      fields: [expect.objectContaining({ field: 'consents' })],
    })
    await putSection('account_for', {
      managed_by: 'parent',
      manager_name: 'Rukhsana Khan',
      consents: ['candidate_consent'],
    })
    const me = await continueStep('account_for')
    expect(me.profile.onboarding_step).toBe('basics')
  })

  it('moves to the next step and returns Me', async () => {
    atStep('education_career')
    const me = await continueStep('education_career')
    expect(me.profile.onboarding_step).toBe('family')
    expect(me.gate).toBe('onboarding')
    expect((await continueStep('family')).profile.onboarding_step).toBe('lifestyle')
  })

  it('needs a photo only when photo_required is on', async () => {
    atStep('photos')
    db.me.config.photo_required = true
    await expect(continueStep('photos')).rejects.toMatchObject({
      fields: [expect.objectContaining({ field: 'photos', code: 'required' })],
    })
    db.ownPhotos = [makeOwnPhoto({ status: 'rejected' })]
    await expect(continueStep('photos')).rejects.toMatchObject({ code: 'validation_failed' })
    db.ownPhotos = [makeOwnPhoto({ status: 'pending_review' })]
    expect((await continueStep('photos')).profile.onboarding_step).toBe('preferences')
  })

  it('needs a preferences row and, when required, an identity', async () => {
    atStep('preferences')
    await expect(continueStep('preferences')).rejects.toMatchObject({ code: 'validation_failed' })
    db.preferences = makePreferences()
    expect((await continueStep('preferences')).profile.onboarding_step).toBe('identity')
    await expect(continueStep('identity')).rejects.toMatchObject({
      fields: [expect.objectContaining({ field: 'number', code: 'required' })],
    })
    db.me.config.identity_required = false
    expect((await continueStep('identity')).profile.onboarding_step).toBe('review')
  })

  it('refuses review: it is completed with complete', async () => {
    atStep('review')
    await expect(continueStep('review')).rejects.toMatchObject({ code: 'invalid_state' })
  })
})

describe('POST /v1/me/onboarding/complete', () => {
  function readyForReview() {
    atStep('review')
    db.preferences = makePreferences()
    db.identity = {
      document_type: 'cnic',
      number_masked: '*********1234',
      status: 'unverified',
      verified_at: null,
    }
  }

  it('activates the profile and returns gate ok', async () => {
    readyForReview()
    const me = await http.post('/v1/me/onboarding/complete')
    expect(me).toMatchObject({ gate: 'ok', profile: { status: 'active', onboarding_step: 'done' } })
  })

  it('sends the profile to review when profile review is manual', async () => {
    readyForReview()
    db.extra.profileReview = 'manual'
    const me = await http.post('/v1/me/onboarding/complete')
    expect(me).toMatchObject({ gate: 'pending_review', profile: { status: 'pending_review' } })
  })

  it('re-validates every step', async () => {
    readyForReview()
    db.ownProfile = { ...db.ownProfile, basics: { ...db.ownProfile.basics, height_cm: null } }
    await expect(http.post('/v1/me/onboarding/complete')).rejects.toMatchObject({
      code: 'validation_failed',
      fields: [expect.objectContaining({ field: 'height_cm', code: 'required' })],
    })
  })

  it('answers invalid_state before the review step', async () => {
    atStep('identity')
    await expect(http.post('/v1/me/onboarding/complete')).rejects.toMatchObject({
      code: 'invalid_state',
    })
  })
})

describe('POST /v1/me/profile/resubmit', () => {
  it('sends a profile with requested changes back to review', async () => {
    resetDb('changes_requested')
    const me = await http.post('/v1/me/profile/resubmit')
    expect(me).toMatchObject({ gate: 'pending_review', profile: { status_reason: null } })
  })

  it('answers invalid_state for any other status', async () => {
    await expect(http.post('/v1/me/profile/resubmit')).rejects.toMatchObject({
      code: 'invalid_state',
    })
  })
})

describe('GET /v1/me/profile/preview', () => {
  it('reduces the own profile for the requested tier', async () => {
    db.privacy = { ...db.privacy, income_visibility: 'connections', area_visibility: 'nobody' }
    const asMember = await http.get('/v1/me/profile/preview', { query: { as: 'member' } })
    expect(asMember.locked).toEqual(expect.arrayContaining(['income', 'area']))
    expect(asMember.card.compat).toBeNull()
    const asConnection = await http.get('/v1/me/profile/preview', {
      query: { as: 'connection' },
    })
    expect(asConnection.locked).not.toContain('income')
    expect(asConnection.locked).toContain('area')
  })
})

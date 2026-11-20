import { describe, expect, it } from 'vitest'
import { i18n } from '~/lib/i18n'
import { labelOf } from '~/lib/reference'
import { makeNotification, makePhotoView } from '~/mocks/factories'
import { referenceBootstrap } from '~/mocks/fixtures/reference'
import {
  type DescribeContext,
  describeNotification,
  safeExternalUrl,
  textRejectedTarget,
} from './describe'

const context = (language = 'en'): DescribeContext => ({
  t: (key, values) => i18n.t(key, { ns: 'notifications', ...values }),
  label: (list, code) => labelOf(referenceBootstrap, list, code),
  language,
})

const actor = { profile_id: 'p-1', display_name: 'Ahmed R.', photo: makePhotoView() }

function describeItem(
  type: string,
  data: Record<string, unknown>,
  options: { actor?: typeof actor | null; language?: string } = {},
) {
  const item = makeNotification({
    type,
    data,
    actor: options.actor === undefined ? null : options.actor,
  })
  return describeNotification(item, context(options.language))
}

describe('describeNotification: texts and targets of 14 section 3', () => {
  it('interest_received opens the profile of the actor', () => {
    const result = describeItem(
      'interest_received',
      { interest_id: 'i-1', reminder: false, count: 1 },
      { actor },
    )
    expect(result.text).toBe('Ahmed R. sent you an interest.')
    expect(result.target).toEqual({ kind: 'path', href: '/profiles/p-1' })
  })

  it('interest_received reminder with one interest names the actor and opens Received', () => {
    const result = describeItem(
      'interest_received',
      { interest_id: 'i-9', reminder: true, count: 1 },
      { actor },
    )
    expect(result.text).toBe('An interest from Ahmed R. expires in 3 days.')
    expect(result.target).toEqual({
      kind: 'path',
      href: '/interests?box=received&interest_id=i-9',
    })
  })

  it('interest_received reminder with several interests shows the count', () => {
    const result = describeItem(
      'interest_received',
      { interest_id: 'i-9', reminder: true, count: 3 },
      { actor },
    )
    expect(result.text).toBe('3 interests expire in 3 days.')
  })

  it('has no profile target when the actor is no longer visible, and says "A member"', () => {
    const result = describeItem('interest_received', { interest_id: 'i-1' })
    expect(result.text).toBe('A member sent you an interest.')
    expect(result.target).toBeNull()
  })

  it('interest_accepted opens the chat', () => {
    const result = describeItem(
      'interest_accepted',
      { interest_id: 'i-1', connection_id: 'c-1' },
      { actor },
    )
    expect(result.text).toBe('Ahmed R. accepted your interest. You can chat now.')
    expect(result.target).toEqual({ kind: 'path', href: '/chats/c-1' })
  })

  it('interest_accepted without a connection id has no target', () => {
    expect(describeItem('interest_accepted', {}, { actor }).target).toBeNull()
  })

  it('photo_request_received opens the received photo requests', () => {
    const result = describeItem('photo_request_received', { photo_access_id: 'a' }, { actor })
    expect(result.text).toBe('Ahmed R. asked to see your photos.')
    expect(result.target).toEqual({ kind: 'path', href: '/photo-requests?box=received' })
  })

  it('photo_request_granted opens the profile of the owner', () => {
    const result = describeItem('photo_request_granted', { photo_access_id: 'a' }, { actor })
    expect(result.text).toBe('Ahmed R. shared their photos with you.')
    expect(result.target).toEqual({ kind: 'path', href: '/profiles/p-1' })
  })

  it('contact_shared opens the connection details', () => {
    const result = describeItem('contact_shared', { connection_id: 'c-2' }, { actor })
    expect(result.text).toBe('Ahmed R. shared contact details with you.')
    expect(result.target).toEqual({ kind: 'path', href: '/chats/c-2/details' })
  })

  it('stage_proposed and stage_confirmed use the stage name', () => {
    const proposed = describeItem(
      'stage_proposed',
      { connection_id: 'c-3', proposal_id: 'sp', stage: 'families_talking' },
      { actor },
    )
    expect(proposed.text).toBe('Ahmed R. suggests the next step: Our families are in touch.')
    expect(proposed.target).toEqual({ kind: 'path', href: '/chats/c-3/details' })

    const confirmed = describeItem(
      'stage_confirmed',
      { connection_id: 'c-3', stage: 'engaged' },
      { actor },
    )
    expect(confirmed.text).toBe('Ahmed R. confirmed: Rishta confirmed.')
    expect(confirmed.target).toEqual({ kind: 'path', href: '/chats/c-3/details' })
  })

  it('a stage notification without a stage falls back to the unknown text', () => {
    const result = describeItem('stage_proposed', { connection_id: 'c-3' }, { actor })
    expect(result.text).toBe('You have a new notification.')
  })

  it('profile_approved opens home', () => {
    const result = describeItem('profile_approved', {})
    expect(result.text).toBe('Your profile is live. Members can now find you.')
    expect(result.target).toEqual({ kind: 'path', href: '/home' })
  })

  it('profile_changes_requested opens the gate screen', () => {
    const result = describeItem('profile_changes_requested', { reason: 'Add a photo' })
    expect(result.text).toBe('Your profile needs a few changes before it can go live.')
    expect(result.target).toEqual({ kind: 'path', href: '/account/changes' })
  })

  it('photo_approved opens the photos', () => {
    const result = describeItem('photo_approved', { photo_id: 'ph' })
    expect(result.text).toBe('Your photo was approved.')
    expect(result.target).toEqual({ kind: 'path', href: '/me/photos' })
  })

  it('photo_rejected uses the label of the rejection reason', () => {
    const result = describeItem('photo_rejected', {
      photo_id: 'ph',
      rejection_reason: 'face_not_visible',
    })
    expect(result.text).toBe('A photo was not approved: The face is not clearly visible.')
    expect(result.target).toEqual({ kind: 'path', href: '/me/photos' })
  })

  it('photo_rejected without a reason drops the reason part', () => {
    expect(describeItem('photo_rejected', { photo_id: 'ph' }).text).toBe(
      'A photo was not approved.',
    )
  })

  it('photo_rejected shows an unknown reason code as plain words', () => {
    const result = describeItem('photo_rejected', { rejection_reason: 'brand_new_reason' })
    expect(result.text).toBe('A photo was not approved: brand new reason.')
  })

  it('text_rejected opens the section of the field and carries the moderator note', () => {
    const about = describeItem('text_rejected', { field: 'about_me', note: 'Remove the number' })
    expect(about.text).toBe('Part of your profile text was not approved. Please edit it.')
    expect(about.note).toBe('Remove the number')
    expect(about.target).toEqual({ kind: 'path', href: '/me/edit/lifestyle' })

    expect(describeItem('text_rejected', { field: 'about_family', note: null }).target).toEqual({
      kind: 'path',
      href: '/me/edit/family',
    })
    expect(describeItem('text_rejected', { field: 'partner_notes', note: null }).target).toEqual({
      kind: 'path',
      href: '/me/preferences',
    })
    expect(describeItem('text_rejected', { field: 'about_me', note: null }).note).toBeNull()
  })

  it('text_rejected with an unknown field opens the own profile', () => {
    expect(textRejectedTarget('something_new')).toBe('/me')
    expect(textRejectedTarget(null)).toBe('/me')
  })

  it('verification_approved reads by kind and opens the verification screen', () => {
    const id = describeItem('verification_approved', { request_id: 'r', kind: 'id_document' })
    expect(id.text).toBe('Your ID is verified.')
    expect(id.target).toEqual({ kind: 'path', href: '/me/verification' })
    expect(describeItem('verification_approved', { kind: 'selfie' }).text).toBe(
      'Your photo is verified.',
    )
    expect(describeItem('verification_approved', { kind: 'later_kind' }).text).toBe(
      'Your verification was approved.',
    )
  })

  it('verification_rejected uses the label of the rejection reason', () => {
    const result = describeItem('verification_rejected', {
      request_id: 'r',
      kind: 'selfie',
      rejection_reason: 'face_mismatch',
    })
    expect(result.text).toBe('Your verification could not be approved: The face does not match.')
    expect(result.target).toEqual({ kind: 'path', href: '/me/verification' })
    expect(describeItem('verification_rejected', { kind: 'selfie' }).text).toBe(
      'Your verification could not be approved.',
    )
  })

  it('new_matches from recommendations opens the matches', () => {
    const result = describeItem('new_matches', {
      source: 'recommendations',
      count: 4,
      saved_search_id: null,
    })
    expect(result.text).toBe('You have 4 new matches.')
    expect(result.target).toEqual({ kind: 'path', href: '/matches' })
    expect(describeItem('new_matches', { source: 'recommendations', count: 1 }).text).toBe(
      'You have 1 new match.',
    )
  })

  it('new_matches from a saved search opens that search', () => {
    const result = describeItem('new_matches', {
      source: 'saved_search',
      count: 2,
      saved_search_id: 's-1',
      saved_search_name: 'Lahore doctors',
    })
    expect(result.text).toBe('2 new profiles match your saved search "Lahore doctors".')
    expect(result.target).toEqual({ kind: 'path', href: '/search?saved_search_id=s-1' })
  })

  it('a saved search notification without a name reads like the recommendations variant', () => {
    const result = describeItem('new_matches', { source: 'saved_search', count: 2 })
    expect(result.text).toBe('You have 2 new matches.')
  })

  it('profile_views_summary opens the visitors', () => {
    const result = describeItem('profile_views_summary', { count: 7 })
    expect(result.text).toBe('7 people viewed your profile today.')
    expect(result.target).toEqual({ kind: 'path', href: '/visitors' })
    expect(describeItem('profile_views_summary', { count: 1 }).text).toBe(
      '1 person viewed your profile today.',
    )
  })

  it('account_warning shows the reason and opens the dialog', () => {
    const result = describeItem('account_warning', {
      sanction_id: 's',
      reason: 'Please keep messages respectful',
    })
    expect(result.text).toBe('A notice about your account: Please keep messages respectful.')
    expect(result.target).toEqual({ kind: 'warning', reason: 'Please keep messages respectful' })
    expect(describeItem('account_warning', {}).text).toBe('A notice about your account.')
  })

  it('announcement shows the English text and opens its url', () => {
    const result = describeItem('announcement', {
      text_en: 'Eid mubarak from the team',
      text_ur: null,
      url: 'https://example.com/eid',
    })
    expect(result.text).toBe('Eid mubarak from the team')
    expect(result.target).toEqual({ kind: 'external', url: 'https://example.com/eid' })
  })

  it('announcement without a url has no target, and uses Urdu only when asked for', () => {
    const data = { text_en: 'English text', text_ur: 'اردو متن', url: null }
    expect(describeItem('announcement', data).text).toBe('English text')
    expect(describeItem('announcement', data).target).toBeNull()
    expect(describeItem('announcement', data, { language: 'ur' }).text).toBe('اردو متن')
    expect(
      describeItem('announcement', { text_en: 'English text', text_ur: null }, { language: 'ur' })
        .text,
    ).toBe('English text')
  })

  it('announcement never opens a non-http url', () => {
    const result = describeItem('announcement', {
      text_en: 'Click me',
      url: 'javascript:alert(1)',
    })
    expect(result.target).toBeNull()
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('/relative')).toBeNull()
    expect(safeExternalUrl(null)).toBeNull()
    expect(safeExternalUrl('http://example.com/a')).toBe('http://example.com/a')
  })

  it('an announcement without text reads as an unknown notification', () => {
    expect(describeItem('announcement', { text_en: '' }).text).toBe('You have a new notification.')
  })

  it('an unknown type reads "You have a new notification." and has no target', () => {
    const result = describeItem('brand_new_type', { anything: 1 }, { actor })
    expect(result.text).toBe('You have a new notification.')
    expect(result.target).toBeNull()
    expect(result.note).toBeNull()
  })

  it('ignores unknown keys in data', () => {
    const result = describeItem(
      'interest_accepted',
      { connection_id: 'c-1', future_key: { nested: true } },
      { actor },
    )
    expect(result.target).toEqual({ kind: 'path', href: '/chats/c-1' })
  })

  it('encodes ids that go into a path', () => {
    const result = describeItem('interest_accepted', { connection_id: 'a/b' }, { actor })
    expect(result.target).toEqual({ kind: 'path', href: '/chats/a%2Fb' })
  })
})

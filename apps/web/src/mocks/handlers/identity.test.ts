import { describe, expect, it } from 'vitest'
import { http } from '~/lib/api'
import type { IdentityDocumentType, IdentitySummary } from '~/lib/api-types'
import { db, resetDb } from '../db'
import { maskIdentityNumber, normaliseIdentityNumber } from './identity'

const put = (document_type: IdentityDocumentType, number: string) =>
  http.put('/v1/me/identity', { document_type, number })

describe('identity handlers (12 section 3)', () => {
  it('normalises and masks numbers', () => {
    expect(normaliseIdentityNumber(' 35202-1234567 2 ')).toBe('3520212345672')
    expect(maskIdentityNumber('3520212345672')).toBe('*********5672')
  })

  it('GET answers null without a number, then the summary', async () => {
    resetDb('new')
    expect(await http.get('/v1/me/identity')).toBeNull()
    // The new scenario has no gender yet: the number cannot be checked (12 section 3.3).
    await expect(put('cnic', '3520212345672')).rejects.toMatchObject({ code: 'invalid_state' })
    db.ownProfile.basics.gender = 'female'
    const saved = await put('cnic', '35202-1234567-2')
    expect(saved).toEqual({
      document_type: 'cnic',
      number_masked: '*********5672',
      status: 'unverified',
      verified_at: null,
    })
    expect(await http.get('/v1/me/identity')).toEqual(saved)
  })

  it('applies the format and gender rules in order', async () => {
    // The active scenario is a female profile: the last digit must be even.
    await expect(put('cnic', '')).rejects.toMatchObject({
      fields: [expect.objectContaining({ field: 'number', code: 'required' })],
    })
    await expect(put('cnic', '35202123')).rejects.toMatchObject({
      fields: [{ field: 'number', code: 'invalid', message: 'A CNIC number has 13 digits.' }],
    })
    await expect(put('nicop', '9520212345672')).rejects.toMatchObject({
      fields: [
        {
          field: 'number',
          code: 'invalid',
          message: 'This does not look like a valid CNIC number.',
        },
      ],
    })
    await expect(put('cnic', '3520212345671')).rejects.toMatchObject({
      fields: [expect.objectContaining({ field: 'number', code: 'mismatch' })],
    })
    await expect(put('passport', 'ABCDEFG')).rejects.toMatchObject({
      fields: [expect.objectContaining({ code: 'invalid' })],
    })
    await expect(put('poc', '3520212345671')).resolves.toMatchObject({ document_type: 'poc' })
  })

  it('answers identity_already_registered for the documented test numbers', async () => {
    await expect(put('cnic', '35201-9999999-2')).rejects.toMatchObject({
      status: 409,
      code: 'identity_already_registered',
    })
    await expect(put('passport', 'zz9999999')).rejects.toMatchObject({
      code: 'identity_already_registered',
    })
  })

  it('answers invalid_state while the identity is pending or verified', async () => {
    db.identity = { ...(db.identity as IdentitySummary), status: 'pending' }
    await expect(put('cnic', '3520212345672')).rejects.toMatchObject({
      code: 'invalid_state',
    })
  })
})

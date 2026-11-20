import { describe, expect, it } from 'vitest'
import { defaultDocumentType, numberComplete, validateIdentity } from './schemas'

describe('default document type (07 section 13.2)', () => {
  it.each([
    ['PK', 'PK', 'cnic'],
    ['PK', 'GB', 'nicop'],
    ['GB', 'GB', 'passport'],
    ['GB', 'PK', 'passport'],
    [null, 'PK', 'cnic'],
  ])('nationality %s living in %s gives %s', (nationality, country, type) => {
    expect(defaultDocumentType(nationality, country)).toBe(type)
  })
})

describe('identity number rules (07 section 16.8, 12 section 3.3)', () => {
  const message = (code: string) => `identity:errors.number.${code}`

  it('requires a number', () => {
    expect(validateIdentity({ document_type: 'cnic', number: null })).toEqual([
      { path: 'number', message: message('required') },
    ])
  })

  it('needs 13 digits for CNIC, NICOP and POC', () => {
    expect(validateIdentity({ document_type: 'cnic', number: '35202-1234567-1' })).toEqual([])
    expect(validateIdentity({ document_type: 'poc', number: '352021234567' })).toEqual([
      { path: 'number', message: message('invalid_cnic') },
    ])
    expect(numberComplete({ document_type: 'nicop', number: '3520212345671' })).toBe(true)
    expect(numberComplete({ document_type: 'nicop', number: '352021234567' })).toBe(false)
  })

  it('needs 6 to 12 letters and digits with at least one digit for a passport', () => {
    expect(validateIdentity({ document_type: 'passport', number: 'ab1234567' })).toEqual([])
    expect(validateIdentity({ document_type: 'passport', number: 'ABCDEFG' })).toEqual([
      { path: 'number', message: message('invalid_passport') },
    ])
    expect(validateIdentity({ document_type: 'passport', number: 'A1234' })).toEqual([
      { path: 'number', message: message('invalid_passport') },
    ])
  })
})

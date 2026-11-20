import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { renderWithProviders } from '~/test/render'
import {
  formatIdentityNumber,
  type IdentityDocumentType,
  normalizeIdentityNumber,
} from './identity-number-field'
import { E164_PATTERN, splitE164, toE164 } from './phone-field'
import { describedText, Harness, readValues } from './test-harness'

const SERVER_ERROR = { field: 'value', code: 'server_rule', message: 'Rejected by the server.' }

describe('toE164 and splitE164', () => {
  it('builds E.164 from a dial code and a national number (08 section 3.3)', () => {
    expect(toE164('+92', '0300 1234567')).toBe('+923001234567')
    expect(toE164('+92', '300-123-4567')).toBe('+923001234567')
    expect(toE164('+44', '07700 900123')).toBe('+447700900123')
    expect(toE164('+92', '  ')).toBeNull()
    expect(E164_PATTERN.test('+923001234567')).toBe(true)
  })

  it('splits on the longest matching dial code', () => {
    const codes = ['+1', '+92', '+971', '+9']
    expect(splitE164('+923001234567', codes)).toEqual({ dial: '+92', national: '3001234567' })
    expect(splitE164('+971501234567', codes)).toEqual({ dial: '+971', national: '501234567' })
    expect(splitE164(null, codes)).toEqual({ dial: null, national: '' })
  })
})

describe('PhoneField', () => {
  const schema = z.object({
    value: z
      .string({ error: 'Enter a mobile number.' })
      .regex(E164_PATTERN, 'Enter a valid phone number.'),
  })

  function setup(initial: string | null = null) {
    renderWithProviders(() => (
      <Harness initial={{ value: initial }} schema={schema} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.PhoneField label="Mobile number" />}
          </form.AppField>
        )}
      </Harness>
    ))
  }

  it('defaults to +92 and turns 0300 1234567 into +923001234567', async () => {
    const user = userEvent.setup()
    setup()
    expect(
      await screen.findByRole('group', { name: 'Mobile number (optional)' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Country code' })).toHaveDisplayValue(
      'Pakistan (+92)',
    )
    const number = screen.getByRole('textbox', { name: 'Number' })
    expect(number).toHaveAttribute('inputmode', 'tel')
    expect(number).toHaveAttribute('placeholder', '3XX XXXXXXX')
    expect(number).toHaveAttribute('name', 'value')
    await user.type(number, '0300 1234567')
    expect(readValues().value).toBe('+923001234567')
    await user.clear(number)
    expect(readValues().value).toBeNull()
  })

  it('changes the dial code', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(await screen.findByRole('textbox', { name: 'Number' }), '7700 900123')
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Country code' }),
      'United Kingdom (+44)',
    )
    expect(readValues().value).toBe('+447700900123')
  })

  it('shows a stored number with the dial code and the Pakistani format', async () => {
    setup('+923001234567')
    expect(await screen.findByRole('textbox', { name: 'Number' })).toHaveValue('300 1234567')
    expect(screen.getByRole('combobox', { name: 'Country code' })).toHaveDisplayValue(
      'Pakistan (+92)',
    )
  })

  it('shows the Zod error after submit and a server error that clears on change', async () => {
    const user = userEvent.setup()
    setup()
    const number = await screen.findByRole('textbox', { name: 'Number' })
    await user.type(number, '12')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter a valid phone number.')).toBeInTheDocument()
    expect(describedText(number)).toContain('Enter a valid phone number.')

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.type(number, '3')
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })
})

describe('identity number helpers', () => {
  it('normalises as 12 section 3.2 says', () => {
    expect(normalizeIdentityNumber('cnic', '35202-1234567-1')).toBe('3520212345671')
    expect(normalizeIdentityNumber('cnic', '35202 1234567 1')).toBe('3520212345671')
    expect(normalizeIdentityNumber('nicop', '35202123456719')).toBe('3520212345671')
    expect(normalizeIdentityNumber('passport', ' ab-12 3456c ')).toBe('AB123456C')
    expect(normalizeIdentityNumber('passport', 'AB1234567890XYZ')).toBe('AB1234567890')
  })

  it('formats the CNIC mask progressively', () => {
    const format = (value: string, type: IdentityDocumentType = 'cnic') =>
      formatIdentityNumber(type, value)
    expect(format('35202')).toBe('35202')
    expect(format('352021')).toBe('35202-1')
    expect(format('352021234567')).toBe('35202-1234567')
    expect(format('3520212345671')).toBe('35202-1234567-1')
    expect(format('AB1234567', 'passport')).toBe('AB1234567')
  })
})

describe('IdentityNumberField', () => {
  const schema = z.object({
    value: z
      .string({ error: 'Enter the number.' })
      .regex(/^\d{13}$/, 'A CNIC number has 13 digits.'),
  })

  function setup(documentType: IdentityDocumentType = 'cnic') {
    renderWithProviders(() => (
      <Harness initial={{ value: null }} schema={schema} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => (
              <field.IdentityNumberField label="CNIC number" documentType={documentType} required />
            )}
          </form.AppField>
        )}
      </Harness>
    ))
  }

  it('masks 3520212345671 as 35202-1234567-1 and stores the digits', async () => {
    const user = userEvent.setup()
    setup()
    const input = await screen.findByLabelText('CNIC number')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    await user.type(input, '3520212345671')
    expect(input).toHaveValue('35202-1234567-1')
    expect(readValues().value).toBe('3520212345671')
    await user.type(input, '9')
    expect(readValues().value).toBe('3520212345671')
  })

  it('upper-cases a passport number', async () => {
    const user = userEvent.setup()
    setup('passport')
    const input = await screen.findByLabelText('CNIC number')
    await user.type(input, 'ab 123-4567')
    expect(input).toHaveValue('AB1234567')
    expect(readValues().value).toBe('AB1234567')
  })

  it('shows the Zod error after submit and a server error that clears on change', async () => {
    const user = userEvent.setup()
    setup()
    const input = await screen.findByLabelText('CNIC number')
    expect(input).toHaveAttribute('aria-required', 'true')
    await user.type(input, '35202')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('A CNIC number has 13 digits.')).toBeInTheDocument()
    expect(describedText(input)).toContain('A CNIC number has 13 digits.')

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.type(input, '1')
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })
})

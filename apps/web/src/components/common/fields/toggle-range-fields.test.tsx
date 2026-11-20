import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { renderWithProviders } from '~/test/render'
import { HEIGHT_RANGE_OPTIONS } from './range-field'
import { describedText, Harness, readValues } from './test-harness'

const SERVER_ERROR = { field: 'value', code: 'server_rule', message: 'Rejected by the server.' }
const ticked = z.object({ value: z.literal(true, { error: 'Please agree to continue.' }) })

describe('CheckboxField', () => {
  it('toggles a boolean, never says "(optional)" and shows errors', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness initial={{ value: false }} schema={ticked} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.CheckboxField label="Same as mobile number" />}
          </form.AppField>
        )}
      </Harness>
    ))
    const checkbox = await screen.findByRole('checkbox', { name: 'Same as mobile number' })
    expect(checkbox).toHaveAttribute('name', 'value')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Please agree to continue.')).toBeInTheDocument()
    expect(describedText(checkbox)).toContain('Please agree to continue.')

    await user.click(screen.getByText('Same as mobile number'))
    expect(readValues().value).toBe(true)
    expect(screen.queryByText('Please agree to continue.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.click(checkbox)
    expect(readValues().value).toBe(false)
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })
})

describe('ConsentCheckbox', () => {
  it('renders links that open in a new tab and marks optional consents', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness initial={{ value: false, news: false }} schema={ticked.loose()}>
        {(form) => (
          <>
            <form.AppField name="value">
              {(field) => (
                <field.ConsentCheckbox
                  required
                  label={
                    <>
                      I agree to the{' '}
                      <a href="/terms" target="_blank" rel="noopener noreferrer">
                        Terms of Use
                      </a>
                    </>
                  }
                />
              )}
            </form.AppField>
            <form.AppField name="news">
              {(field) => <field.ConsentCheckbox label="Send me product news" />}
            </form.AppField>
          </>
        )}
      </Harness>
    ))
    const consent = await screen.findByRole('checkbox', { name: /I agree to the Terms of Use/ })
    expect(consent).toHaveAttribute('aria-required', 'true')
    expect(
      screen.getByRole('checkbox', { name: 'Send me product news (optional)' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Please agree to continue.')).toBeInTheDocument()
    expect(describedText(consent)).toContain('Please agree to continue.')
    await user.click(consent)
    expect(readValues().value).toBe(true)
  })

  it('ConsentLink opens in a new tab with rel="noopener noreferrer"', async () => {
    const { ConsentLink } = await import('./checkbox-field')
    renderWithProviders(() => (
      <Harness initial={{ value: false }}>
        {(form) => (
          <form.AppField name="value">
            {(field) => (
              <field.ConsentCheckbox
                required
                label={
                  <>
                    I agree to the <ConsentLink href="/privacy">Privacy Policy</ConsentLink>
                  </>
                }
              />
            )}
          </form.AppField>
        )}
      </Harness>
    ))
    const link = await screen.findByRole('link', { name: /Privacy Policy/ })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('(opens in a new tab)')
  })
})

describe('SwitchField', () => {
  it('toggles with the label and shows errors', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness initial={{ value: false }} schema={ticked} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => (
              <field.SwitchField
                label="Show when I am online"
                helpText="Members see a green dot."
              />
            )}
          </form.AppField>
        )}
      </Harness>
    ))
    const toggle = await screen.findByRole('switch', { name: 'Show when I am online' })
    expect(describedText(toggle)).toContain('Members see a green dot.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Please agree to continue.')).toBeInTheDocument()
    expect(describedText(toggle)).toContain('Please agree to continue.')

    await user.click(screen.getByText('Show when I am online'))
    expect(readValues().value).toBe(true)
    expect(toggle).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.click(toggle)
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })
})

describe('RangeField presets', () => {
  const rangeSchema = z.object({
    value: z
      .object({ min: z.number().nullable(), max: z.number().nullable() })
      .refine((range) => range.min == null || range.max == null || range.min <= range.max, {
        message: 'The minimum cannot be more than the maximum.',
      })
      .refine((range) => range.min == null || range.min >= 21, {
        message: 'Choose 21 or more.',
      }),
  })

  it('AgeRangeField offers 18 to 80 and keeps the range ordered', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness
        initial={{ value: { min: 22, max: 28 } }}
        schema={rangeSchema}
        serverErrors={[SERVER_ERROR]}
      >
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.AgeRangeField label="Age" />}
          </form.AppField>
        )}
      </Harness>
    ))
    expect(await screen.findByRole('group', { name: 'Age' })).toBeInTheDocument()
    const from = screen.getByRole('combobox', { name: 'From' }) as HTMLSelectElement
    const to = screen.getByRole('combobox', { name: 'To' })
    expect(from).toHaveAttribute('name', 'value')
    expect(Array.from(from.options).map((option) => option.value)).toHaveLength(63)
    expect(from).toHaveDisplayValue('22 years')

    await user.selectOptions(from, '30 years')
    expect(readValues().value).toEqual({ min: 30, max: 30 })
    await user.selectOptions(to, '35 years')
    expect(readValues().value).toEqual({ min: 30, max: 35 })
    await user.selectOptions(to, '25 years')
    expect(readValues().value).toEqual({ min: 25, max: 25 })

    await user.selectOptions(from, '19 years')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Choose 21 or more.')).toBeInTheDocument()
    expect(describedText(from)).toContain('Choose 21 or more.')

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.selectOptions(from, '24 years')
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })

  it('HeightRangeField has a "No preference" switch that sets both ends to null', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness initial={{ value: { min: 152, max: 183 } }}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.HeightRangeField label="Height" />}
          </form.AppField>
        )}
      </Harness>
    ))
    expect(await screen.findByRole('group', { name: 'Height (optional)' })).toBeInTheDocument()
    expect(HEIGHT_RANGE_OPTIONS[0]).toBe(122)
    expect(HEIGHT_RANGE_OPTIONS.at(-1)).toBe(213)
    expect(HEIGHT_RANGE_OPTIONS).toHaveLength(37)
    const from = screen.getByRole('combobox', { name: 'From' })
    expect(from).toHaveDisplayValue('5 ft 0 in')

    const noPreference = screen.getByRole('switch', { name: 'No preference' })
    expect(noPreference).not.toBeChecked()
    await user.click(noPreference)
    expect(readValues().value).toEqual({ min: null, max: null })
    expect(from).toBeDisabled()
    await user.click(noPreference)
    expect(readValues().value).toEqual({ min: 152, max: 183 })

    await user.selectOptions(screen.getByRole('combobox', { name: 'To' }), 'Any')
    expect(readValues().value).toEqual({ min: 152, max: null })
  })
})

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { cmToFeetInches, feetInchesToCm, todayInKarachi } from '~/lib/format'
import { renderWithProviders } from '~/test/render'
import { composeDate } from './date-of-birth-field'
import { HEIGHT_FEET, inchesFor } from './height-field'
import { describedText, Harness, readValues } from './test-harness'

const SERVER_ERROR = { field: 'value', code: 'server_rule', message: 'Rejected by the server.' }

describe('composeDate', () => {
  it('accepts real dates only', () => {
    expect(composeDate(1995, 6, 15)).toBe('1995-06-15')
    expect(composeDate(1996, 2, 29)).toBe('1996-02-29')
    expect(composeDate(1995, 2, 29)).toBeNull()
    expect(composeDate(1995, 2, 31)).toBeNull()
    expect(composeDate(1995, 4, 31)).toBeNull()
  })
})

describe('DateOfBirthField', () => {
  const schema = z.object({ value: z.string({ error: 'Enter the date of birth.' }) })

  function setup(initial: string | null = null) {
    renderWithProviders(() => (
      <Harness initial={{ value: initial }} schema={schema} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => (
              <field.DateOfBirthField
                label="Date of birth"
                helpText="Only the age is shown to others."
                required
              />
            )}
          </form.AppField>
        )}
      </Harness>
    ))
  }

  it('renders a group with day, month and year selects and the newest year first', async () => {
    setup()
    expect(await screen.findByRole('group', { name: 'Date of birth' })).toBeInTheDocument()
    const year = screen.getByRole('combobox', { name: 'Year' })
    const currentYear = Number(todayInKarachi().slice(0, 4))
    const years = Array.from((year as HTMLSelectElement).options)
      .map((option) => option.value)
      .filter(Boolean)
    expect(years[0]).toBe(String(currentYear - 18))
    expect(years.at(-1)).toBe(String(currentYear - 80))
    expect(screen.getByRole('combobox', { name: 'Day' })).toHaveAttribute('name', 'value')
    expect(screen.getByRole('option', { name: 'February' })).toBeInTheDocument()
  })

  it('produces YYYY-MM-DD for a real date', async () => {
    const user = userEvent.setup()
    setup()
    const year = String(Number(todayInKarachi().slice(0, 4)) - 30)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Day' }), '5')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Month' }), 'March')
    expect(readValues().value).toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Year' }), year)
    expect(readValues().value).toBe(`${year}-03-05`)
  })

  it('rejects 31 February', async () => {
    const user = userEvent.setup()
    setup()
    const year = String(Number(todayInKarachi().slice(0, 4)) - 30)
    const day = await screen.findByRole('combobox', { name: 'Day' })
    await user.selectOptions(day, '31')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Month' }), 'February')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Year' }), year)
    expect(readValues().value).toBeNull()
    expect(screen.getByText('Enter a real date.')).toBeInTheDocument()
    expect(day).toHaveAttribute('aria-invalid', 'true')
    expect(describedText(day)).toContain('Enter a real date.')

    await user.selectOptions(day, '28')
    expect(readValues().value).toBe(`${year}-02-28`)
    expect(screen.queryByText('Enter a real date.')).not.toBeInTheDocument()
  })

  it('prefills from a stored value', async () => {
    setup('1990-12-01')
    expect(await screen.findByRole('combobox', { name: 'Day' })).toHaveValue('1')
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveValue('12')
    expect(screen.getByRole('combobox', { name: 'Year' })).toHaveValue('1990')
  })

  it('shows the Zod error after submit and a server error that clears on change', async () => {
    const user = userEvent.setup()
    setup()
    const day = await screen.findByRole('combobox', { name: 'Day' })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter the date of birth.')).toBeInTheDocument()
    expect(describedText(day)).toContain('Enter the date of birth.')
    expect(describedText(day)).toContain('Only the age is shown to others.')

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.selectOptions(day, '2')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Month' }), 'May')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Year' }), '1990')
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })
})

describe('height conversion', () => {
  it('keeps every picker value from 4 ft 0 in to 7 ft 0 in through the round trip', () => {
    let count = 0
    for (const feet of HEIGHT_FEET) {
      for (const inches of inchesFor(feet)) {
        const cm = feetInchesToCm(feet, inches)
        expect(cmToFeetInches(cm)).toEqual({ feet, inches })
        count += 1
      }
    }
    expect(count).toBe(37)
    expect(feetInchesToCm(4, 0)).toBe(122)
    expect(feetInchesToCm(7, 0)).toBe(213)
  })
})

describe('HeightField', () => {
  const schema = z.object({ value: z.number({ error: 'Select a height.' }) })

  function setup(initial: number | null = null) {
    renderWithProviders(() => (
      <Harness initial={{ value: initial }} schema={schema} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.HeightField label="Height" />}
          </form.AppField>
        )}
      </Harness>
    ))
  }

  it('renders "(optional)" and stores centimetres', async () => {
    const user = userEvent.setup()
    setup()
    expect(await screen.findByRole('group', { name: 'Height (optional)' })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Feet' }), '5 ft')
    expect(readValues().value).toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Inches' }), '6 in')
    expect(readValues().value).toBe(168)
    expect(screen.getByText('168 cm')).toBeInTheDocument()
  })

  it('offers only 0 inches at 7 ft', async () => {
    const user = userEvent.setup()
    setup()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Feet' }), '7 ft')
    const inches = screen.getByRole('combobox', { name: 'Inches' }) as HTMLSelectElement
    expect(Array.from(inches.options).map((option) => option.value)).toEqual(['', '0'])
    expect(readValues().value).toBe(213)
  })

  it('survives the round trip for every feet and inches value through the UI', async () => {
    const user = userEvent.setup()
    setup()
    const feetSelect = await screen.findByRole('combobox', { name: 'Feet' })
    const inchesSelect = screen.getByRole('combobox', { name: 'Inches' })
    for (const feet of HEIGHT_FEET) {
      await user.selectOptions(feetSelect, String(feet))
      for (const inches of inchesFor(feet)) {
        await user.selectOptions(inchesSelect, String(inches))
        const cm = readValues().value as number
        expect(cm).toBe(feetInchesToCm(feet, inches))
        expect(cmToFeetInches(cm)).toEqual({ feet, inches })
      }
    }
  })

  it('prefills feet and inches from centimetres', async () => {
    setup(170)
    expect(await screen.findByRole('combobox', { name: 'Feet' })).toHaveValue('5')
    expect(screen.getByRole('combobox', { name: 'Inches' })).toHaveValue('7')
  })

  it('shows the Zod error after submit and a server error that clears on change', async () => {
    const user = userEvent.setup()
    setup()
    const feet = await screen.findByRole('combobox', { name: 'Feet' })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Select a height.')).toBeInTheDocument()
    expect(describedText(feet)).toContain('Select a height.')

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.selectOptions(feet, '6')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Inches' }), '1')
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })
})

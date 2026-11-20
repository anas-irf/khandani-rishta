import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { renderWithProviders } from '~/test/render'
import { resolveSelectVariant } from './select-field'
import { describedText, Harness, readValues } from './test-harness'

const SERVER_ERROR = { field: 'value', code: 'server_rule', message: 'Rejected by the server.' }
const chosen = z.object({ value: z.string({ error: 'Choose one.' }) })

describe('resolveSelectVariant', () => {
  it('follows 07 section 2.6', () => {
    expect(resolveSelectVariant('auto', 2)).toBe('radio')
    expect(resolveSelectVariant('auto', 4)).toBe('radio')
    expect(resolveSelectVariant('auto', 5)).toBe('native')
    expect(resolveSelectVariant('auto', 8)).toBe('native')
    expect(resolveSelectVariant('auto', 9)).toBe('search')
    expect(resolveSelectVariant('native', 2)).toBe('native')
  })
})

describe('SelectField', () => {
  it('shows 2 options as a segmented control with labels from the reference list', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness initial={{ value: null }} schema={chosen} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.SelectField label="Gender" list="gender" required />}
          </form.AppField>
        )}
      </Harness>
    ))
    const group = await screen.findByRole('radiogroup', { name: 'Gender' })
    expect(group).toHaveAttribute('aria-required', 'true')

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Choose one.')).toBeInTheDocument()
    expect(describedText(group)).toContain('Choose one.')

    await user.click(within(group).getByRole('radio', { name: 'Female' }))
    expect(readValues().value).toBe('female')
    expect(screen.queryByText('Choose one.')).not.toBeInTheDocument()
    // The selected choice carries the field name for focusField().
    expect(within(group).getByRole('radio', { name: 'Female' })).toHaveAttribute('name', 'value')

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.click(within(group).getByRole('radio', { name: 'Male' }))
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })

  it('shows up to 4 long options as radio cards', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness initial={{ value: null }}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.SelectField label="Do you have children?" list="children_status" />}
          </form.AppField>
        )}
      </Harness>
    ))
    const group = await screen.findByRole('radiogroup', {
      name: 'Do you have children? (optional)',
    })
    await user.click(within(group).getByRole('radio', { name: 'Yes, living with me' }))
    expect(readValues().value).toBe('living_with_me')
  })

  it('uses a native select for 5 to 8 options and keeps an unknown stored code visible', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness initial={{ value: 'retired_code' }} schema={chosen} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.SelectField label="Complexion" list="complexion" />}
          </form.AppField>
        )}
      </Harness>
    ))
    const select = await screen.findByRole('combobox', { name: 'Complexion (optional)' })
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveDisplayValue('retired code')
    await user.selectOptions(select, 'Wheatish')
    expect(readValues().value).toBe('wheatish')
    await user.selectOptions(select, 'Select')
    expect(readValues().value).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Choose one.')).toBeInTheDocument()
    expect(describedText(select)).toContain('Choose one.')
    expect(select).toHaveAttribute('aria-invalid', 'true')

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.selectOptions(select, 'Fair')
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })

  it('switches to a searchable list for more than 8 options', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness initial={{ value: null }}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.SelectField label="Mother tongue" list="languages" required />}
          </form.AppField>
        )}
      </Harness>
    ))
    const trigger = await screen.findByRole('combobox', { name: 'Mother tongue' })
    expect(trigger.tagName).toBe('BUTTON')
    await user.click(trigger)
    await user.keyboard('Punj')
    await user.keyboard('{Enter}')
    expect(readValues().value).toBe('punjabi')
  })
})

describe('RadioCardsField', () => {
  const options = [
    { code: 'members', label: 'All members', description: 'Everyone signed in can see them.' },
    { code: 'connections', label: 'Connections', description: 'Only your connections.' },
  ]

  it('selects a card, links descriptions and shows errors', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness initial={{ value: null }} schema={chosen} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => (
              <field.RadioCardsField label="Who can see your photos?" options={options} />
            )}
          </form.AppField>
        )}
      </Harness>
    ))
    const group = await screen.findByRole('radiogroup', {
      name: 'Who can see your photos? (optional)',
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Choose one.')).toBeInTheDocument()
    expect(describedText(group)).toContain('Choose one.')

    const radio = within(group).getByRole('radio', { name: 'Connections' })
    expect(describedText(radio)).toBe('Only your connections.')
    await user.click(screen.getByText('Connections'))
    expect(readValues().value).toBe('connections')
    expect(screen.queryByText('Choose one.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.click(screen.getByText('All members'))
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })
})

describe('ImportanceField', () => {
  it('uses the reference labels and shows the must-have note live', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness initial={{ value: 'medium' }} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.ImportanceField label="Age importance" />}
          </form.AppField>
        )}
      </Harness>
    ))
    const group = await screen.findByRole('radiogroup', { name: 'Age importance' })
    const names = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.textContent)
    expect(names).toEqual(['Must have', 'Very important', 'Important', 'Nice to have'])
    expect(within(group).getByRole('radio', { name: 'Important' })).toBeChecked()
    expect(describedText(group)).toContain('How much this matters')
    expect(screen.queryByText(/are never shown as matches/)).not.toBeInTheDocument()

    await user.click(within(group).getByRole('radio', { name: 'Must have' }))
    expect(readValues().value).toBe('must')
    expect(screen.getByText(/are never shown as matches/)).toBeInTheDocument()
    // Tapping the selected choice again keeps a value.
    await user.click(within(group).getByRole('radio', { name: 'Must have' }))
    expect(readValues().value).toBe('must')

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.click(within(group).getByRole('radio', { name: 'Nice to have' }))
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })

  it('is disabled when the row has no preference', async () => {
    renderWithProviders(() => (
      <Harness initial={{ value: 'high' }}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.ImportanceField label="Height importance" disabled />}
          </form.AppField>
        )}
      </Harness>
    ))
    const group = await screen.findByRole('radiogroup', { name: 'Height importance' })
    for (const radio of within(group).getAllByRole('radio')) expect(radio).toBeDisabled()
  })
})

describe('MultiSelectField', () => {
  const schema = z.object({ value: z.array(z.string()).min(1, 'Choose at least one.') })

  it('adds chips from the searchable list, removes them and stops at max', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness initial={{ value: [] }} schema={schema} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.MultiSelectField label="Other languages" list="languages" max={2} />}
          </form.AppField>
        )}
      </Harness>
    ))
    const add = await screen.findByRole('button', { name: 'Add to Other languages' })
    expect(screen.getByText('(optional)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Choose at least one.')).toBeInTheDocument()
    expect(describedText(add)).toContain('Choose at least one.')

    await user.click(add)
    await user.keyboard('urdu{Enter}')
    expect(readValues().value).toEqual(['urdu'])
    expect(screen.queryByText('Choose at least one.')).not.toBeInTheDocument()
    // The list stays open for the next choice and no longer offers Urdu.
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).queryByRole('option', { name: 'Urdu' })).not.toBeInTheDocument()
    await user.click(within(listbox).getByRole('option', { name: 'English' }))
    expect(readValues().value).toEqual(['urdu', 'english'])

    expect(screen.getByRole('button', { name: 'Add to Other languages' })).toBeDisabled()
    expect(screen.getByText('You can choose up to 2.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Urdu' }))
    expect(readValues().value).toEqual(['english'])
    expect(screen.getByRole('button', { name: 'Add to Other languages' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove English' }))
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })
})

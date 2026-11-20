import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { referenceBootstrap } from '~/mocks/fixtures/reference'
import { renderWithProviders } from '~/test/render'
import { filterOptions } from './option-search'
import { describedText, Harness, readValues } from './test-harness'

const castes = referenceBootstrap.castes.map((caste) => ({
  code: caste.code,
  label: caste.name,
  aliases: caste.aliases,
}))
const SERVER_ERROR = { field: 'value', code: 'server_rule', message: 'Rejected by the server.' }

describe('filterOptions', () => {
  it('matches labels and aliases, ignoring case and accents, label prefixes first', () => {
    const options = [
      { code: 'a', label: 'Malik', aliases: [] },
      { code: 'b', label: 'Rajput', aliases: ['Raja'] },
      { code: 'c', label: 'Arāin', aliases: [] },
    ]
    expect(filterOptions(options, 'RAJA').map((option) => option.code)).toEqual(['b'])
    expect(filterOptions(options, 'arain').map((option) => option.code)).toEqual(['c'])
    expect(filterOptions(options, 'a').map((option) => option.code)).toEqual(['c', 'a', 'b'])
    expect(filterOptions(options, '  ')).toBe(options)
  })
})

describe('SearchSelectField', () => {
  const schema = z.object({ value: z.string({ error: 'Choose a caste.' }) })

  function setup(props: { required?: boolean; onOther?: (query: string) => void } = {}) {
    renderWithProviders(() => (
      <Harness initial={{ value: null }} schema={schema} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => (
              <field.SearchSelectField
                label="Caste or biradari"
                options={castes}
                required={props.required}
                otherOption={
                  props.onOther
                    ? { label: 'Other (type your own)', onSelect: props.onOther }
                    : undefined
                }
              />
            )}
          </form.AppField>
        )}
      </Harness>
    ))
  }

  it('renders a labelled combobox with "(optional)" and the field name', async () => {
    setup()
    const trigger = await screen.findByRole('combobox', { name: 'Caste or biradari (optional)' })
    expect(trigger).toHaveAttribute('name', 'value')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent('Select')
  })

  it('filters by alias and chooses with the mouse', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(await screen.findByRole('combobox', { name: 'Caste or biradari (optional)' }))
    const search = screen.getByRole('combobox', { name: 'Search: Caste or biradari' })
    expect(search).toHaveFocus()
    await user.type(search, 'pashtun')
    const listbox = screen.getByRole('listbox')
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Pathan'])
    await user.click(within(listbox).getByRole('option', { name: 'Pathan' }))
    expect(readValues().value).toBe('pathan')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'Caste or biradari (optional)' }),
    ).toHaveTextContent('Pathan')
  })

  it('works by keyboard: open, arrows, Enter, Escape', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = await screen.findByRole('combobox', { name: 'Caste or biradari (optional)' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    const search = screen.getByRole('combobox', { name: 'Search: Caste or biradari' })
    expect(search).toHaveFocus()
    await user.keyboard('sh')
    // "Sheikh" starts with "sh"; Syed matches through its alias "Shah".
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options[0]).toHaveTextContent('Sheikh')
    expect(search).toHaveAttribute('aria-activedescendant', options[0]?.id)
    await user.keyboard('{ArrowDown}')
    expect(search).toHaveAttribute('aria-activedescendant', options[1]?.id)
    await user.keyboard('{ArrowUp}{Enter}')
    expect(readValues().value).toBe('sheikh')
    expect(trigger).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(readValues().value).toBe('sheikh')
  })

  it('opens with the typed letter and clears with the clear button', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = await screen.findByRole('combobox', { name: 'Caste or biradari (optional)' })
    trigger.focus()
    await user.keyboard('m')
    expect(screen.getByRole('combobox', { name: 'Search: Caste or biradari' })).toHaveValue('m')
    await user.keyboard('ughal{Enter}')
    expect(readValues().value).toBe('mughal')
    await user.click(screen.getByRole('button', { name: 'Clear Caste or biradari' }))
    expect(readValues().value).toBeNull()
  })

  it('offers the other option with the typed text, and has no clear button when required', async () => {
    const user = userEvent.setup()
    const onOther = vi.fn()
    setup({ required: true, onOther })
    await user.click(await screen.findByRole('combobox', { name: 'Caste or biradari' }))
    await user.keyboard('Zzzz')
    expect(screen.getByText('No matches. Try another spelling.')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onOther).toHaveBeenCalledWith('Zzzz')
    expect(screen.queryByRole('button', { name: /^Clear/ })).not.toBeInTheDocument()
  })

  it('shows the Zod error after submit and a server error that clears on change', async () => {
    const user = userEvent.setup()
    setup({ required: true })
    const trigger = await screen.findByRole('combobox', { name: 'Caste or biradari' })
    expect(trigger).toHaveAttribute('aria-required', 'true')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Choose a caste.')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(describedText(trigger)).toContain('Choose a caste.')

    await user.click(trigger)
    await user.keyboard('Awan{Enter}')
    expect(readValues().value).toBe('awan')
    expect(screen.queryByText('Choose a caste.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    expect(describedText(trigger)).toContain('Rejected by the server.')
    await user.click(trigger)
    await user.keyboard('Butt{Enter}')
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
    expect(readValues().value).toBe('butt')
  })

  it('lists at most maxResults matches with a hint', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => (
      <Harness initial={{ value: null }}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.SearchSelectField label="Caste" options={castes} maxResults={5} />}
          </form.AppField>
        )}
      </Harness>
    ))
    await user.click(await screen.findByRole('combobox', { name: 'Caste (optional)' }))
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(5)
    expect(screen.getByText(/Showing the first 5 matches/)).toBeInTheDocument()
  })
})

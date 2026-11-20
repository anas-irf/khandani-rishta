import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { renderWithProviders } from '~/test/render'
import {
  type CityValue,
  cityValueFromSection,
  cityValueToSection,
  EMPTY_CITY_VALUE,
} from './city-picker-field'
import { describedText, Harness, readValues } from './test-harness'

const SERVER_ERROR = { field: 'place', code: 'server_rule', message: 'Rejected by the server.' }

const schema = z.object({
  place: z
    .object({
      country_code: z.string().nullable(),
      region_id: z.number().nullable(),
      city_id: z.number().nullable(),
      city_other: z.string().nullable(),
    })
    .loose()
    .refine((value) => value.city_id != null || (value.city_other ?? '').trim().length >= 2, {
      message: "Select a city, or choose 'My city is not listed' and type it.",
    }),
})

function setup(initial: CityValue = { ...EMPTY_CITY_VALUE, country_code: 'PK' }) {
  return renderWithProviders(() => (
    <Harness initial={{ place: initial }} schema={schema} serverErrors={[SERVER_ERROR]}>
      {(form) => (
        <form.AppField name="place">
          {(field) => <field.CityPickerField label="Where you live" required />}
        </form.AppField>
      )}
    </Harness>
  ))
}

const place = () => readValues().place as CityValue

describe('cityValueFromSection and cityValueToSection', () => {
  it('converts between the location section and the field value', () => {
    const city = {
      id: 1001,
      name: 'Lahore',
      region_id: 6,
      region_name: 'Punjab',
      country_code: 'PK',
    }
    expect(
      cityValueFromSection({
        country_code: 'PK',
        region_id: 6,
        city_id: 1001,
        city_other: null,
        city,
      }),
    ).toEqual({ country_code: 'PK', region_id: 6, city_id: 1001, city_other: null, city })
    expect(cityValueFromSection(null)).toEqual({ ...EMPTY_CITY_VALUE, country_code: 'PK' })
    expect(
      cityValueToSection({
        ...EMPTY_CITY_VALUE,
        country_code: 'PK',
        region_id: 6,
        city_other: ' Kot Addu ',
      }),
    ).toEqual({ country_code: 'PK', region_id: 6, city_id: null, city_other: 'Kot Addu' })
    expect(cityValueToSection({ ...EMPTY_CITY_VALUE, country_code: 'PK', city_other: '' })).toEqual(
      {
        country_code: 'PK',
        region_id: null,
        city_id: null,
        city_other: null,
      },
    )
  })
})

describe('CityPickerField', () => {
  it('loads regions and major cities, then searches and picks a city', async () => {
    const user = userEvent.setup()
    setup()
    expect(await screen.findByRole('group', { name: 'Where you live' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Country of residence' })).toHaveTextContent(
      'Pakistan',
    )
    const region = await screen.findByRole('combobox', { name: 'Province or state' })
    expect(within(region).getByRole('option', { name: 'Punjab' })).toBeInTheDocument()

    const city = screen.getByRole('combobox', { name: 'City' })
    expect(city).toHaveAttribute('name', 'place')
    await user.click(city)
    const listbox = screen.getByRole('listbox', { name: 'Cities' })
    // Before typing: the major cities, then "My city is not listed" as the last row.
    expect(await within(listbox).findByRole('option', { name: /Karachi/ })).toBeInTheDocument()
    const options = within(listbox).getAllByRole('option')
    expect(options.at(-1)).toHaveTextContent('My city is not listed')

    await user.type(city, 'Fais')
    await waitFor(() =>
      expect(within(listbox).getAllByRole('option')[0]).toHaveTextContent('Faisalabad'),
    )
    await user.keyboard('{Enter}')
    expect(place()).toMatchObject({ country_code: 'PK', city_id: expect.any(Number), region_id: 6 })
    expect(place().city?.name).toBe('Faisalabad')
    expect(city).toHaveValue('Faisalabad')
    expect(region).toHaveValue('6')
  })

  it('narrows the search to the chosen region and clears the city when the region changes', async () => {
    const user = userEvent.setup()
    setup()
    const region = await screen.findByRole('combobox', { name: 'Province or state' })
    await within(region).findByRole('option', { name: 'Sindh' })
    await user.selectOptions(region, 'Sindh')
    expect(place().region_id).toBe(7)
    const city = screen.getByRole('combobox', { name: 'City' })
    await user.click(city)
    const listbox = screen.getByRole('listbox', { name: 'Cities' })
    await waitFor(() =>
      expect(within(listbox).getAllByRole('option')[0]).toHaveTextContent('Karachi'),
    )
    expect(within(listbox).queryByRole('option', { name: /Lahore/ })).not.toBeInTheDocument()
    await user.click(within(listbox).getByRole('option', { name: /Hyderabad/ }))
    expect(place().city?.name).toBe('Hyderabad')

    await user.selectOptions(region, 'Punjab')
    expect(place()).toMatchObject({ region_id: 6, city_id: null, city: null })
    expect(city).toHaveValue('')
  })

  it('supports "My city is not listed" with a typed name, and going back', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByRole('combobox', { name: 'Province or state' })
    await user.click(screen.getByRole('button', { name: 'My city is not listed' }))
    const name = screen.getByRole('textbox', { name: 'City name' })
    expect(name).toHaveFocus()
    expect(name).toHaveAttribute('name', 'place')
    expect(screen.getByRole('combobox', { name: 'Province or state' })).toHaveAttribute(
      'aria-required',
      'true',
    )
    expect(place()).toMatchObject({ city_id: null, city_other: '' })
    await user.type(name, 'Kot Addu')
    expect(place().city_other).toBe('Kot Addu')

    await user.click(screen.getByRole('button', { name: 'Choose the city from the list instead' }))
    expect(place().city_other).toBeNull()
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveFocus()
  })

  it('offers "My city is not listed" as the last row of the list', async () => {
    const user = userEvent.setup()
    setup()
    const city = await screen.findByRole('combobox', { name: 'City' })
    await user.click(city)
    const listbox = screen.getByRole('listbox', { name: 'Cities' })
    await within(listbox).findByRole('option', { name: /Karachi/ })
    await user.click(within(listbox).getByRole('option', { name: 'My city is not listed' }))
    expect(screen.getByRole('textbox', { name: 'City name' })).toBeInTheDocument()
  })

  it('clears region and city when the country changes', async () => {
    const user = userEvent.setup()
    setup({
      country_code: 'PK',
      region_id: 6,
      city_id: 1001,
      city_other: null,
      city: { id: 1001, name: 'Lahore', region_id: 6, region_name: 'Punjab', country_code: 'PK' },
    })
    expect(await screen.findByRole('combobox', { name: 'City' })).toHaveValue('Lahore')
    await user.click(screen.getByRole('combobox', { name: 'Country of residence' }))
    await user.keyboard('United Arab{Enter}')
    expect(place()).toEqual({
      country_code: 'AE',
      region_id: null,
      city_id: null,
      city_other: null,
      city: null,
    })
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue('')
    const region = await screen.findByRole('combobox', { name: 'Province or state' })
    expect(await within(region).findByRole('option', { name: 'Dubai' })).toBeInTheDocument()
  })

  it('shows the Zod error after submit and a server error that clears on change', async () => {
    const user = userEvent.setup()
    setup()
    const city = await screen.findByRole('combobox', { name: 'City' })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const message = "Select a city, or choose 'My city is not listed' and type it."
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(city).toHaveAttribute('aria-invalid', 'true')
    expect(describedText(city)).toContain(message)

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.click(city)
    const listbox = screen.getByRole('listbox', { name: 'Cities' })
    await user.click(await within(listbox).findByRole('option', { name: /Karachi/ }))
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })
})

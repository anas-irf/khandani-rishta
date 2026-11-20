import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { db, type MockScenario, resetDb } from '~/mocks/db'
import { currentMe } from '~/mocks/handlers/account'
import { renderWithProviders } from '~/test/render'
import { SectionForm, type SectionFormProps } from '../SectionForm'

function setup(
  section: SectionFormProps['section'],
  scenario: MockScenario = 'onboarding_midway',
  prepare?: () => void,
) {
  resetDb(scenario)
  prepare?.()
  const onSaved = vi.fn()
  renderWithProviders(() => <SectionForm section={section} mode="onboarding" onSaved={onSaved} />, {
    me: structuredClone(currentMe()),
  })
  return { onSaved, user: userEvent.setup() }
}

type User = ReturnType<typeof userEvent.setup>

/** Opens a search select and picks an option by its label. */
async function pick(user: User, label: string, option: string, search?: string) {
  await user.click(screen.getByRole('combobox', { name: new RegExp(`^${label}`) }))
  if (search) await user.type(screen.getByRole('combobox', { name: `Search: ${label}` }), search)
  const list = screen.getByRole('listbox', { name: `Choices: ${label}` })
  await user.click(within(list).getByRole('option', { name: option }))
}

const emptyCommunity = {
  religion_code: null,
  sect_code: null,
  caste_code: null,
  caste_other: null,
  sub_caste_code: null,
  sub_caste_other: null,
  mother_tongue_code: null,
  language_codes: [],
}

describe('community (ONB-03)', () => {
  it('saves religion, sect, a listed caste with its sub-caste and the languages', async () => {
    const { user, onSaved } = setup('community', 'onboarding_midway', () => {
      db.ownProfile.community = emptyCommunity
    })
    const religion = await screen.findByRole('combobox', { name: 'Religion' })
    expect(screen.queryByRole('combobox', { name: /^Sect/ })).not.toBeInTheDocument()
    await user.selectOptions(religion, 'Islam')
    await pick(user, 'Sect', 'Shia')
    await pick(user, 'Caste or biradari', 'Rajput', 'rajpoot')
    await pick(user, 'Sub-caste or clan', 'Not specified')
    await pick(user, 'Mother tongue', 'Punjabi', 'punj')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.ownProfile.community).toMatchObject({
      religion_code: 'islam',
      sect_code: 'shia',
      caste_code: 'rajput',
      sub_caste_code: null,
      mother_tongue_code: 'punjabi',
    })
  })

  it('types an unlisted caste and requires 2 to 60 characters', async () => {
    const { user, onSaved } = setup('community')
    await user.click(await screen.findByRole('combobox', { name: /^Caste or biradari/ }))
    await user.click(screen.getByRole('option', { name: 'Other (type your own)' }))
    const typed = screen.getByLabelText('Your caste or biradari')
    await user.type(typed, 'K')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Enter 2 to 60 characters.')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    await user.type(typed, 'alhoro')
    await user.type(screen.getByLabelText(/^Sub-caste or clan/), 'Abro')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.ownProfile.community).toMatchObject({
      caste_code: null,
      caste_other: 'Kalhoro',
      sub_caste_other: 'Abro',
    })
  })

  it('requires the religion, the sect and the mother tongue', async () => {
    const { user } = setup('community', 'onboarding_midway', () => {
      db.ownProfile.community = emptyCommunity
    })
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Select a religion.')).toBeInTheDocument()
    expect(screen.getByText('Select a mother tongue.')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Religion' }), 'Islam')
    expect(await screen.findByText('Select a sect.')).toBeInTheDocument()
  })
})

describe('location (ONB-04)', () => {
  it('saves a listed city and asks for residency when living abroad', async () => {
    const { user, onSaved } = setup('location', 'onboarding_midway', () => {
      db.ownProfile.location = {
        ...db.ownProfile.location,
        city_id: null,
        region_id: null,
        city: null,
      }
    })
    const city = await screen.findByRole('combobox', { name: 'City' })
    await user.type(city, 'Kara')
    await user.click((await screen.findAllByRole('option', { name: /Karachi/ }))[0] as HTMLElement)
    await user.click(screen.getByRole('combobox', { name: /^Nationality/ }))
    await user.type(screen.getByRole('combobox', { name: 'Search: Nationality' }), 'United K')
    await user.click(
      within(screen.getByRole('listbox', { name: 'Choices: Nationality' })).getByRole('option', {
        name: 'United Kingdom',
      }),
    )
    expect(await screen.findByRole('combobox', { name: 'Residency status' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Select a residency status.')).toBeInTheDocument()
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Residency status' }),
      'Work visa',
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.ownProfile.location).toMatchObject({
      country_code: 'PK',
      nationality_code: 'GB',
      residency_status: 'work_visa',
    })
    expect(db.ownProfile.location.city?.name).toBe('Karachi')
  })

  it('requires a city or a typed city with its province', async () => {
    const { user, onSaved } = setup('location', 'onboarding_midway', () => {
      db.ownProfile.location = {
        ...db.ownProfile.location,
        city_id: null,
        region_id: null,
        city: null,
      }
    })
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText("Select a city, or choose 'My city is not listed' and type it."),
    ).toBeInTheDocument()
    await user.click(
      screen.getAllByRole('button', { name: 'My city is not listed' })[0] as HTMLElement,
    )
    await user.type(screen.getByLabelText('City name'), 'Chak 45')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Select a province or state.')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('education_career (ONB-05)', () => {
  it('hides the career fields for a student and saves', async () => {
    const { user, onSaved } = setup('education_career', 'onboarding_midway', () => {
      db.ownProfile.education_career = {
        ...db.ownProfile.education_career,
        employment_type: 'private_job',
        job_title: 'Analyst',
      }
    })
    expect(await screen.findByLabelText(/^Job title/)).toHaveValue('Analyst')
    expect(screen.getByRole('combobox', { name: /^Monthly income/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Prefer not to say' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '50,000 to 100,000 PKR' })).toBeInTheDocument()
    await pick(user, 'Employment', 'Student')
    expect(screen.queryByLabelText(/^Job title/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.ownProfile.education_career).toMatchObject({
      employment_type: 'student',
      job_title: null,
    })
  })

  it('requires the highest education and the employment', async () => {
    const { user, onSaved } = setup('education_career', 'onboarding_midway', () => {
      db.ownProfile.education_career = {
        ...db.ownProfile.education_career,
        education_level_code: null,
        employment_type: null,
      }
    })
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Select the highest education.')).toBeInTheDocument()
    expect(screen.getByText('Select an employment type.')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('switches the income currency and clears the choice', async () => {
    const { user } = setup('education_career')
    await user.click(await screen.findByRole('button', { name: 'Change currency' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'GBP')
    expect(screen.getByRole('option', { name: '1,200 to 2,000 GBP' })).toBeInTheDocument()
  })
})

describe('family (ONB-06)', () => {
  it('saves only what was entered; untouched steppers stay null', async () => {
    const { user, onSaved } = setup('family')
    const father = await screen.findByRole('radiogroup', { name: /^Father/ })
    await user.click(within(father).getByRole('radio', { name: 'Alive' }))
    await user.click(screen.getByRole('button', { name: 'Increase Brothers' }))
    await user.click(screen.getByRole('button', { name: 'Increase Brothers' }))
    await user.click(screen.getByRole('button', { name: 'Increase Married brothers' }))
    await user.type(screen.getByLabelText(/^Size/), '10')
    expect(screen.getByRole('combobox', { name: /^Unit/ })).toHaveValue('marla')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.ownProfile.family).toMatchObject({
      father_status: 'alive',
      brothers_count: 1,
      brothers_married: 0,
      sisters_count: null,
      home_size_value: 10,
      home_size_unit: 'marla',
    })
  })

  it('rejects a short text about the family', async () => {
    const { user, onSaved } = setup('family')
    await user.type(await screen.findByLabelText(/^About the family/), 'A small family.')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('Write at least 30 characters, or leave it empty for now.'),
    ).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('lifestyle (ONB-07)', () => {
  it('shows hijab for a Muslim woman, never beard, and saves', async () => {
    const { user, onSaved } = setup('lifestyle')
    expect(await screen.findByRole('combobox', { name: /^Hijab/ })).toBeInTheDocument()
    expect(screen.queryByText(/^Beard/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reading/ }))
    expect(screen.getByRole('button', { name: /Reading/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.ownProfile.lifestyle.hobby_codes).toEqual(['reading'])
  })

  it('builds a draft with "Help me write" and asks before replacing text', async () => {
    const { user } = setup('lifestyle')
    const about = await screen.findByLabelText(/^About you/)
    await user.click(screen.getByRole('button', { name: 'Help me write' }))
    expect((about as HTMLTextAreaElement).value).toMatch(/^I am \d+ years old and live in Lahore\./)
    await user.click(screen.getByRole('button', { name: 'Help me write' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Replace what you have written?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Replace' }))
    expect((about as HTMLTextAreaElement).value).toContain('I am looking for a life partner')
  })

  it('opens the collapsed appearance group and checks the weight', async () => {
    const { user, onSaved } = setup('lifestyle')
    const toggle = await screen.findByRole('button', { name: /Appearance and health/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    await user.type(screen.getByLabelText(/^Weight in kg/), '25')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Enter a weight between 30 and 200 kg.')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('requires 50 characters in the about text when it is not empty', async () => {
    const { user } = setup('lifestyle')
    await user.type(await screen.findByLabelText(/^About you/), 'Kind and honest.')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('Write at least 50 characters, or leave it empty for now.'),
    ).toBeInTheDocument()
  })
})

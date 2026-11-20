import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '~/lib/api'
import type { OwnProfile } from '~/lib/api-types'
import { todayInKarachi } from '~/lib/format'
import { qk } from '~/lib/query'
import { db, type MockScenario, resetDb } from '~/mocks/db'
import { currentMe } from '~/mocks/handlers/account'
import { apiError, apiUrl, validationError } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { SectionForm, type SectionFormProps } from './SectionForm'

function setup(
  props: Partial<SectionFormProps> & Pick<SectionFormProps, 'section'>,
  scenario: MockScenario = 'new',
) {
  resetDb(scenario)
  const onSaved = vi.fn()
  const view = renderWithProviders(
    () => <SectionForm mode="onboarding" onSaved={onSaved} {...props} />,
    { me: structuredClone(currentMe()) },
  )
  return { ...view, onSaved, user: userEvent.setup() }
}

/** YYYY-MM-DD `years` years ago, shifted by `days`. */
function birth(years: number, days = 0) {
  // Today in Asia/Karachi, like the age rule, so the test holds at any hour of the UTC day.
  const [year, month, day] = todayInKarachi().split('-').map(Number)
  return new Date(Date.UTC(year - years, month - 1, day + days))
}

async function chooseDate(user: ReturnType<typeof userEvent.setup>, date: Date) {
  const month = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(date)
  await user.selectOptions(screen.getByRole('combobox', { name: 'Day' }), String(date.getUTCDate()))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Month' }), month)
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Year' }),
    String(date.getUTCFullYear()),
  )
}

describe('SectionForm: loading and errors', () => {
  it('shows a form skeleton, then the form filled from a fresh GET', async () => {
    server.use(
      http.get(apiUrl('/v1/me/profile'), async () => {
        await delay(50)
        return undefined
      }),
    )
    setup({ section: 'basics' }, 'active')
    expect(await screen.findByRole('status', { busy: true })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.getByLabelText('First name')).toHaveValue('Ayesha')
  })

  it('shows the screen error state with Try again when the profile cannot be loaded', async () => {
    server.use(http.get(apiUrl('/v1/me/profile'), () => apiError(500, 'internal_error', 'Boom')))
    setup({ section: 'basics' })
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('maps validation_failed from the API under the fields with a summary at the top', async () => {
    server.use(
      http.put(apiUrl('/v1/me/profile/sections/basics'), () =>
        validationError([
          { field: 'first_name', code: 'invalid', message: 'Names only.' },
          { field: 'unknown_field', code: 'required', message: 'Server says no.' },
        ]),
      ),
    )
    const { user, onSaved } = setup({ section: 'basics' }, 'onboarding_midway')
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('Use letters only. Numbers and symbols are not allowed in a name.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Please check the highlighted fields.')).toBeInTheDocument()
    expect(screen.getByText('Server says no.')).toBeInTheDocument()
    expect(screen.getByLabelText('First name')).toHaveAttribute('aria-invalid', 'true')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows a network or server failure inline with Try again and keeps the input', async () => {
    let calls = 0
    server.use(
      http.put(apiUrl('/v1/me/profile/sections/basics'), () => {
        calls += 1
        if (calls === 1) return apiError(503, 'service_unavailable', 'Down')
        return undefined
      }),
    )
    const { user, onSaved } = setup({ section: 'basics' }, 'onboarding_midway')
    const firstName = await screen.findByLabelText('First name')
    await user.clear(firstName)
    await user.type(firstName, 'Zainab')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText(
        'Something went wrong on our side. Your earlier steps are saved. Please try again.',
      ),
    ).toBeInTheDocument()
    expect(firstName).toHaveValue('Zainab')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(db.ownProfile.basics.first_name).toBe('Zainab')
  })

  it('shows field errors thrown by onSaved (a failed continue)', async () => {
    const onSaved = vi.fn(async () => {
      throw new ApiError({
        status: 400,
        code: 'validation_failed',
        message: 'Missing',
        fields: [{ field: 'height_cm', code: 'required', message: 'Select a height.' }],
      })
    })
    resetDb('onboarding_midway')
    renderWithProviders(
      () => <SectionForm section="basics" mode="onboarding" onSaved={onSaved} />,
      { me: structuredClone(currentMe()) },
    )
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Select a height.')).toBeInTheDocument()
  })

  it('sets the own profile cache from the PUT response and keeps the button busy until onSaved settles', async () => {
    let release: () => void = () => undefined
    const onSaved = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    resetDb('onboarding_midway')
    const { queryClient } = renderWithProviders(
      () => <SectionForm section="basics" mode="onboarding" onSaved={onSaved} />,
      { me: structuredClone(currentMe()) },
    )
    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: 'Continue' })
    await user.click(button)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(button).toBeDisabled()
    expect(screen.getByLabelText('First name')).toBeDisabled()
    const cached = queryClient.getQueryData<OwnProfile>(qk.ownProfile())
    expect(cached?.basics.first_name).toBe('Ayesha')
    release()
    await waitFor(() => expect(button).toBeEnabled())
  })

  it('shows initial errors handed over by another screen', async () => {
    setup(
      {
        section: 'basics',
        initialErrors: [{ field: 'height_cm', code: 'required', message: 'Select a height.' }],
      },
      'onboarding_midway',
    )
    expect(await screen.findByText('Select a height.')).toBeInTheDocument()
  })
})

describe('account_for (ONB-01)', () => {
  it('saves the choice, the manager name and the consents', async () => {
    const { user, onSaved } = setup({ section: 'account_for' })
    await user.click(await screen.findByRole('radio', { name: /My son or daughter/ }))
    await user.type(screen.getByLabelText('Your name'), 'Rukhsana Khan')
    await user.click(screen.getByRole('checkbox', { name: /I agree to the Terms of Use/ }))
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I confirm that the person this profile is for is 18 years of age or older.',
      }),
    )
    await user.click(screen.getByRole('checkbox', { name: /they know about this profile/ }))
    expect(screen.getByRole('link', { name: /Privacy Policy/ })).toHaveAttribute('href', '/privacy')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(db.ownProfile.account_for).toEqual({
      managed_by: 'parent',
      manager_name: 'Rukhsana Khan',
    })
    expect(db.extra['profile.consents']).toEqual([
      'terms',
      'privacy',
      'community_guidelines',
      'age_declaration',
      'candidate_consent',
    ])
  })

  it('validates on the device, focuses the first invalid field and calls no API', async () => {
    const put = vi.fn()
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT') put()
    })
    const { user, onSaved } = setup({ section: 'account_for' })
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Choose who this profile is for.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Please agree to the Terms of Use, Privacy Policy and Community Guidelines.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Please confirm the age statement.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('radio')[0]).toHaveFocus())
    expect(put).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    server.events.removeAllListeners()
  })

  it('hides the manager name and consent 3 for myself', async () => {
    const { user } = setup({ section: 'account_for' })
    await user.click(await screen.findByRole('radio', { name: /Myself/ }))
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'I confirm that I am 18 years of age or older.' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /they know/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Marriage bureaus and paid agents/)).toBeInTheDocument()
  })

  it('in edit mode shows no consents unless moving away from myself', async () => {
    const { user } = setup({ section: 'account_for', mode: 'edit' }, 'active')
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /A friend/ }))
    expect(
      screen.getByRole('checkbox', { name: /they know about this profile/ }),
    ).toBeInTheDocument()
  })
})

describe('basics (ONB-02)', () => {
  it('saves a complete section', async () => {
    const { user, onSaved } = setup({ section: 'basics' })
    await user.type(await screen.findByLabelText('First name'), 'Bilal')
    await user.type(screen.getByLabelText(/Last name/), 'Ahmed')
    await user.click(screen.getByRole('radio', { name: 'Male' }))
    await chooseDate(user, birth(29))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Marital status' }), 'Divorced')
    await user.click(screen.getByRole('radio', { name: /Yes, living with me/ }))
    await user.click(screen.getByRole('button', { name: 'Increase How many children?' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Feet' }), '5')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Inches' }), '10')
    expect(
      screen.getByText(/They cannot be changed after the profile is created/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.ownProfile.basics).toMatchObject({
      first_name: 'Bilal',
      gender: 'male',
      marital_status: 'divorced',
      children_status: 'living_with_me',
      children_count: 1,
      height_cm: 178,
    })
  })

  it('refuses a candidate under 18 with the message for who the profile is for', async () => {
    const { user, onSaved } = setup({ section: 'basics' }, 'onboarding_midway')
    await screen.findByLabelText('First name')
    await chooseDate(user, birth(18, 1))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('You must be at least 18 years old to use Khandani Rishta.'),
    ).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('offers married only to men and asks for the number of wives', async () => {
    const { user } = setup({ section: 'basics' }, 'onboarding_midway')
    const marital = await screen.findByRole('combobox', { name: 'Marital status' })
    expect(within(marital).queryByRole('option', { name: /Married/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Male' }))
    await user.selectOptions(marital, 'Married (seeking another marriage)')
    expect(screen.getByRole('textbox', { name: 'Number of current wives' })).toBeInTheDocument()
  })

  it('asks before changing a saved gender during onboarding', async () => {
    const { user, onSaved } = setup({ section: 'basics' }, 'onboarding_midway')
    await user.click(await screen.findByRole('radio', { name: 'Male' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Change gender to Male?' })
    expect(
      within(dialog).getByText('Answers that depend on gender will be cleared.'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    expect(db.ownProfile.basics.gender).toBe('female')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Change' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.ownProfile.basics.gender).toBe('male')
  })

  it('shows locked fields read-only with how to correct them (08 section 2.2)', async () => {
    setup({ section: 'basics', mode: 'edit' }, 'active')
    expect(await screen.findByText('Gender')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Male' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Day' })).not.toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'support@example.com' })
    expect(links[0]).toHaveAttribute(
      'href',
      'mailto:support@example.com?subject=Correction%20request%20KR7Q2M',
    )
    expect(
      screen.queryByText(/They cannot be changed after the profile is created/),
    ).not.toBeInTheDocument()
  })

  it('keeps locked values unchanged when saving in edit mode', async () => {
    const { user, onSaved } = setup({ section: 'basics', mode: 'edit' }, 'active')
    const height = await screen.findByRole('combobox', { name: 'Inches' })
    await user.selectOptions(height, '6')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.ownProfile.basics).toMatchObject({ gender: 'female', date_of_birth: '1999-04-12' })
  })
})

describe('server error copy', () => {
  it('uses the screen text for a known field and code, else the API message', async () => {
    server.use(
      http.put(apiUrl('/v1/me/profile/sections/basics'), () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_failed',
              message: 'Invalid',
              fields: [{ field: 'date_of_birth', code: 'too_young', message: 'API text' }],
              details: {},
            },
          },
          { status: 400 },
        ),
      ),
    )
    resetDb('onboarding_midway')
    db.ownProfile.account_for = { managed_by: 'parent', manager_name: 'R K' }
    db.me.profile.managed_by = 'parent'
    renderWithProviders(() => <SectionForm section="basics" mode="onboarding" />, {
      me: structuredClone(currentMe()),
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('The person the profile is for must be at least 18 years old.'),
    ).toBeInTheDocument()
  })
})

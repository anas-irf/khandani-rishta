import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type { Preferences } from '~/lib/api-types'
import { qk } from '~/lib/query'
import { db, type MockScenario, resetDb } from '~/mocks/db'
import { makePreferences } from '~/mocks/factories'
import { currentMe } from '~/mocks/handlers/account'
import { preferenceDefaults } from '~/mocks/handlers/preferences'
import { apiError, apiUrl, validationError } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { PreferencesForm } from './PreferencesForm'

function setup(
  scenario: MockScenario = 'onboarding_midway',
  mode: 'onboarding' | 'edit' = 'onboarding',
) {
  resetDb(scenario)
  const onSaved = vi.fn()
  const view = renderWithProviders(() => <PreferencesForm mode={mode} onSaved={onSaved} />, {
    me: structuredClone(currentMe()),
  })
  return { ...view, onSaved, user: userEvent.setup() }
}

describe('PreferencesForm (ONB-09, ME-PREFS)', () => {
  it('shows the computed defaults and saves the full object even when nothing changed', async () => {
    const { user, onSaved, queryClient } = setup()
    const defaults = preferenceDefaults(db.ownProfile)
    expect(await screen.findByRole('combobox', { name: 'From' })).toHaveValue(
      String(defaults.age_min),
    )
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue(String(defaults.age_max))
    expect(screen.getByText('1 must-have')).toBeInTheDocument()
    expect(db.preferences).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(db.preferences).toMatchObject({
      age_min: defaults.age_min,
      age_max: defaults.age_max,
      religion_codes: ['islam'],
      religion_importance: 'must',
    })
    expect(queryClient.getQueryData<Preferences>(qk.preferences())?.age_min).toBe(defaults.age_min)
  })

  it('disables the importance of a row without a preference', async () => {
    const { user } = setup()
    const marital = await screen.findByRole('group', { name: /^Marital status/ })
    const importance = screen.getByRole('radiogroup', { name: /Importance: Marital status/ })
    expect(within(importance).getAllByRole('radio')[0]).toBeEnabled()
    await user.click(within(marital).getByRole('button', { name: /Never married/ }))
    expect(within(marital).getByText('Any')).toBeInTheDocument()
    expect(within(importance).getAllByRole('radio')[0]).toBeDisabled()
  })

  it('explains must-haves under the row and warns from five must-haves', async () => {
    const { user } = setup()
    const age = await screen.findByRole('radiogroup', { name: /Importance: Age/ })
    await user.click(within(age).getByRole('radio', { name: 'Must have' }))
    expect(
      screen.getAllByText(
        'Must have: members who do not fit, or who have not filled in this detail, are never shown as matches.',
      ).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('2 must-haves')).toBeInTheDocument()
    for (const row of ['Marital status', 'Location']) {
      const group = screen.getByRole('radiogroup', { name: new RegExp(`Importance: ${row}`) })
      await user.click(within(group).getByRole('radio', { name: 'Must have' }))
    }
    expect(screen.queryByText(/This can leave very few matches/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More preferences' }))
    const children = screen.getByRole('radiogroup', { name: /^Children/ })
    await user.click(within(children).getByRole('radio', { name: /No children/ }))
    const childImportance = screen.getByRole('radiogroup', { name: /Importance: Children/ })
    await user.click(within(childImportance).getByRole('radio', { name: 'Must have' }))
    expect(
      screen.getByText(
        'You have 5 must-haves. This can leave very few matches. Keep must-haves for true dealbreakers.',
      ),
    ).toBeInTheDocument()
  })

  it('checks the notes length and opens the second tier to show it', async () => {
    const { user, onSaved } = setup()
    await user.click(await screen.findByRole('button', { name: 'More preferences' }))
    await user.type(screen.getByLabelText(/^Anything else you are looking for/), 'Kind.')
    await user.click(screen.getByRole('button', { name: 'More preferences' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('Write at least 30 characters, or leave it empty.'),
    ).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows the moderation label of the partner notes', async () => {
    resetDb('active')
    db.preferences = makePreferences({ notes: 'Someone kind, educated and close to family.' })
    db.ownProfile.text_status.partner_notes = 'pending'
    renderWithProviders(() => <PreferencesForm mode="edit" />, { me: structuredClone(currentMe()) })
    const user = userEvent.setup()
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More preferences' }))
    expect(
      await screen.findByText(
        'Under review. Other members will see this text once it is approved.',
      ),
    ).toBeInTheDocument()
  })

  it('maps API errors of the combined age field', async () => {
    server.use(
      http.put(apiUrl('/v1/me/preferences'), () =>
        validationError([
          { field: 'age_min', code: 'invalid', message: 'Min above max.' },
          { field: 'city_ids', code: 'mismatch', message: 'Not in the countries.' },
        ]),
      ),
    )
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('The minimum age cannot be more than the maximum age.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Please check the highlighted fields.')).toBeInTheDocument()
  })

  it('shows the screen error state when the preferences cannot be loaded', async () => {
    server.use(http.get(apiUrl('/v1/me/preferences'), () => apiError(500, 'internal_error', 'x')))
    setup()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
  })
})

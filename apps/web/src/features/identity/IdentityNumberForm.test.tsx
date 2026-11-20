import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { db, type MockScenario, resetDb } from '~/mocks/db'
import { currentMe } from '~/mocks/handlers/account'
import { apiError, apiUrl, validationError } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { IdentityNumberForm } from './IdentityNumberForm'

function setup(
  mode: 'onboarding' | 'me' = 'onboarding',
  scenario: MockScenario = 'onboarding_midway',
  prepare?: () => void,
) {
  resetDb(scenario)
  prepare?.()
  const onSaved = vi.fn()
  const view = renderWithProviders(() => <IdentityNumberForm mode={mode} onSaved={onSaved} />, {
    me: structuredClone(currentMe()),
  })
  return { ...view, onSaved, user: userEvent.setup() }
}

describe('IdentityNumberForm (ONB-10, ME-VERIFY-ID step 1)', () => {
  it('preselects CNIC, shows the consent text and enables Continue only at 13 digits', async () => {
    const { user, onSaved } = setup()
    expect(await screen.findByRole('combobox', { name: 'Document' })).toHaveValue('cnic')
    expect(
      screen.getByRole('heading', { name: 'Why we ask for the CNIC number' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('It is never shown on the profile or to any other member.'),
    ).toBeInTheDocument()
    const number = screen.getByLabelText('CNIC number')
    const button = screen.getByRole('button', { name: 'Continue' })
    await user.type(number, '352021234567')
    expect(button).toBeDisabled()
    await user.type(number, '2')
    expect(number).toHaveValue('35202-1234567-2')
    expect(button).toBeEnabled()
    await user.click(button)
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ document_type: 'cnic', number_masked: '*********5672' }),
      ),
    )
    expect(db.identity?.number_masked).toBe('*********5672')
  })

  it('preselects NICOP abroad and passport for another nationality', async () => {
    setup('onboarding', 'onboarding_midway', () => {
      db.ownProfile.location = { ...db.ownProfile.location, country_code: 'GB' }
    })
    expect(await screen.findByRole('combobox', { name: 'Document' })).toHaveValue('nicop')
  })

  it('names the candidate on a managed profile', async () => {
    setup('onboarding', 'onboarding_midway', () => {
      db.ownProfile.account_for = { managed_by: 'parent', manager_name: 'Rukhsana' }
      db.ownProfile.basics = { ...db.ownProfile.basics, first_name: 'Ayesha', gender: 'female' }
    })
    expect(await screen.findByText("Enter Ayesha's number, not your own.")).toBeInTheDocument()
    expect(screen.getByLabelText('Her CNIC number')).toBeInTheDocument()
  })

  it('shows the gender mismatch under the field with a link to the basics step', async () => {
    const { user, onSaved } = setup()
    await user.type(await screen.findByLabelText('CNIC number'), '3520212345671')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText(
        'This number does not match the gender on the profile. Please check the number and the gender. If both are correct, contact support.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go back to the basics step' })).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows the API message for invalid numbers', async () => {
    const { user } = setup()
    await user.type(await screen.findByLabelText('CNIC number'), '9520212345672')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('This does not look like a valid CNIC number.'),
    ).toBeInTheDocument()
  })

  it('opens "Already registered" for identity_already_registered', async () => {
    const { user, onSaved } = setup()
    await user.type(await screen.findByLabelText('CNIC number'), '3520199999992')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const dialog = await screen.findByRole('dialog', { name: 'Already registered' })
    expect(within(dialog).getByRole('link', { name: 'support@example.com' })).toHaveAttribute(
      'href',
      'mailto:support@example.com',
    )
    await user.click(within(dialog).getByRole('button', { name: 'OK' }))
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('explains invalid_state when the document is being verified', async () => {
    server.use(http.put(apiUrl('/v1/me/identity'), () => apiError(409, 'invalid_state', 'x')))
    const { user } = setup('me', 'active')
    await user.type(await screen.findByLabelText('CNIC number'), '3520212345672')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText(
        'This document is being verified or is already verified, so it cannot be changed here.',
      ),
    ).toBeInTheDocument()
  })

  it('validates a passport on the device', async () => {
    const { user } = setup()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Document' }), 'passport')
    await user.type(screen.getByLabelText('Passport number'), 'abcdefg')
    expect(screen.getByLabelText('Passport number')).toHaveValue('ABCDEFG')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('A passport number has 6 to 12 letters and digits.'),
    ).toBeInTheDocument()
  })

  it('on ONB-10 shows a saved number read-only; Continue only reports it', async () => {
    const { user, onSaved } = setup('onboarding', 'active')
    expect(await screen.findByText('CNIC: *********1234')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ number_masked: '*********1234' }),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByLabelText('CNIC number')).toHaveValue('')
  })

  it('maps a required number from the API', async () => {
    server.use(
      http.put(apiUrl('/v1/me/identity'), () =>
        validationError([{ field: 'number', code: 'required', message: 'Enter the number.' }]),
      ),
    )
    const { user } = setup('me', 'active')
    await user.type(await screen.findByLabelText('CNIC number'), '3520212345672')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Enter the number.')).toBeInTheDocument()
  })
})

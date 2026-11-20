import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { renderWithProviders } from '~/test/render'
import { Harness } from './test-harness'

const schema = z.object({
  first_name: z.string({ error: 'Enter the first name.' }),
  last_name: z.string({ error: 'Enter the last name.' }),
})

function setup(onSubmit: (values: Record<string, unknown>) => unknown = vi.fn()) {
  return renderWithProviders(() => (
    <Harness
      initial={{ first_name: null, last_name: null }}
      schema={schema}
      onSubmit={onSubmit}
      serverErrors={[
        { field: 'last_name', code: 'server_rule', message: 'Last name rejected.' },
        { field: 'nickname', code: 'server_rule', message: 'Nickname is not allowed.' },
      ]}
    >
      {(form) => (
        <>
          <form.AppField name="first_name">
            {(field) => <field.TextField label="First name" required />}
          </form.AppField>
          <form.AppField name="last_name">
            {(field) => <field.TextField label="Last name" required />}
          </form.AppField>
        </>
      )}
    </Harness>
  ))
}

describe('SubmitButton', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a spinner and disables the button and inputs while submitting', async () => {
    const user = userEvent.setup()
    let finish: () => void = () => {}
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    setup(onSubmit)
    await user.type(await screen.findByLabelText('First name'), 'Ayesha')
    await user.type(screen.getByLabelText('Last name'), 'Khan')
    const button = screen.getByRole('button', { name: 'Save' })
    await user.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'))
    expect(button).toBeDisabled()
    expect(screen.getByLabelText('First name')).toBeDisabled()
    await user.click(button)
    expect(onSubmit).toHaveBeenCalledTimes(1)

    await act(async () => finish())
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'))
    expect(button).toBeEnabled()
    expect(screen.getByLabelText('First name')).toBeEnabled()
  })

  it('is disabled while offline', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    setup()
    const button = await screen.findByRole('button', { name: 'Save' })
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(button).toBeDisabled()
    online.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(button).toBeEnabled()
  })
})

describe('FormErrorSummary', () => {
  it('appears after a failed submit and focuses the first invalid field', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByLabelText('First name')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please check the highlighted fields.',
    )
    await waitFor(() => expect(screen.getByLabelText('First name')).toHaveFocus())
  })

  it('lists server errors that match no field, and the matched ones under their field', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByLabelText('First name')
    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Please check the highlighted fields.')
    expect(alert).toHaveTextContent('Nickname is not allowed.')
    expect(screen.getByText('Last name rejected.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Last name')).toHaveFocus())
  })
})

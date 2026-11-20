import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { limitDialogStore, showLimitDialog } from '~/lib/dialogs'
import { makeMe } from '~/mocks/factories'
import { renderWithProviders } from '~/test/render'
import { GlobalDialogs } from './GlobalDialogs'

describe('LimitDialog', () => {
  it('shows the default text of 16 section 1.3 and closes with OK', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => <GlobalDialogs />, { me: makeMe() })

    act(() =>
      showLimitDialog({
        textKey: null,
        details: { limit: 10, used: 10, resets_at: '2026-11-20T19:00:00Z' },
      }),
    )

    const dialog = await screen.findByRole('alertdialog', { name: 'Limit reached' })
    expect(dialog).toHaveTextContent(
      'You have reached a limit for today. It resets at midnight, Pakistan time.',
    )

    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(limitDialogStore.get()).toBeNull()
  })

  it("shows the action's own text with the support email from Me", async () => {
    renderWithProviders(() => <GlobalDialogs />, {
      me: makeMe({ config: { support_email: 'help@rishta.test' } }),
    })

    act(() => showLimitDialog({ textKey: 'shared:report.limit', details: {} }))

    expect(
      await screen.findByText(
        'You have sent the maximum number of reports for today. For urgent safety concerns write to help@rishta.test.',
      ),
    ).toBeInTheDocument()
    act(() => limitDialogStore.set(null))
  })
})

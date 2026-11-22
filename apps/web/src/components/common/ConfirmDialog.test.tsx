import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '~/test/render'
import { ConfirmDialog } from './ConfirmDialog'

function Harness({ onConfirm }: { onConfirm: () => unknown }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <p>{open ? 'open' : 'closed'}</p>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete the account?"
        description="Everything is removed after 30 days."
        confirmLabel="Delete account"
        tone="danger"
        confirmPhrase="DELETE"
        onConfirm={onConfirm}
      />
    </>
  )
}

describe('ConfirmDialog', () => {
  it('enables the confirm button only once the phrase is typed, then closes', async () => {
    let finish: () => void = () => {}
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const user = userEvent.setup()
    renderWithProviders(() => <Harness onConfirm={onConfirm} />)

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete the account?' })
    expect(dialog).toHaveTextContent('Everything is removed after 30 days.')
    const confirm = screen.getByRole('button', { name: 'Delete account' })
    expect(confirm).toBeDisabled()

    const field = screen.getByLabelText('Type DELETE to confirm')
    await user.type(field, 'delete')
    expect(confirm).toBeDisabled()

    await user.clear(field)
    await user.type(field, 'DELETE')
    expect(confirm).toBeEnabled()

    await user.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Delete account' })).toHaveAttribute(
      'aria-busy',
      'true',
    )

    finish()
    await waitFor(() => expect(screen.getByText('closed')).toBeInTheDocument())
  })

  it('stays open when the action fails', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => <Harness onConfirm={() => Promise.reject(new Error('no'))} />)

    await user.type(await screen.findByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(screen.getByRole('button', { name: 'Delete account' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete account' })).toBeEnabled(),
    )
    expect(screen.getByText('open')).toBeInTheDocument()
  })

  it('closes with Cancel without confirming', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(() => <Harness onConfirm={onConfirm} />)

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('closed')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

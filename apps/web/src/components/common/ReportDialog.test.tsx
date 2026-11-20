import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { useState } from 'react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReportBody } from '~/lib/api-types'
import { db } from '~/mocks/db'
import { makeMe } from '~/mocks/factories'
import { apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { ReportDialog, type ReportSubjectRef } from './ReportDialog'

const PROFILE_ID = '10000000-0000-4000-8000-000000000010'

// Toasts live in a module-level store: drop the ones of the previous test.
afterEach(() => {
  toast.dismiss()
})

function Harness({ subject, onBlocked }: { subject?: ReportSubjectRef; onBlocked?: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <p>{open ? 'open' : 'closed'}</p>
      <ReportDialog
        open={open}
        onOpenChange={setOpen}
        profileId={PROFILE_ID}
        name="Hassan N."
        subject={subject}
        onBlocked={onBlocked}
      />
    </>
  )
}

describe('ReportDialog', () => {
  it('sends the reason, details and subject, and confirms with the text of 13 section 6.4', async () => {
    let body: ReportBody | null = null
    server.use(
      http.post(apiUrl('/v1/reports'), async ({ request }) => {
        body = (await request.json()) as ReportBody
        return HttpResponse.json({ id: 'report-1' }, { status: 201 })
      }),
    )
    const onBlocked = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      () => <Harness subject={{ type: 'message', messageId: 'msg-7' }} onBlocked={onBlocked} />,
      { me: makeMe() },
    )

    expect(await screen.findByRole('dialog', { name: 'Report Hassan N.' })).toBeInTheDocument()
    const alsoBlock = screen.getByRole('checkbox', { name: 'Also block this member' })
    expect(alsoBlock).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Harassment or abusive behaviour' }))
    await user.type(screen.getByLabelText(/Tell us more/), '  Rude messages.  ')
    await user.click(alsoBlock)
    await user.click(screen.getByRole('button', { name: 'Send report' }))

    await waitFor(() => expect(screen.getByText('closed')).toBeInTheDocument())
    expect(body).toEqual({
      target_profile_id: PROFILE_ID,
      subject_type: 'message',
      message_id: 'msg-7',
      reason: 'harassment',
      details: 'Rude messages.',
      also_block: false,
    })
    expect(
      await screen.findByText(
        'Thank you. Our team will review this report. We do not tell the other member who reported them.',
      ),
    ).toBeInTheDocument()
    // Tip 12 follows for harassment (13 section 11.3).
    expect(screen.getByText(/If you are threatened or blackmailed/)).toBeInTheDocument()
    expect(onBlocked).not.toHaveBeenCalled()
  })

  it('asks for a reason before sending', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => <Harness />, { me: makeMe() })

    await user.click(await screen.findByRole('button', { name: 'Send report' }))

    expect(screen.getByText('Please choose a reason.')).toBeInTheDocument()
    expect(screen.getByText('open')).toBeInTheDocument()
  })

  it('blocks too when "Also block" stays ticked, then goes back', async () => {
    const onBlocked = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(() => <Harness onBlocked={onBlocked} />, { me: makeMe() })

    await user.click(await screen.findByRole('radio', { name: 'Fake profile' }))
    await user.click(screen.getByRole('button', { name: 'Send report' }))

    await waitFor(() => expect(onBlocked).toHaveBeenCalledTimes(1))
    expect(db.blocks.map((entry) => entry.profile_id)).toContain(PROFILE_ID)
    expect(screen.queryByText(/If you are threatened/)).not.toBeInTheDocument()
  })
})

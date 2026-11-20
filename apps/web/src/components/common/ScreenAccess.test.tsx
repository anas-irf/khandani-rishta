import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProfileStatus } from '~/lib/api-types'
import type { LeveledScreen } from '~/lib/gate'
import { makeMe } from '~/mocks/factories'
import { renderWithProviders } from '~/test/render'
import { ScreenAccess } from './ScreenAccess'

function renderScreen(screenId: LeveledScreen, status: ProfileStatus, allowed?: boolean) {
  return renderWithProviders(
    () => (
      <ScreenAccess screen={screenId} allowed={allowed}>
        <p>Screen content</p>
      </ScreenAccess>
    ),
    { me: makeMe({ profile: { status } }) },
  )
}

describe('ScreenAccess', () => {
  it('passes through for an active profile', async () => {
    renderScreen('APP-HOME', 'active')
    expect(await screen.findByText('Screen content')).toBeInTheDocument()
  })

  it('shows the paused panel on a screen that needs browse', async () => {
    renderScreen('APP-SEARCH', 'paused')
    expect(
      await screen.findByRole('heading', { name: 'The profile is paused' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Screen content')).not.toBeInTheDocument()
  })

  it('keeps engage screens open while paused, and closes them when closed', async () => {
    const { unmount } = renderScreen('APP-INTERESTS', 'paused')
    expect(await screen.findByText('Screen content')).toBeInTheDocument()
    unmount()

    renderScreen('APP-INTERESTS', 'closed')
    expect(
      await screen.findByRole('heading', { name: 'The profile is closed' }),
    ).toBeInTheDocument()
  })

  it('keeps chats open when closed', async () => {
    renderScreen('APP-CHATS', 'closed')
    expect(await screen.findByText('Screen content')).toBeInTheDocument()
  })

  it('shows the screen when the caller allows it (a counterpart on APP-PROFILE)', async () => {
    renderScreen('APP-PROFILE', 'paused', true)
    expect(await screen.findByText('Screen content')).toBeInTheDocument()
  })
})

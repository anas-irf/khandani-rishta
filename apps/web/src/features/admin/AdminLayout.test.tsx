import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdminLayout } from './AdminLayout'
import { renderAdmin } from './test-utils'

describe('AdminLayout role guard', () => {
  it('shows "Not found" to a member and no console navigation', async () => {
    renderAdmin(() => <AdminLayout />, 'member')

    expect(
      await screen.findByText('The page you are looking for does not exist.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Staff console sections' }),
    ).not.toBeInTheDocument()
  })

  it('hides the admin-only entries from a moderator and shows queue counts', async () => {
    renderAdmin(() => <AdminLayout />, 'moderator')

    const nav = await screen.findByRole('navigation', { name: 'Staff console sections' })
    for (const label of [
      'Overview',
      'Profiles',
      'Photos',
      'Text',
      'Verification',
      'Reports',
      'Users',
      'Castes',
    ]) {
      expect(within(nav).getByRole('link', { name: new RegExp(`^${label}`) })).toBeInTheDocument()
    }
    for (const label of ['Settings', 'Releases', 'Announcements', 'Audit log']) {
      expect(within(nav).queryByRole('link', { name: label })).not.toBeInTheDocument()
    }
    // 8 profiles wait for review in the mock data.
    expect(await within(nav).findByRole('link', { name: 'Profiles 8 waiting' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the app' })).toHaveAttribute('href', '/home')
  })

  it('shows every entry to an admin', async () => {
    renderAdmin(() => <AdminLayout />, 'admin')

    const nav = await screen.findByRole('navigation', { name: 'Staff console sections' })
    for (const label of ['Settings', 'Releases', 'Announcements', 'Audit log']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })
})

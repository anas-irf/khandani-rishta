import { screen } from '@testing-library/react'
import { HttpResponse, http as mswHttp } from 'msw'
import { describe, expect, it } from 'vitest'
import type { AppRelease } from '~/lib/api-types'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { DownloadPage } from './DownloadPage'
import { isSafeDownloadUrl, loadAndroidRelease } from './release'

const release: AppRelease = {
  version_code: 12,
  version_name: '1.3.0',
  min_supported_version_code: 9,
  download_url: 'https://download.example.com/khandani-rishta-1.3.0.apk',
  release_notes: 'Faster chat.\nClearer photo requests.',
}

describe('DownloadPage (PUB-DOWNLOAD)', () => {
  it('shows the version, the notes, the download button and the install steps', async () => {
    renderWithProviders(() => <DownloadPage result={{ status: 'ready', release }} />)

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Download the Android app',
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Version 1.3.0' })).toBeInTheDocument()

    const button = screen.getByRole('link', { name: 'Download for Android' })
    expect(button).toHaveAttribute('href', release.download_url)
    expect(button).toHaveAttribute('rel', 'noopener noreferrer')

    expect(screen.getByText(/Faster chat\./)).toBeInTheDocument()
    expect(screen.getByText('Android 8.0 or later.')).toBeInTheDocument()
    expect(screen.getByText(/allow 'Install unknown apps'/)).toBeInTheDocument()
    expect(screen.getByText('A warning from your phone is normal')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in the browser' })).toBeInTheDocument()
  })

  it('shows release notes as plain text, never as HTML', async () => {
    const { container } = renderWithProviders(() => (
      <DownloadPage
        result={{ status: 'ready', release: { ...release, release_notes: '<b>Bold</b> notes' } }}
      />
    ))
    await screen.findByRole('heading', { level: 1 })

    expect(screen.getByText('<b>Bold</b> notes')).toBeInTheDocument()
    expect(container.querySelector('b')).toBeNull()
  })

  it('omits the notes section when there are no release notes', async () => {
    renderWithProviders(() => (
      <DownloadPage result={{ status: 'ready', release: { ...release, release_notes: null } }} />
    ))
    await screen.findByRole('heading', { level: 1 })

    expect(screen.queryByText('What is new')).not.toBeInTheDocument()
  })

  it('explains that the app is not available yet when there is no release', async () => {
    renderWithProviders(() => <DownloadPage result={{ status: 'none' }} />)

    expect(await screen.findByText('The Android app is not available yet')).toBeInTheDocument()
    expect(screen.getByText(/You can use Khandani Rishta in your browser now/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create a free profile' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Download for Android' })).not.toBeInTheDocument()
    expect(screen.queryByText('How to install')).not.toBeInTheDocument()
  })

  it('does not crash when the release could not be loaded, and offers another try', async () => {
    renderWithProviders(() => <DownloadPage result={{ status: 'error' }} />)

    expect(
      await screen.findByText('The Android app download is not available right now'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Download for Android' })).not.toBeInTheDocument()
  })
})

describe('loadAndroidRelease', () => {
  it('returns the release of the API', async () => {
    server.use(mswHttp.get(apiUrl('/v1/meta/app-release'), () => HttpResponse.json(release)))
    expect(await loadAndroidRelease()).toEqual({ status: 'ready', release })
  })

  it('asks for the android release without a token', async () => {
    let platform: string | null = null
    let authorization: string | null = null
    server.use(
      mswHttp.get(apiUrl('/v1/meta/app-release'), ({ request }) => {
        platform = new URL(request.url).searchParams.get('platform')
        authorization = request.headers.get('authorization')
        return HttpResponse.json(release)
      }),
    )
    await loadAndroidRelease()
    expect(platform).toBe('android')
    expect(authorization).toBeNull()
  })

  it('treats 404 as "no release yet"', async () => {
    server.use(
      mswHttp.get(apiUrl('/v1/meta/app-release'), () =>
        apiError(404, 'not_found', 'No release yet.'),
      ),
    )
    expect(await loadAndroidRelease()).toEqual({ status: 'none' })
  })

  it('turns a server error and a network failure into an error result', async () => {
    server.use(
      mswHttp.get(apiUrl('/v1/meta/app-release'), () =>
        apiError(500, 'internal_error', 'Something went wrong.'),
      ),
    )
    expect(await loadAndroidRelease()).toEqual({ status: 'error' })

    server.use(mswHttp.get(apiUrl('/v1/meta/app-release'), () => HttpResponse.error()))
    expect(await loadAndroidRelease()).toEqual({ status: 'error' })
  })

  it('refuses a download link that is not a web address', async () => {
    const scriptUrl = ['javascript', 'alert(1)'].join(':')
    server.use(
      mswHttp.get(apiUrl('/v1/meta/app-release'), () =>
        HttpResponse.json({ ...release, download_url: scriptUrl }),
      ),
    )
    expect(await loadAndroidRelease()).toEqual({ status: 'none' })
    expect(isSafeDownloadUrl('https://download.example.com/a.apk')).toBe(true)
    expect(isSafeDownloadUrl(scriptUrl)).toBe(false)
    expect(isSafeDownloadUrl('')).toBe(false)
  })
})

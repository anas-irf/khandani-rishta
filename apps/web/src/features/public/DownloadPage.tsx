import { Link, useRouter } from '@tanstack/react-router'
import { Download, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { signInLink } from './config'
import { CreateProfileButton, PageHero, Prose, useList } from './content'
import type { ReleaseResult } from './release'

/**
 * PUB-DOWNLOAD (16 section 7.8): the Android app. The release comes from the route loader
 * (`loadAndroidRelease`); with no release, or when the API fails, the page says so and offers
 * the web app instead. Release notes are plain text, never HTML.
 */
export function DownloadPage({ result }: { result: ReleaseResult }) {
  const { t } = useTranslation('public')

  return (
    <>
      <PageHero title={t('download.title')} lead={t('download.lead')} />
      <Prose>
        <div className="max-w-3xl space-y-10">
          {result.status === 'ready' ? (
            <ReleaseSections result={result} />
          ) : (
            <Unavailable result={result} />
          )}
          <BrowserSection />
        </div>
      </Prose>
    </>
  )
}

function ReleaseSections({ result }: { result: Extract<ReleaseResult, { status: 'ready' }> }) {
  const { t } = useTranslation('public')
  const steps = useList<string>('download.install.steps')
  const { release } = result

  return (
    <>
      <section
        aria-labelledby="download-version"
        className="space-y-4 rounded-[var(--radius-card)] border border-border bg-surface p-5 md:p-6"
      >
        <div className="flex items-center gap-3">
          <Smartphone aria-hidden="true" className="size-8 shrink-0 text-primary" />
          <h2 id="download-version" className="text-2xl font-semibold">
            {t('download.ready.version', { version: release.version_name })}
          </h2>
        </div>
        <Button asChild size="lg">
          <a href={release.download_url} rel="noopener noreferrer">
            <Download aria-hidden="true" />
            {t('download.ready.button')}
          </a>
        </Button>
        {release.release_notes ? (
          <div className="space-y-1">
            <h3 className="font-semibold">{t('download.ready.notes_title')}</h3>
            <p className="whitespace-pre-line leading-relaxed text-muted-foreground">
              {release.release_notes}
            </p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="download-requirements" className="space-y-2">
        <h2 id="download-requirements" className="text-2xl font-semibold">
          {t('download.requirements.title')}
        </h2>
        <p>{t('download.requirements.body')}</p>
      </section>

      <section aria-labelledby="download-install" className="space-y-3">
        <h2 id="download-install" className="text-2xl font-semibold">
          {t('download.install.title')}
        </h2>
        <ol className="list-decimal space-y-2 ps-6 leading-relaxed marker:font-semibold marker:text-primary">
          {steps.map((step) => (
            <li key={step} className="ps-1">
              {step}
            </li>
          ))}
        </ol>
        <Alert variant="warning">
          <AlertTitle>{t('download.install.warning_title')}</AlertTitle>
          <AlertDescription>
            <p>{t('download.install.warning_body')}</p>
          </AlertDescription>
        </Alert>
      </section>

      <section aria-labelledby="download-updates" className="space-y-2">
        <h2 id="download-updates" className="text-2xl font-semibold">
          {t('download.updates.title')}
        </h2>
        <p>{t('download.updates.body')}</p>
      </section>
    </>
  )
}

/** No release yet (`404`), or the API could not be reached. */
function Unavailable({ result }: { result: Exclude<ReleaseResult, { status: 'ready' }> }) {
  const { t } = useTranslation('public')
  const router = useRouter()
  const key = result.status === 'error' ? 'download.error' : 'download.none'

  return (
    <section
      aria-labelledby="download-unavailable"
      className="space-y-4 rounded-[var(--radius-card)] border border-border bg-surface p-5 md:p-6"
    >
      <h2 id="download-unavailable" className="text-2xl font-semibold">
        {t(`${key}.title`)}
      </h2>
      <p className="leading-relaxed">{t(`${key}.body`)}</p>
      <div className="flex flex-wrap gap-3">
        <CreateProfileButton />
        {result.status === 'error' ? (
          <Button variant="outline" size="lg" onClick={() => void router.invalidate()}>
            {t('download.error.retry')}
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function BrowserSection() {
  const { t } = useTranslation('public')
  return (
    <section aria-labelledby="download-browser" className="space-y-3">
      <h2 id="download-browser" className="text-2xl font-semibold">
        {t('download.browser.title')}
      </h2>
      <p>{t('download.browser.body')}</p>
      <Button asChild size="lg" variant="outline">
        <Link {...signInLink}>{t('download.browser.button')}</Link>
      </Button>
    </section>
  )
}

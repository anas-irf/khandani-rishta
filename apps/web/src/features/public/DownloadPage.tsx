import { Link, useRouter } from '@tanstack/react-router'
import { Download, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ArchIcon } from '~/components/common/Arch'
import { SectionHeading } from '~/components/common/SectionHeading'
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
        {result.status === 'ready' ? (
          <ReleaseSections result={result} />
        ) : (
          <Unavailable result={result} />
        )}
        <BrowserSection />
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
        className="band-sand flex flex-col items-start gap-4 rounded-xl p-[clamp(24px,3vw,40px)]"
      >
        <div className="flex max-w-full items-center gap-4">
          <ArchIcon icon={Smartphone} />
          <h2 id="download-version" className="min-w-0 text-headline-sm">
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
          <div className="flex flex-col gap-1">
            <h3 className="text-emphasis">{t('download.ready.notes_title')}</h3>
            <p className="whitespace-pre-line text-foreground-secondary">{release.release_notes}</p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="download-requirements" className="flex flex-col gap-2">
        <SectionHeading id="download-requirements" title={t('download.requirements.title')} />
        <p>{t('download.requirements.body')}</p>
      </section>

      <section aria-labelledby="download-install" className="flex flex-col gap-3">
        <SectionHeading id="download-install" title={t('download.install.title')} />
        <ol className="max-w-measure list-decimal space-y-2 ps-[32px] text-body-lg marker:font-bold marker:text-primary">
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

      <section aria-labelledby="download-updates" className="flex flex-col gap-2">
        <SectionHeading id="download-updates" title={t('download.updates.title')} />
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
      className="band-sand flex flex-col items-start gap-4 rounded-xl p-[clamp(24px,3vw,40px)]"
    >
      <h2 id="download-unavailable" className="max-w-full text-headline-sm">
        {t(`${key}.title`)}
      </h2>
      <p className="max-w-measure text-body-lg">{t(`${key}.body`)}</p>
      <div className="flex flex-wrap gap-3">
        <CreateProfileButton />
        {result.status === 'error' ? (
          <Button variant="secondary" size="lg" onClick={() => void router.invalidate()}>
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
    <section aria-labelledby="download-browser" className="flex flex-col items-start gap-3">
      <SectionHeading id="download-browser" title={t('download.browser.title')} />
      <p>{t('download.browser.body')}</p>
      <Button asChild size="lg" variant="secondary">
        <Link {...signInLink}>{t('download.browser.button')}</Link>
      </Button>
    </section>
  )
}

import { useTranslation } from 'react-i18next'
import { LogoMark } from '~/components/layout/Logo'
import { Spinner } from '~/components/ui/spinner'

/** Full-screen splash while the session and `Me` load (16 section 3.3: the logo, not a gate). */
export function Splash() {
  const { t } = useTranslation()
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background"
      aria-busy="true"
    >
      <LogoMark className="h-[72px]" />
      <p className="px-gutter text-center font-display text-wordmark-lg text-foreground">
        {t('app_name')}
      </p>
      <Spinner label={t('splash.label')} />
    </div>
  )
}

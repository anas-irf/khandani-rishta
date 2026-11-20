import { useTranslation } from 'react-i18next'
import { Spinner } from '~/components/ui/spinner'

/** Full-screen splash while the session and `Me` load (16 section 3.3: the logo, not a gate). */
export function Splash() {
  const { t } = useTranslation()
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background"
      aria-busy="true"
    >
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground">
        KR
      </div>
      <p className="text-lg font-semibold text-foreground">{t('app_name')}</p>
      <Spinner label={t('splash.label')} />
    </div>
  )
}

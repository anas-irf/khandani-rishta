import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

/** The logo in the app's top bar; opens APP-HOME (16 section 2.1). */
export function BrandLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/home"
      className="flex min-h-11 shrink-0 items-center gap-2 rounded-md font-bold text-primary"
    >
      <span
        aria-hidden
        className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm text-primary-foreground"
      >
        KR
      </span>
      <span className="text-lg">{t('app_name')}</span>
    </Link>
  )
}

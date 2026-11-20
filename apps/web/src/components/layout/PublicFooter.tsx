import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { signInLink } from '~/features/public/config'

const linkClass =
  'inline-flex min-h-11 items-center rounded-[var(--radius-input)] text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline'

/** Footer of every public page (16 section 7.11): three columns, copyright and the GeoNames credit. */
export function PublicFooter() {
  const { t } = useTranslation('public')
  const { t: tc } = useTranslation()

  return (
    <footer className="border-t border-border bg-surface">
      <div className="container-app py-10">
        <nav aria-label={t('footer.label')} className="grid gap-8 sm:grid-cols-3">
          <div>
            <h2 className="text-base font-semibold">{t('footer.about_title')}</h2>
            <ul className="mt-2">
              <li>
                <Link to="/how-it-works" className={linkClass}>
                  {t('links.how_it_works')}
                </Link>
              </li>
              <li>
                <Link to="/safety" className={linkClass}>
                  {t('links.safety')}
                </Link>
              </li>
              <li>
                <Link to="/faq" className={linkClass}>
                  {t('links.faq')}
                </Link>
              </li>
              <li>
                <Link to="/nikah-guide" className={linkClass}>
                  {t('links.nikah_guide')}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-base font-semibold">{t('footer.start_title')}</h2>
            <ul className="mt-2">
              <li>
                <Link {...signInLink} className={linkClass}>
                  {t('links.create_profile')}
                </Link>
              </li>
              <li>
                <Link {...signInLink} className={linkClass}>
                  {t('links.sign_in')}
                </Link>
              </li>
              <li>
                <Link to="/download" className={linkClass}>
                  {t('links.download')}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-base font-semibold">{t('footer.legal_title')}</h2>
            <ul className="mt-2">
              <li>
                <Link to="/terms" className={linkClass}>
                  {t('links.terms')}
                </Link>
              </li>
              <li>
                <Link to="/privacy" className={linkClass}>
                  {t('links.privacy')}
                </Link>
              </li>
              <li>
                <Link to="/community-guidelines" className={linkClass}>
                  {t('links.community_guidelines')}
                </Link>
              </li>
              <li>
                <Link to="/contact" className={linkClass}>
                  {t('links.contact')}
                </Link>
              </li>
            </ul>
          </div>
        </nav>

        <div className="mt-8 flex flex-col gap-1 border-t border-border pt-6 text-sm text-muted-foreground">
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
          <p>{tc('geonames')}</p>
        </div>
      </div>
    </footer>
  )
}

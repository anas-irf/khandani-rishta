import { Link, type LinkProps } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { signInLink } from '~/features/public/config'

type FooterLink = { key: string; link: LinkProps }

/** The three columns of 16 section 7.11, in its order. */
const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'about_title',
    links: [
      { key: 'how_it_works', link: { to: '/how-it-works' } },
      { key: 'safety', link: { to: '/safety' } },
      { key: 'faq', link: { to: '/faq' } },
      { key: 'nikah_guide', link: { to: '/nikah-guide' } },
    ],
  },
  {
    title: 'start_title',
    links: [
      { key: 'create_profile', link: signInLink },
      { key: 'sign_in', link: signInLink },
      { key: 'download', link: { to: '/download' } },
    ],
  },
  {
    title: 'legal_title',
    links: [
      { key: 'terms', link: { to: '/terms' } },
      { key: 'privacy', link: { to: '/privacy' } },
      { key: 'community_guidelines', link: { to: '/community-guidelines' } },
      { key: 'contact', link: { to: '/contact' } },
    ],
  },
]

/**
 * Footer of every public page (16 section 7.11): the dark band with the name, three columns of
 * links, and the legal line with the GeoNames credit.
 */
export function PublicFooter() {
  const { t } = useTranslation('public')
  const { t: tc } = useTranslation()

  return (
    <footer className="band-inverse">
      <div className="container-app pt-[clamp(40px,5vw,64px)] pb-8">
        <div className="flex flex-wrap gap-x-16 gap-y-10">
          <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-3">
            <p className="font-display text-wordmark-lg">{tc('app_name')}</p>
            <p className="max-w-[34ch] text-body-sm text-inverse-muted">
              {t('meta.default_description')}
            </p>
          </div>
          <nav
            aria-label={t('footer.label')}
            className="grid min-w-0 flex-[3_1_540px] grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-x-10 gap-y-10"
          >
            {COLUMNS.map((column) => (
              <div key={column.title} className="min-w-0">
                <h2 className="mb-2 text-label-md font-bold text-accent-on-inverse">
                  {t(`footer.${column.title}`)}
                </h2>
                <ul className="flex flex-col gap-[8px]">
                  {column.links.map(({ key, link }) => (
                    <li key={key}>
                      <Link
                        {...link}
                        className="inline-flex min-h-touch min-w-touch max-w-full items-center rounded-sm text-body-md text-inverse-foreground hover:link-gold"
                      >
                        {t(`links.${key}`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-8 flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-accent-decor/40 pt-5 text-legal text-inverse-muted">
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
          <p>{tc('geonames')}</p>
        </div>
      </div>
    </footer>
  )
}

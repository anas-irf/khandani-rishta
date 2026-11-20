import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { i18n } from '~/lib/i18n'
import { FaqItem, linkClass, PageHero, Prose } from './content'
import { allFaqEntries, FAQ_GROUPS, faqEntry } from './faq'
import { faqJsonLd } from './seo'

/** `FAQPage` structured data, built from the same texts as the page (17 section 13). */
export function buildFaqStructuredData() {
  return faqJsonLd(allFaqEntries((key) => i18n.t(key, { ns: 'public' })))
}

/** PUB-FAQ (16 section 7.10): grouped questions that open to their answers. */
export function FaqPage() {
  const { t } = useTranslation('public')
  const translate = (key: string) => t(key)

  return (
    <>
      <PageHero title={t('faq.title')} lead={t('faq.lead')} />
      <Prose>
        <div className="max-w-3xl space-y-10">
          {FAQ_GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`faq-${group.id}`} className="space-y-3">
              <h2 id={`faq-${group.id}`} className="text-2xl font-semibold">
                {t(`faq.groups.${group.id}`)}
              </h2>
              <div className="space-y-2">
                {group.items.map((id) => {
                  const entry = faqEntry(translate, id)
                  return <FaqItem key={id} question={entry.question} answer={entry.answer} />
                })}
              </div>
            </section>
          ))}
          <p>
            {t('faq.contact_prompt')}{' '}
            <Link to="/contact" className={linkClass}>
              {t('links.contact')}
            </Link>
          </p>
        </div>
      </Prose>
    </>
  )
}

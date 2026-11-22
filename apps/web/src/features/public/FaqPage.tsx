import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SectionHeading } from '~/components/common/SectionHeading'
import { inlineLinkClass } from '~/components/common/TextLink'
import { i18n } from '~/lib/i18n'
import { FaqItem, PageHero, Prose } from './content'
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
        {FAQ_GROUPS.map((group) => (
          <section
            key={group.id}
            aria-labelledby={`faq-${group.id}`}
            className="flex flex-col gap-4"
          >
            <SectionHeading id={`faq-${group.id}`} title={t(`faq.groups.${group.id}`)} />
            <div className="flex flex-col gap-3">
              {group.items.map((id) => {
                const entry = faqEntry(translate, id)
                return <FaqItem key={id} question={entry.question} answer={entry.answer} />
              })}
            </div>
          </section>
        ))}
        <p>
          {t('faq.contact_prompt')}{' '}
          <Link to="/contact" className={inlineLinkClass}>
            {t('links.contact')}
          </Link>
        </p>
      </Prose>
    </>
  )
}

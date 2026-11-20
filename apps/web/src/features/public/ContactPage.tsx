import { Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SUPPORT_EMAIL } from './config'
import { BulletList, PageHero, Prose, useList } from './content'

/** PUB-CONTACT (16 section 7.7): how to reach support. There is no contact form at launch. */
export function ContactPage() {
  const { t } = useTranslation('public')
  const items = useList<string>('contact.include.items')

  return (
    <>
      <PageHero title={t('contact.title')} lead={t('contact.lead')} />
      <Prose>
        <div className="max-w-3xl space-y-10">
          <section aria-labelledby="contact-support" className="space-y-3">
            <h2 id="contact-support" className="text-2xl font-semibold">
              {t('contact.support.title')}
            </h2>
            <p className="flex items-center gap-3">
              <Mail aria-hidden="true" className="size-6 shrink-0 text-primary" />
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="inline-flex min-h-11 items-center text-xl font-semibold text-primary underline underline-offset-4 hover:text-primary-hover"
              >
                {SUPPORT_EMAIL}
              </a>
            </p>
            <p>{t('contact.support.body')}</p>
          </section>

          <section aria-labelledby="contact-include" className="space-y-3">
            <h2 id="contact-include" className="text-2xl font-semibold">
              {t('contact.include.title')}
            </h2>
            <BulletList items={items} />
            <p className="font-medium">{t('contact.include.note')}</p>
          </section>

          <section aria-labelledby="contact-urgent" className="space-y-3">
            <h2 id="contact-urgent" className="text-2xl font-semibold">
              {t('contact.urgent.title')}
            </h2>
            <p className="leading-relaxed">{t('contact.urgent.body')}</p>
            <p className="leading-relaxed">{t('contact.urgent.emergency')}</p>
          </section>

          <section aria-labelledby="contact-authorities" className="space-y-3">
            <h2 id="contact-authorities" className="text-2xl font-semibold">
              {t('contact.authorities.title')}
            </h2>
            <p className="leading-relaxed">{t('contact.authorities.body')}</p>
          </section>
        </div>
      </Prose>
    </>
  )
}

import { Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SectionHeading } from '~/components/common/SectionHeading'
import { inlineLinkClass } from '~/components/common/TextLink'
import { cn } from '~/lib/utils'
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
        <section aria-labelledby="contact-support" className="flex flex-col gap-3">
          <SectionHeading id="contact-support" title={t('contact.support.title')} />
          <p className="flex items-center gap-3">
            <Mail aria-hidden="true" className="size-6 text-primary" />
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className={cn(
                inlineLinkClass,
                'inline-flex min-h-touch min-w-0 items-center text-title-md break-all',
              )}
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
          <p>{t('contact.support.body')}</p>
        </section>

        <section aria-labelledby="contact-include" className="flex flex-col gap-3">
          <SectionHeading id="contact-include" title={t('contact.include.title')} />
          <BulletList items={items} />
          <p className="font-semibold">{t('contact.include.note')}</p>
        </section>

        <section aria-labelledby="contact-urgent" className="flex flex-col gap-3">
          <SectionHeading id="contact-urgent" title={t('contact.urgent.title')} />
          <p className="max-w-measure text-body-lg">{t('contact.urgent.body')}</p>
          <p className="max-w-measure text-body-lg">{t('contact.urgent.emergency')}</p>
        </section>

        <section aria-labelledby="contact-authorities" className="flex flex-col gap-3">
          <SectionHeading id="contact-authorities" title={t('contact.authorities.title')} />
          <p className="max-w-measure text-body-lg">{t('contact.authorities.body')}</p>
        </section>
      </Prose>
    </>
  )
}

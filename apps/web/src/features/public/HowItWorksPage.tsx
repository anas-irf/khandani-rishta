import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  type ContentBlock,
  ContentSection,
  CtaBand,
  linkClass,
  PageHero,
  Prose,
  useList,
} from './content'

/** PUB-HOW (16 section 7.2): the steps in detail. */
export function HowItWorksPage() {
  const { t } = useTranslation('public')
  const sections = useList<ContentBlock>('how.sections')

  return (
    <>
      <PageHero title={t('how.title')} lead={t('how.lead')} />
      <Prose>
        <div className="max-w-3xl space-y-10">
          {sections.map((block, index) => (
            <ContentSection key={block.id} block={block} number={index + 1}>
              {block.id === 'nikah' ? (
                <p>
                  <Link
                    to="/nikah-guide"
                    className={`${linkClass} inline-flex min-h-11 items-center`}
                  >
                    {t('how.nikah_link')}
                  </Link>
                </p>
              ) : null}
            </ContentSection>
          ))}
        </div>
      </Prose>
      <CtaBand title={t('how.cta_title')} body={t('how.cta_body')} />
    </>
  )
}

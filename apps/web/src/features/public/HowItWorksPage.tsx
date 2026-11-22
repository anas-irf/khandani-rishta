import { useTranslation } from 'react-i18next'
import { TextLink } from '~/components/common/TextLink'
import { type ContentBlock, ContentSection, CtaBand, PageHero, Prose, useList } from './content'

/** PUB-HOW (16 section 7.2): the steps in detail. */
export function HowItWorksPage() {
  const { t } = useTranslation('public')
  const sections = useList<ContentBlock>('how.sections')

  return (
    <>
      <PageHero title={t('how.title')} lead={t('how.lead')} />
      <Prose>
        {sections.map((block, index) => (
          <ContentSection key={block.id} block={block} number={index + 1}>
            {block.id === 'nikah' ? (
              <TextLink to="/nikah-guide">{t('how.nikah_link')}</TextLink>
            ) : null}
          </ContentSection>
        ))}
      </Prose>
      <CtaBand title={t('how.cta_title')} body={t('how.cta_body')} />
    </>
  )
}

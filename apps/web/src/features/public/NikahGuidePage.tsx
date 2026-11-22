import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TextLink } from '~/components/common/TextLink'
import { Alert, AlertDescription } from '~/components/ui/alert'
import {
  type ContentBlock,
  ContentSection,
  PageHero,
  Prose,
  TableOfContents,
  useList,
} from './content'

/**
 * PUB-NIKAH (16 section 7.9, structure owned by 11 section 10): the fixed notice at the top and
 * the bottom, a table of contents, twelve short sections and links to safety and FAQ.
 */
export function NikahGuidePage() {
  const { t } = useTranslation('public')
  const sections = useList<ContentBlock>('nikah.sections')

  return (
    <>
      <PageHero title={t('nikah.title')} lead={t('nikah.lead')} />
      <Prose>
        <Notice />
        <TableOfContents blocks={sections} numbered />
        {sections.map((block, index) => (
          <ContentSection key={block.id} block={block} number={index + 1} />
        ))}
        <Notice />
        <p className="max-w-measure text-body-lg">{t('nikah.closing')}</p>
        <p className="flex flex-wrap gap-x-6">
          <TextLink to="/safety">{t('links.safety')}</TextLink>
          <TextLink to="/faq">{t('links.faq')}</TextLink>
        </p>
      </Prose>
    </>
  )
}

/** The fixed notice of 11 section 10, plus the statement that we do not conduct marriages. */
function Notice() {
  const { t } = useTranslation('public')
  return (
    <Alert variant="info">
      <Info aria-hidden="true" />
      <AlertDescription>
        <p>{t('nikah.notice')}</p>
        <p className="font-semibold">{t('nikah.notice_platform')}</p>
      </AlertDescription>
    </Alert>
  )
}

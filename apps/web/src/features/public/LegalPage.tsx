import { useTranslation } from 'react-i18next'
import { SUPPORT_EMAIL } from './config'
import {
  type ContentBlock,
  ContentSection,
  LegalReviewNotice,
  PageHero,
  Prose,
  TableOfContents,
  useList,
} from './content'

type LegalDocument = 'terms' | 'privacy' | 'guidelines'

/**
 * The legal pages share one layout: a title, the "pending legal review" notice (02 Q-12), a
 * table of contents and numbered clauses. The clause text is in `public.json` under `terms`,
 * `privacy` and `guidelines`.
 */
function LegalPage({ document }: { document: LegalDocument }) {
  const { t } = useTranslation('public')
  const clauses = useList<ContentBlock>(`${document}.sections`, { email: SUPPORT_EMAIL })

  return (
    <>
      <PageHero title={t(`${document}.title`)} lead={t(`${document}.lead`)}>
        <div className="mt-6">
          <LegalReviewNotice />
        </div>
      </PageHero>
      <Prose>
        <div className="max-w-3xl space-y-10">
          <TableOfContents blocks={clauses} numbered />
          {clauses.map((clause, index) => (
            <ContentSection key={clause.id} block={clause} number={index + 1} />
          ))}
        </div>
      </Prose>
    </>
  )
}

/** PUB-TERMS (16 section 7.4). */
export function TermsPage() {
  return <LegalPage document="terms" />
}

/** PUB-PRIVACY (16 section 7.5). */
export function PrivacyPage() {
  return <LegalPage document="privacy" />
}

/** PUB-GUIDELINES (16 section 7.6). */
export function GuidelinesPage() {
  return <LegalPage document="guidelines" />
}

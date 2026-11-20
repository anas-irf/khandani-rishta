import { useTranslation } from 'react-i18next'
import { SUPPORT_EMAIL } from './config'
import { ContentSection, PageHero, Prose, useBlock, useList } from './content'

type Tip = { title: string; body: string }
type Tool = { term: string; text: string }

/**
 * PUB-SAFETY (16 section 7.3): the twelve tips of 13 section 11.1, the tools in the app, what to
 * do when something goes wrong, and advice for parents.
 */
export function SafetyPage() {
  const { t } = useTranslation('public')
  const tips = useList<Tip>('safety.tips')
  const tools = useList<Tool>('safety.tools.items')
  const wrong = useBlock('safety.wrong', 'wrong', { email: SUPPORT_EMAIL })
  const parents = useBlock('safety.parents', 'parents')

  return (
    <>
      <PageHero title={t('safety.title')} lead={t('safety.lead')} />
      <Prose>
        <div className="max-w-3xl space-y-10">
          <section aria-labelledby="tips-title" className="space-y-3">
            <h2 id="tips-title" className="text-2xl font-semibold">
              {t('safety.tips_title')}
            </h2>
            <ol className="list-decimal space-y-3 ps-6 leading-relaxed marker:font-semibold marker:text-primary">
              {tips.map((tip) => (
                <li key={tip.title} className="ps-1">
                  <strong className="font-semibold">{tip.title}</strong> {tip.body}
                </li>
              ))}
            </ol>
          </section>

          <ContentSection block={{ id: 'tools', title: t('safety.tools.title'), details: tools }} />
          <ContentSection block={wrong} />
          <ContentSection block={parents} />
        </div>
      </Prose>
    </>
  )
}

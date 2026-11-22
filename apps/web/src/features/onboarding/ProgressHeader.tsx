import { useTranslation } from 'react-i18next'
import { ONBOARDING_STEPS, type OnboardingStep, stepIndex } from '~/lib/gate'
import { cn } from '~/lib/utils'
import { groupOf, groupProgress } from './steps'

/**
 * The progress indicator of 07 section 2.3: four segments, one per group, each filled in
 * proportion to the completed steps of its group; under it the group name and "Step N of 11".
 * Display only, not a navigation control.
 */
export function ProgressHeader({
  step,
  currentStep,
}: {
  step: OnboardingStep
  currentStep: string
}) {
  const { t } = useTranslation('onboarding')
  const groups = groupProgress(currentStep)
  const group = groupOf(step)
  return (
    <div className="flex flex-col gap-2">
      <ol aria-label={t('progress.label')} className="grid grid-cols-4 gap-2">
        {groups.map((entry) => {
          const name = t(`groups.${entry.key}`)
          const percent = Math.round((entry.done / entry.total) * 100)
          return (
            <li key={entry.key}>
              <span className="sr-only">
                {t('progress.group_done', { group: name, done: entry.done, total: entry.total })}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'block h-[6px] overflow-hidden rounded-pill',
                  // The group the member is in; its name is written under the segments.
                  entry.key === group?.key ? 'bg-primary-soft' : 'bg-muted-strong',
                )}
              >
                <span
                  className="block h-full rounded-pill bg-primary transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </span>
            </li>
          )
        })}
      </ol>
      <p className="flex flex-wrap items-center justify-between gap-x-3 text-caption text-muted-foreground">
        <span className="text-label-sm text-foreground">
          {t(`groups.${group?.key ?? 'about'}`)}
        </span>
        <span className="tabular-nums">
          {t('progress.step', { n: stepIndex(step) + 1, total: ONBOARDING_STEPS.length })}
        </span>
      </p>
    </div>
  )
}

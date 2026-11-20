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
      <ol aria-label={t('progress.label')} className="grid grid-cols-4 gap-1.5">
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
                  'block h-1.5 overflow-hidden rounded-full bg-muted',
                  entry.key === group?.key && 'ring-1 ring-primary/40',
                )}
              >
                <span
                  className="block h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </span>
            </li>
          )
        })}
      </ol>
      <p className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{t(`groups.${group?.key ?? 'about'}`)}</span>
        <span>
          {t('progress.step', { n: stepIndex(step) + 1, total: ONBOARDING_STEPS.length })}
        </span>
      </p>
    </div>
  )
}

// GATE-CHANGES (16 section 6.2, 07 section 14.3)
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { PlainText } from '~/components/common/PlainText'
import { StatusBanner } from '~/components/common/StatusBanner'
import { Button, buttonVariants } from '~/components/ui/button'
import { useResubmitProfile } from '~/features/profile-sections/queries'
import { type ClientFieldError, isApiError } from '~/lib/api'
import { serverFieldMessage } from '~/lib/form-context'
import { useCurrentMe } from '~/lib/me'
import { invalidateMe } from '~/lib/query'
import { cn } from '~/lib/utils'
import { fixTargetForStep, stepForField } from './field-sections'
import { GateLayout } from './GateLayout'
import { useGateRefresh } from './queries'

export function ChangesScreen() {
  const { t } = useTranslation('gate')
  const me = useCurrentMe()
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const resubmit = useResubmitProfile()
  const [problems, setProblems] = useState<ClientFieldError[]>([])
  useGateRefresh()

  const send = () => {
    setProblems([])
    resubmit.mutate(undefined, {
      // The returned `Me` is in the cache; `AuthGate` routes by its gate (normally GATE-REVIEW).
      onError: (error) => {
        if (!isApiError(error)) return
        if (error.code === 'invalid_state') void invalidateMe(queryClient)
        if (error.code === 'validation_failed') setProblems(error.fields)
      },
    })
  }

  return (
    <GateLayout title={t('changes.title')}>
      <p className="text-base">{t('changes.text')}</p>

      {me.profile.status_reason ? (
        <StatusBanner variant="warning" title={t('changes.reason_label')}>
          <PlainText text={me.profile.status_reason} />
        </StatusBanner>
      ) : null}

      {problems.length > 0 ? <Problems problems={problems} /> : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link to="/me" className={cn(buttonVariants({ variant: 'secondary' }))}>
          {t('changes.edit')}
        </Link>
        <Button loading={resubmit.isPending} disabled={!online} onClick={send}>
          {t('changes.resubmit')}
        </Button>
      </div>
    </GateLayout>
  )
}

/**
 * The messages of a `validation_failed` answer, each field with its text, and one link per
 * screen that fixes them (07 section 14.3).
 */
function Problems({ problems }: { problems: ClientFieldError[] }) {
  const { t } = useTranslation('gate')
  const steps = [
    ...new Set(
      problems.map((problem) => stepForField(problem.field)).filter((step) => step !== null),
    ),
  ]

  return (
    <StatusBanner variant="danger" title={t('changes.problems_title')}>
      <ul className="list-disc space-y-1 ps-5">
        {problems.map((problem) => {
          const message = serverFieldMessage('gate', problem)
          const step = stepForField(problem.field)
          return (
            <li key={`${problem.field}:${problem.code}`}>
              {step
                ? t('changes.problem', { section: t(`changes.sections.${step}`), message })
                : message}
            </li>
          )
        })}
      </ul>
      {steps.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {steps.map((step) => {
            const target = fixTargetForStep(step)
            if (!target) return null
            const label = t('changes.fix_link', { section: t(`changes.sections.${step}`) })
            return (
              <li key={step}>
                {target.to === '/me/edit/$section' ? (
                  <Link to={target.to} params={target.params} className={linkClass}>
                    {label}
                  </Link>
                ) : (
                  <Link to={target.to} className={linkClass}>
                    {label}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </StatusBanner>
  )
}

const linkClass =
  'inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CirclePause, CircleX } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { http } from '~/lib/api'
import { setMe } from '~/lib/query'
import { cn } from '~/lib/utils'
import { useOnlineStatus } from './OfflineBanner'

/** Query keys that do not belong to a screen: `Me` and the reference data. */
const NOT_SCREEN_DATA: ReadonlySet<unknown> = new Set(['me', 'reference'])

/**
 * `POST /v1/me/profile/resume`: sets `['me']` from the response (17 section 6.3), then marks the
 * screen's data stale so the screen that replaces the panel loads fresh ("reloads the screen",
 * 16 section 1.4).
 */
export function useResumeProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => http.post('/v1/me/profile/resume'),
    onSuccess: (me) => {
      setMe(queryClient, me)
      void queryClient.invalidateQueries({
        predicate: (query) => !NOT_SCREEN_DATA.has(query.queryKey[0]),
      })
    },
  })
}

/**
 * Shown in place of a screen whose access level the own profile status does not meet
 * (16 section 1.4, 17 section 4.3). Use `ScreenAccess` rather than rendering it per screen.
 */
export function StatusPanel({
  status,
  className,
}: {
  status: 'paused' | 'closed'
  className?: string
}) {
  const { t } = useTranslation('shared')
  const resume = useResumeProfile()
  const online = useOnlineStatus()
  const Icon = status === 'paused' ? CirclePause : CircleX
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      data-status-panel={status}
      className={cn('flex flex-col items-center gap-3 px-4 py-12 text-center', className)}
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-warning-soft text-warning">
        <Icon aria-hidden="true" className="size-7" />
      </span>
      <h2 id={titleId} className="text-lg font-semibold">
        {t(`status_panel.${status}.title`)}
      </h2>
      <p className="max-w-md text-muted-foreground">{t(`status_panel.${status}.text`)}</p>
      {status === 'paused' ? (
        <Button onClick={() => resume.mutate()} loading={resume.isPending} disabled={!online}>
          {t('status_panel.paused.action')}
        </Button>
      ) : (
        <Button asChild>
          <Link to="/settings/account">{t('status_panel.closed.action')}</Link>
        </Button>
      )}
    </section>
  )
}

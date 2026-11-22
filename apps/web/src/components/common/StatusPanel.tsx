import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CirclePause, CircleX } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { http } from '~/lib/api'
import { setMe } from '~/lib/query'
import { cn } from '~/lib/utils'
import { Band } from './Band'
import { EmptyState } from './EmptyState'
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
 * (16 section 1.4, 17 section 4.3). It brings its own band, so it can replace a whole screen.
 * Use `ScreenAccess` rather than rendering it per screen.
 */
export function StatusPanel({
  status,
  titleAs = 'h1',
  className,
}: {
  status: 'paused' | 'closed'
  /** `h1` in place of a whole screen; `h2` under a header that stays. */
  titleAs?: 'h1' | 'h2'
  className?: string
}) {
  const { t } = useTranslation('shared')
  const resume = useResumeProfile()
  const online = useOnlineStatus()
  const titleId = useId()

  return (
    <Band
      width="column"
      aria-labelledby={titleId}
      data-status-panel={status}
      className={cn('flex-1', className)}
    >
      <EmptyState
        icon={status === 'paused' ? CirclePause : CircleX}
        tone="warning"
        titleId={titleId}
        titleAs={titleAs}
        title={t(`status_panel.${status}.title`)}
        text={t(`status_panel.${status}.text`)}
        action={
          status === 'paused' ? (
            <Button onClick={() => resume.mutate()} loading={resume.isPending} disabled={!online}>
              {t('status_panel.paused.action')}
            </Button>
          ) : (
            <Button asChild>
              <Link to="/settings/account">{t('status_panel.closed.action')}</Link>
            </Button>
          )
        }
      />
    </Band>
  )
}

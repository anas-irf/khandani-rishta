import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Band } from '~/components/common/Band'
import { EmptyState } from '~/components/common/EmptyState'
import { Wordmark } from '~/components/layout/Logo'
import { Button } from '~/components/ui/button'
import { isApiError } from '~/lib/api'

/** 16 rule G3 for a failed `GET /v1/me` at start: never guess a gate (16 section 3.3). */
export function FullScreenError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation('errors')
  const requestId = isApiError(error) ? error.requestId : null
  return (
    <main className="flex min-h-dvh flex-col">
      <div className="container-app flex min-h-[64px] items-center border-b border-border py-2 wide:min-h-[80px]">
        <Wordmark />
      </div>
      <Band as="div" width="column" className="flex-1">
        <EmptyState
          icon={TriangleAlert}
          tone="danger"
          titleAs="h1"
          title={t('generic.screen_title')}
          text={t('generic.screen_text')}
          action={<Button onClick={onRetry}>{t('generic.try_again')}</Button>}
          footnote={requestId ? t('reference', { id: requestId }) : null}
        />
      </Band>
    </main>
  )
}

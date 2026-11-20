import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { isApiError } from '~/lib/api'

/** 16 rule G3 for a failed `GET /v1/me` at start: never guess a gate (16 section 3.3). */
export function FullScreenError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation('errors')
  const requestId = isApiError(error) ? error.requestId : null
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">{t('generic.screen_title')}</h1>
      <p className="max-w-md text-muted-foreground">{t('generic.screen_text')}</p>
      <Button onClick={onRetry}>{t('generic.try_again')}</Button>
      {requestId ? (
        <p className="text-sm text-muted-foreground">{t('reference', { id: requestId })}</p>
      ) : null}
    </main>
  )
}

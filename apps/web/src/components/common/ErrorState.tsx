import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { isApiError } from '~/lib/api'
import { EmptyState } from './EmptyState'

/**
 * A screen-level load error (16 rule G3): "Something went wrong", the support text, "Try again"
 * and "Reference: {x-request-id}" in small type when the API sent one.
 */
export function ErrorState({
  error,
  onRetry,
  retrying = false,
  className,
}: {
  error: unknown
  onRetry: () => void
  /** Shows a spinner in the button while the retry runs. */
  retrying?: boolean
  className?: string
}) {
  const { t } = useTranslation('errors')
  const requestId = isApiError(error) ? error.requestId : null

  return (
    <div role="alert" className={className}>
      <EmptyState
        icon={TriangleAlert}
        tone="danger"
        title={t('generic.screen_title')}
        text={t('generic.screen_text')}
        action={
          <Button onClick={onRetry} loading={retrying}>
            {t('generic.try_again')}
          </Button>
        }
        footnote={requestId ? t('reference', { id: requestId }) : null}
      />
    </div>
  )
}

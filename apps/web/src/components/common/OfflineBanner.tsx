import { WifiOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/utils'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/**
 * Whether the browser reports a network connection (`navigator.onLine`). Buttons that need the
 * network are disabled while it is false (16 rule G14). Always true on the server.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

/** The thin "You are offline" bar under the top bar (16 rule G14, 17 section 9.2). */
export function OfflineBanner({ className }: { className?: string }) {
  const { t } = useTranslation('common')
  const online = useOnlineStatus()
  return (
    <div role="status" aria-live="polite" className={cn(online && 'sr-only')}>
      {online ? null : (
        <p
          className={cn(
            'band-inverse flex items-center justify-center gap-2 px-gutter py-2 text-label-sm',
            className,
          )}
        >
          <WifiOff aria-hidden="true" className="size-4" />
          {t('offline')}
        </p>
      )}
    </div>
  )
}

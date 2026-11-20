// APP-NOTIFS (16 section 6.15)
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '~/components/common/EmptyState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { PageHeader } from '~/components/common/PageHeader'
import { PlainText } from '~/components/common/PlainText'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button, buttonVariants } from '~/components/ui/button'
import type { NotificationItem } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'
import { cn } from '~/lib/utils'
import { NotificationRow } from './NotificationRow'
import { useMarkNotificationsRead, useNotifications } from './queries'

export function NotificationsScreen() {
  const { t } = useTranslation('notifications')
  const me = useCurrentMe()
  const online = useOnlineStatus()
  const feed = useNotifications()
  const markRead = useMarkNotificationsRead()
  const [warning, setWarning] = useState<{ reason: string | null } | null>(null)

  const hasUnreadLoaded = (feed.data?.pages ?? []).some((page) =>
    page.items.some((item) => !item.is_read),
  )
  const canMarkAll = me.counters.unread_notifications > 0 || hasUnreadLoaded

  const readItem = (item: NotificationItem) => {
    if (!item.is_read) markRead.mutate({ ids: [item.id] })
  }

  return (
    <div className="container-app">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 pb-6">
        <PageHeader
          title={t('title')}
          actions={
            <Button
              variant="ghost"
              className="text-primary"
              disabled={!canMarkAll || !online}
              loading={
                markRead.isPending &&
                markRead.variables !== undefined &&
                'all' in markRead.variables
              }
              onClick={() => markRead.mutate({ all: true })}
            >
              {t('mark_all_read')}
            </Button>
          }
        />
        <InfiniteList
          query={feed}
          label={t('list_label')}
          getKey={(item) => item.id}
          renderItem={(item) => (
            <NotificationRow
              item={item}
              onRead={readItem}
              onOpenWarning={(reason) => setWarning({ reason })}
            />
          )}
          empty={<EmptyState icon={Bell} title={t('empty')} />}
          listClassName="gap-0 divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface"
        />
      </div>
      <WarningDialog warning={warning} onClose={() => setWarning(null)} />
    </div>
  )
}

/** The full reason of an `account_warning` (16 section 6.15). */
function WarningDialog({
  warning,
  onClose,
}: {
  warning: { reason: string | null } | null
  onClose: () => void
}) {
  const { t } = useTranslation('notifications')
  return (
    <AlertDialog
      open={warning !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('warning.title')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-base text-foreground">
              <PlainText text={warning?.reason} />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <a
            href="/community-guidelines"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            {t('warning.guidelines')}
          </a>
          <AlertDialogAction onClick={onClose}>{t('warning.understand')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

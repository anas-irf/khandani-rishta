// APP-NOTIFS (16 section 6.15)
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '~/components/common/EmptyState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Page } from '~/components/common/Page'
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
    <Page
      title={t('title')}
      width="column"
      actions={
        <Button
          variant="link"
          disabled={!canMarkAll || !online}
          loading={
            markRead.isPending && markRead.variables !== undefined && 'all' in markRead.variables
          }
          onClick={() => markRead.mutate({ all: true })}
        >
          {t('mark_all_read')}
        </Button>
      }
    >
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
        // The rows reach 12 into the gutters, so their hover fill has room around the content.
        listClassName="-mx-[12px] flex flex-col"
      />
      <WarningDialog warning={warning} onClose={() => setWarning(null)} />
    </Page>
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
            <div className="text-foreground">
              <PlainText text={warning?.reason} />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <a
            href="/community-guidelines"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: 'secondary' }))}
          >
            {t('warning.guidelines')}
          </a>
          <AlertDialogAction onClick={onClose}>{t('warning.understand')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

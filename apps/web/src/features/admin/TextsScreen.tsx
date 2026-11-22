// ADM-TEXTS: the free text review queue (18 section 4.3).
import { Link } from '@tanstack/react-router'
import { Check, CircleCheck, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EmptyState } from '~/components/common/EmptyState'
import { ErrorState } from '~/components/common/ErrorState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { Page } from '~/components/common/Page'
import { PlainText } from '~/components/common/PlainText'
import { RelativeTime } from '~/components/common/RelativeTime'
import { StatusBanner } from '~/components/common/StatusBanner'
import { inlineLinkClass } from '~/components/common/TextLink'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { useLabelOf } from '~/lib/reference'
import { TableSkeleton } from './components/DataTable'
import { Panel } from './components/Facts'
import { Kbd } from './components/Kbd'
import { QueueButton, queueGridClass } from './components/QueueButton'
import { RejectTextDialog } from './components/ReviewDialogs'
import { sha256Hex } from './hash'
import { useAdminTexts, useApproveText } from './queries'
import { useQueueSelection } from './selection'
import { useShortcuts } from './shortcuts'
import type { AdminTextItem } from './types'

const textKey = (item: AdminTextItem) => `${item.profile_id}:${item.field}`

export function TextsScreen() {
  const { t } = useTranslation('admin')
  const label = useLabelOf()
  const query = useAdminTexts()
  const approve = useApproveText()
  const [rejecting, setRejecting] = useState<AdminTextItem | null>(null)

  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const selection = useQueueSelection(items, textKey)
  const current = selection.selected
  const busy = approve.isPending

  const doApprove = async () => {
    if (!current || busy) return
    // The hash of the text on screen: a text that changed meanwhile is refused (409).
    await approve.mutateAsync({
      profileId: current.profile_id,
      field: current.field,
      text_sha256: await sha256Hex(current.text),
    })
    toast.success(t('texts.approved'))
  }
  const approveNow = () => void doApprove().catch(() => undefined)

  useShortcuts(
    {
      a: approveNow,
      r: () => current && setRejecting(current),
      j: selection.next,
      k: selection.previous,
    },
    rejecting === null,
  )

  const checklist = t('texts.checklist', { returnObjects: true }) as string[]

  return (
    <Page title={t('texts.title')} description={t('texts.description')}>
      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 || !current ? (
        <EmptyState icon={CircleCheck} title={t('list.queue_empty')} />
      ) : (
        <div className={queueGridClass}>
          <nav aria-label={t('texts.queue')}>
            <InfiniteList
              query={query}
              getKey={textKey}
              label={t('texts.queue')}
              listClassName="flex flex-col gap-1"
              itemClassName="min-w-0"
              renderItem={(item) => (
                <QueueButton
                  selected={selection.isSelected(item)}
                  onClick={() => selection.select(item)}
                  className="flex-col items-start gap-0"
                >
                  <span className="font-semibold">
                    {item.first_name ?? item.public_code}{' '}
                    <span className="font-normal text-muted-foreground">{item.public_code}</span>
                  </span>
                  <span className="text-muted-foreground">{t(`texts.field.${item.field}`)}</span>
                </QueueButton>
              )}
            />
          </nav>

          <section aria-label={t('texts.review')} className="flex min-w-0 flex-col gap-4">
            <Panel
              title={t(`texts.field.${current.field}`)}
              action={
                <Badge variant="secondary">
                  {current.gender ? label('gender', current.gender) : t('common.none')}
                </Badge>
              }
            >
              <p className="text-body-sm text-muted-foreground">
                <Link
                  to="/admin/profiles/$profileId"
                  params={{ profileId: current.profile_id }}
                  className={inlineLinkClass}
                >
                  {current.first_name ?? current.public_code} ({current.public_code})
                </Link>
                {' - '}
                {t('texts.updated')} <RelativeTime value={current.updated_at} />
              </p>
              <PlainText
                text={current.text}
                as="div"
                className="tonal rounded-md px-4 py-3 text-body-md"
              />
            </Panel>

            <div
              role="toolbar"
              aria-label={t('texts.decision')}
              className="flex flex-wrap items-center gap-2"
            >
              <Button loading={approve.isPending} aria-keyshortcuts="A" onClick={approveNow}>
                <Check aria-hidden="true" />
                {t('texts.approve')}
                <Kbd>A</Kbd>
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                aria-keyshortcuts="R"
                onClick={() => setRejecting(current)}
              >
                <X aria-hidden="true" />
                {t('texts.reject')}
                <Kbd>R</Kbd>
              </Button>
            </div>

            <Panel title={t('texts.checklist_title')}>
              <ul className="bullet-list text-body-sm">
                {checklist.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <StatusBanner variant="warning">{t('texts.distress')}</StatusBanner>
            </Panel>
          </section>
        </div>
      )}
      {rejecting ? (
        <RejectTextDialog
          profileId={rejecting.profile_id}
          field={rejecting.field}
          text={rejecting.text}
          onDone={() => toast.success(t('texts.rejected'))}
          onClose={() => setRejecting(null)}
        />
      ) : null}
    </Page>
  )
}

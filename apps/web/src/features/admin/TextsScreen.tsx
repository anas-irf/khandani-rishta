// ADM-TEXTS: the free text review queue (18 section 4.3).
import { Link } from '@tanstack/react-router'
import { Check, CircleCheck, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EmptyState } from '~/components/common/EmptyState'
import { ErrorState } from '~/components/common/ErrorState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { PageHeader } from '~/components/common/PageHeader'
import { PlainText } from '~/components/common/PlainText'
import { RelativeTime } from '~/components/common/RelativeTime'
import { StatusBanner } from '~/components/common/StatusBanner'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { useLabelOf } from '~/lib/reference'
import { TableSkeleton } from './components/DataTable'
import { Panel } from './components/Facts'
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
    <div className="flex flex-col gap-4">
      <PageHeader title={t('texts.title')} description={t('texts.description')} />
      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 || !current ? (
        <EmptyState icon={CircleCheck} title={t('list.queue_empty')} />
      ) : (
        <div className="grid grid-cols-[18rem_minmax(0,1fr)] items-start gap-4">
          <nav aria-label={t('texts.queue')}>
            <InfiniteList
              query={query}
              getKey={textKey}
              label={t('texts.queue')}
              listClassName="gap-2"
              renderItem={(item) => (
                <button
                  type="button"
                  aria-current={selection.isSelected(item) ? 'true' : undefined}
                  onClick={() => selection.select(item)}
                  className="flex min-h-11 w-full flex-col items-start rounded-md border border-border bg-surface p-2 text-start text-sm hover:bg-muted aria-[current=true]:border-primary aria-[current=true]:bg-primary-soft"
                >
                  <span className="font-medium">
                    {item.first_name ?? item.public_code}{' '}
                    <span className="font-normal text-muted-foreground">{item.public_code}</span>
                  </span>
                  <span className="text-muted-foreground">{t(`texts.field.${item.field}`)}</span>
                </button>
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
              <p className="text-sm text-muted-foreground">
                <Link
                  to="/admin/profiles/$profileId"
                  params={{ profileId: current.profile_id }}
                  className="text-primary hover:underline"
                >
                  {current.first_name ?? current.public_code} ({current.public_code})
                </Link>
                {' - '}
                {t('texts.updated')} <RelativeTime value={current.updated_at} />
              </p>
              <PlainText
                text={current.text}
                as="div"
                className="rounded-md bg-muted p-3 text-base leading-relaxed"
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
                <kbd className="ms-1 text-xs opacity-80">A</kbd>
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                aria-keyshortcuts="R"
                onClick={() => setRejecting(current)}
              >
                <X aria-hidden="true" />
                {t('texts.reject')}
                <kbd className="ms-1 text-xs opacity-80">R</kbd>
              </Button>
            </div>

            <Panel title={t('texts.checklist_title')}>
              <ul className="list-disc space-y-1 ps-5 text-sm">
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
    </div>
  )
}

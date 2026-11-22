import { useTranslation } from 'react-i18next'
import { PlainText } from '~/components/common/PlainText'
import { RelativeTime } from '~/components/common/RelativeTime'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/utils'
import type { AdminReportDetail, ReportContextMessage } from '../types'
import { Facts } from './Facts'

function isMessage(value: unknown): value is ReportContextMessage {
  return typeof value === 'object' && value !== null && 'id' in value && 'sender' in value
}

/**
 * The reported message with the ones around it, as a small chat transcript (18 section 4.5).
 * Each sender is "Reporter", "Reported member" or "System"; the reported message is marked.
 */
export function MessageTranscript({ context }: { context: Record<string, unknown> }) {
  const { t } = useTranslation('admin')
  const reportedId = context.reported_message_id
  const messages = Array.isArray(context.messages) ? context.messages.filter(isMessage) : []
  if (messages.length === 0) {
    return <p className="text-body-sm text-muted-foreground">{t('report.no_context')}</p>
  }
  return (
    <ol aria-label={t('report.transcript')} className="flex flex-col gap-2">
      {messages.map((message) => {
        const reported = message.id === reportedId
        return (
          <li
            key={message.id}
            aria-current={reported ? 'true' : undefined}
            className={cn(
              'flex max-w-[85%] flex-col gap-1 rounded-row border-[1.5px] px-4 py-2 text-body-sm',
              message.sender === 'reporter' ? 'self-start' : 'self-end',
              message.sender === 'system' && 'self-center',
              reported ? 'border-danger bg-danger-soft' : 'tonal border-transparent',
            )}
          >
            <span className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
              <span className="font-semibold text-foreground">
                {t(`report.sender.${message.sender}`)}
              </span>
              <RelativeTime value={message.created_at} />
              {reported ? <Badge variant="danger">{t('report.reported_message')}</Badge> : null}
              {message.safety_flag ? (
                <Badge variant="warning">{t('report.flag', { flag: message.safety_flag })}</Badge>
              ) : null}
            </span>
            {message.body ? (
              <PlainText text={message.body} />
            ) : (
              <span className="italic text-muted-foreground">{t('report.deleted_message')}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** The profile snapshot taken when the report was filed (13 section 6.3). */
export function ProfileSnapshot({ context }: { context: Record<string, unknown> }) {
  const { t } = useTranslation('admin')
  const entries = Object.entries(context).filter(([, value]) => typeof value !== 'object')
  return (
    <Facts
      columns={1}
      facts={entries.map(([key, value]) => ({
        label: t(`profile.field.${key}`, { defaultValue: key.replaceAll('_', ' ') }),
        value: value === null || value === '' ? null : <PlainText text={String(value)} as="span" />,
      }))}
    />
  )
}

/** Renders the context of a report according to its subject. */
export function ReportContext({ report }: { report: AdminReportDetail }) {
  const { t } = useTranslation('admin')
  if (!report.context)
    return <p className="text-body-sm text-muted-foreground">{t('report.no_context')}</p>
  if (report.subject_type === 'message') return <MessageTranscript context={report.context} />
  if (report.subject_type === 'profile') return <ProfileSnapshot context={report.context} />
  return null
}

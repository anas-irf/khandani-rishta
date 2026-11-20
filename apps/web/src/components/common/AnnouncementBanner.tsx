import { ExternalLink, Megaphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Announcement } from '~/lib/api-types'
import { cn } from '~/lib/utils'

/** Only absolute http(s) links may be followed from an announcement (17 section 14). */
function safeExternalUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

/** The banner of `Me.config.announcement` (16 section 6.4). Renders nothing for null. */
export function AnnouncementContent({
  announcement,
  className,
}: {
  announcement: Announcement | null
  className?: string
}) {
  const { t, i18n } = useTranslation('shared')
  if (!announcement) return null
  const text =
    i18n.language === 'ur' && announcement.text_ur ? announcement.text_ur : announcement.text_en
  const url = safeExternalUrl(announcement.url)

  return (
    <section
      aria-label={t('announcement.label')}
      className={cn(
        'flex items-start gap-3 rounded-[var(--radius-card)] border border-accent/30 bg-accent-soft px-4 py-3',
        className,
      )}
    >
      <Megaphone aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
      <div className="flex min-w-0 flex-col gap-1">
        <p dir="auto" className="whitespace-pre-line break-words">
          {text}
        </p>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 self-start font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('common:announcement.learn_more')}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
      </div>
    </section>
  )
}

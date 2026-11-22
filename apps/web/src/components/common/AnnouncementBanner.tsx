import { ExternalLink, Megaphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { buttonVariants } from '~/components/ui/button'
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

/** The banner of `Me.config.announcement` (16 section 6.4), on gold soft. Renders nothing for null. */
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
      className={cn('flex items-start gap-3 rounded-card bg-accent-soft px-5 py-3', className)}
    >
      <Megaphone aria-hidden="true" className="mt-[3px] size-5 text-foreground" />
      <div className="flex min-w-0 flex-col gap-1">
        <p dir="auto" className="whitespace-pre-line break-words">
          {text}
        </p>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: 'link' }), 'self-start')}
          >
            {t('common:announcement.learn_more')}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
      </div>
    </section>
  )
}

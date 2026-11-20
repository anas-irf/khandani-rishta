import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { signInLink } from './config'

/**
 * Building blocks shared by the public pages. Text always comes from `locales/en/public.json`;
 * long pages keep their sections as arrays in that file (see `ContentBlock`).
 */

/** One titled section of a long page, as stored in `public.json`. */
export type ContentBlock = {
  id: string
  title: string
  paragraphs?: string[]
  items?: string[]
  /** Terms with a short explanation each. */
  details?: { term: string; text: string }[]
  /** Paragraphs shown after the list. */
  after?: string[]
  /** Public pages to link to under the section (keys of `links.*`). */
  see?: SeeKey[]
}

type SeeKey =
  | 'how_it_works'
  | 'safety'
  | 'faq'
  | 'nikah_guide'
  | 'download'
  | 'terms'
  | 'privacy'
  | 'community_guidelines'
  | 'contact'

const SEE_PATHS = {
  how_it_works: '/how-it-works',
  safety: '/safety',
  faq: '/faq',
  nikah_guide: '/nikah-guide',
  download: '/download',
  terms: '/terms',
  privacy: '/privacy',
  community_guidelines: '/community-guidelines',
  contact: '/contact',
} as const satisfies Record<SeeKey, string>

/** Reads an array of items from `public.json`, with `{{...}}` values filled in. */
export function useList<T>(key: string, values?: Record<string, string>): T[] {
  const { t } = useTranslation('public')
  const value: unknown = t(key, { returnObjects: true, ...values })
  return Array.isArray(value) ? (value as T[]) : []
}

const linkClass = 'font-medium text-primary underline underline-offset-4 hover:text-primary-hover'

/** Opening of a page: the one `<h1>` and a short lead. */
export function PageHero({
  title,
  lead,
  children,
}: {
  title: string
  lead?: string
  children?: ReactNode
}) {
  return (
    <div className="border-b border-border bg-primary-soft">
      <div className="container-app py-10 md:py-14">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold leading-tight md:text-4xl">{title}</h1>
          {lead ? <p className="mt-3 text-lg text-foreground">{lead}</p> : null}
          {children}
        </div>
      </div>
    </div>
  )
}

/** The reading column of a content page. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('container-app py-10 md:py-12', className)}>{children}</div>
}

export function Paragraphs({ items, className }: { items: readonly string[]; className?: string }) {
  return (
    <>
      {items.map((text) => (
        <p key={text} className={cn('leading-relaxed', className)}>
          {text}
        </p>
      ))}
    </>
  )
}

export function BulletList({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-2 ps-6 leading-relaxed marker:text-primary">
      {items.map((text) => (
        <li key={text}>{text}</li>
      ))}
    </ul>
  )
}

/** Links to related public pages ("See also"). */
export function SeeAlso({ pages }: { pages: readonly SeeKey[] }) {
  const { t } = useTranslation('public')
  if (pages.length === 0) return null
  return (
    <p className="text-sm text-muted-foreground">
      {t('cta.see_also')}:{' '}
      {pages.map((page, index) => (
        <span key={page}>
          {index > 0 ? ', ' : null}
          <Link to={SEE_PATHS[page]} className={linkClass}>
            {t(`links.${page}`)}
          </Link>
        </span>
      ))}
    </p>
  )
}

/** A titled section: `h2`, text, lists and links. */
export function ContentSection({
  block,
  number,
  children,
}: {
  block: ContentBlock
  /** Shown before the title (for numbered clauses). */
  number?: number
  /** Extra content under the text, for example a link made in code. */
  children?: ReactNode
}) {
  return (
    <section aria-labelledby={`${block.id}-title`} className="scroll-mt-20 space-y-3">
      <h2 id={`${block.id}-title`} className="text-2xl font-semibold leading-snug">
        {number ? `${number}. ` : null}
        {block.title}
      </h2>
      {block.paragraphs ? <Paragraphs items={block.paragraphs} /> : null}
      {block.items ? <BulletList items={block.items} /> : null}
      {block.details ? (
        <ul className="space-y-2 leading-relaxed">
          {block.details.map((detail) => (
            <li key={detail.term}>
              <strong className="font-semibold">{detail.term}.</strong> {detail.text}
            </li>
          ))}
        </ul>
      ) : null}
      {block.after ? <Paragraphs items={block.after} /> : null}
      {children}
      {block.see ? <SeeAlso pages={block.see} /> : null}
    </section>
  )
}

/** A table of contents for a long page. Its target ids are `<id>-title`. */
export function TableOfContents({
  blocks,
  numbered,
}: {
  blocks: readonly ContentBlock[]
  numbered?: boolean
}) {
  const { t } = useTranslation('public')
  return (
    <nav
      aria-label={t('cta.on_this_page')}
      className="rounded-[var(--radius-card)] border border-border bg-surface p-5"
    >
      <p className="font-semibold">{t('cta.on_this_page')}</p>
      <ol
        className={cn(
          'mt-2 grid gap-x-8 sm:grid-cols-2',
          numbered ? 'list-decimal ps-6' : 'list-none',
        )}
      >
        {blocks.map((block) => (
          <li key={block.id}>
            <a
              href={`#${block.id}-title`}
              className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline"
            >
              {block.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** The notice on the legal pages, until a lawyer has reviewed them (02 Q-12). */
export function LegalReviewNotice() {
  const { t } = useTranslation('public')
  return (
    <Alert variant="warning">
      <AlertTitle>{t('legal.review_title')}</AlertTitle>
      <AlertDescription>
        <p>{t('legal.review_body')}</p>
        <p className="font-medium">{t('legal.version')}</p>
      </AlertDescription>
    </Alert>
  )
}

/** A question that opens to its answer. Plain `<details>`, so it works without JavaScript. */
export function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group rounded-[var(--radius-card)] border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-card)] px-4 py-3 font-medium [&::-webkit-details-marker]:hidden">
        <span>{question}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-5 shrink-0 text-primary transition-transform group-open:rotate-180"
        />
      </summary>
      <p className="px-4 pb-4 leading-relaxed text-muted-foreground">{answer}</p>
    </details>
  )
}

/** "Create a free profile": opens sign-in, where sign-up and sign-in are one screen. */
export function CreateProfileButton({
  size = 'lg',
  variant,
  className,
}: {
  size?: 'default' | 'lg'
  variant?: 'default' | 'secondary' | 'outline'
  className?: string
}) {
  const { t } = useTranslation('public')
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <Link {...signInLink}>{t('cta.create_profile')}</Link>
    </Button>
  )
}

/** A closing call to action. */
export function CtaBand({ title, body }: { title: string; body?: string }) {
  return (
    <section className="bg-primary text-primary-foreground">
      <div className="container-app flex flex-col items-start gap-4 py-10 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{title}</h2>
          {body ? <p className="mt-1 text-primary-foreground">{body}</p> : null}
        </div>
        <CreateProfileButton variant="secondary" />
      </div>
    </section>
  )
}

export { linkClass }

/** Reads one section object (title, paragraphs, items...) from `public.json`. */
export function useBlock(key: string, id: string, values?: Record<string, string>): ContentBlock {
  const { t } = useTranslation('public')
  const value: unknown = t(key, { returnObjects: true, ...values })
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { id, title: key }
  }
  return { id, ...(value as Omit<ContentBlock, 'id'>) }
}

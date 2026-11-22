import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Band } from '~/components/common/Band'
import { DisplayHeading } from '~/components/common/DisplayHeading'
import { OrnamentRule } from '~/components/common/Ornament'
import { SectionHeading } from '~/components/common/SectionHeading'
import { inlineLinkClass, TextLink } from '~/components/common/TextLink'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button, type ButtonProps } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { signInLink } from './config'

/**
 * Building blocks shared by the public pages (DESIGN.md 3.2 and 5): a serif title on sand, then
 * one reading column with diamond headings. Text always comes from `locales/en/public.json`;
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

/** Opening of a page: the one `<h1>` and a short lead, on sand. */
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
    <Band
      as="div"
      tone="sand"
      width="column"
      space="none"
      innerClassName="flex flex-col items-start gap-4 pt-[clamp(32px,5vw,72px)] pb-[clamp(28px,4vw,56px)]"
    >
      <OrnamentRule />
      <DisplayHeading as="h1">{title}</DisplayHeading>
      {lead ? <p className="max-w-measure text-body-lg text-foreground-secondary">{lead}</p> : null}
      {children}
    </Band>
  )
}

/** The reading column of a content page. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Band
      as="div"
      width="column"
      className="flex-1"
      innerClassName={cn('flex flex-col gap-10', className)}
    >
      {children}
    </Band>
  )
}

/** Full width in a column that starts its children at the side, so a long address wraps. */
export function Paragraphs({ items, className }: { items: readonly string[]; className?: string }) {
  return (
    <>
      {items.map((text) => (
        <p key={text} className={cn('w-full max-w-measure text-body-lg', className)}>
          {text}
        </p>
      ))}
    </>
  )
}

export function BulletList({ items }: { items: readonly string[] }) {
  return (
    <ul className="w-full max-w-measure list-disc space-y-2 ps-6 text-body-lg marker:text-muted-foreground">
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
    <p className="flex flex-wrap items-center gap-x-4 text-body-sm text-muted-foreground">
      <span>{t('cta.see_also')}:</span>
      {pages.map((page) => (
        <TextLink key={page} to={SEE_PATHS[page]}>
          {t(`links.${page}`)}
        </TextLink>
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
  const titleId = `${block.id}-title`
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col items-start gap-3">
      <SectionHeading
        id={titleId}
        title={number ? `${number}. ${block.title}` : block.title}
        className="w-full"
      />
      {block.paragraphs ? <Paragraphs items={block.paragraphs} /> : null}
      {block.items ? <BulletList items={block.items} /> : null}
      {block.details ? (
        <ul className="w-full max-w-measure space-y-2 text-body-lg">
          {block.details.map((detail) => (
            <li key={detail.term}>
              <strong className="font-bold">{detail.term}.</strong> {detail.text}
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
    <nav aria-label={t('cta.on_this_page')} className="tonal rounded-lg px-5 py-4">
      <p className="text-emphasis">{t('cta.on_this_page')}</p>
      <ol
        className={cn(
          'mt-1 grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-x-8',
          numbered ? 'list-decimal ps-6' : 'list-none',
        )}
      >
        {blocks.map((block) => (
          <li key={block.id}>
            <a
              href={`#${block.id}-title`}
              className={cn(
                inlineLinkClass,
                'inline-flex min-h-touch min-w-touch max-w-full items-center py-1 align-middle',
              )}
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
        <p className="font-semibold">{t('legal.version')}</p>
      </AlertDescription>
    </Alert>
  )
}

/**
 * A question that opens to its answer. Plain `<details>`, so it works without JavaScript
 * (17 section 13). The plus turns into a cross.
 */
export function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group tonal rounded-xl">
      <summary className="flex min-h-[72px] list-none flex-wrap items-center gap-x-[12px] rounded-xl py-[12px] ps-[24px] pe-[12px] text-title-md font-bold wide:text-title-lg [&::-webkit-details-marker]:hidden">
        {/* At large text the plus moves under a word that needs the whole line. */}
        <span className="min-w-0 flex-[1_1_min-content]">{question}</span>
        <span
          aria-hidden="true"
          className="ms-auto flex size-touch shrink-0 items-center justify-center rounded-pill bg-(--band,var(--color-background)) text-primary transition-transform duration-(--duration-base) group-open:rotate-45"
        >
          <Plus className="size-[18px]" />
        </span>
      </summary>
      <p className="max-w-measure px-[24px] pb-6 text-body-lg text-foreground-secondary">
        {answer}
      </p>
    </details>
  )
}

/** "Create a free profile": opens sign-in, where sign-up and sign-in are one screen. */
export function CreateProfileButton({
  size = 'lg',
  variant,
  className,
}: Pick<ButtonProps, 'size' | 'variant' | 'className'>) {
  const { t } = useTranslation('public')
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <Link {...signInLink}>{t('cta.create_profile')}</Link>
    </Button>
  )
}

/** A closing call to action on a primary band: serif, and the one inverse button. */
export function CtaBand({ title, body }: { title: ReactNode; body?: string }) {
  const titleId = useId()
  return (
    <Band
      aria-labelledby={titleId}
      tone="primary"
      space="lg"
      innerClassName="flex flex-col items-center gap-6 text-center"
    >
      <DisplayHeading id={titleId}>{title}</DisplayHeading>
      <CreateProfileButton variant="inverse" />
      {body ? <p className="max-w-full text-primary-soft">{body}</p> : null}
    </Band>
  )
}

/** Reads one section object (title, paragraphs, items...) from `public.json`. */
export function useBlock(key: string, id: string, values?: Record<string, string>): ContentBlock {
  const { t } = useTranslation('public')
  const value: unknown = t(key, { returnObjects: true, ...values })
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { id, title: key }
  }
  return { id, ...(value as Omit<ContentBlock, 'id'>) }
}

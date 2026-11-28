import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'

type PageLink = { kind: 'page'; page: number } | { kind: 'gap'; before: number }

/**
 * The page links to show: the first and last page and the current one with its neighbours. A
 * gap of one page shows that page; a longer gap becomes an ellipsis.
 */
export function pageLinks(page: number, pageCount: number): PageLink[] {
  const shown = [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b)
  const links: PageLink[] = []
  let previous: number | undefined
  for (const p of shown) {
    if (previous !== undefined && p - previous === 2) links.push({ kind: 'page', page: p - 1 })
    else if (previous !== undefined && p - previous > 2) links.push({ kind: 'gap', before: p })
    links.push({ kind: 'page', page: p })
    previous = p
  }
  return links
}

type PaginationProps = {
  page: number
  pageCount: number
  onChange: (page: number) => void
  className?: string
}

/** Numbered page links with Previous and Next. Nothing is shown for a single page. */
export function Pagination({ page, pageCount, onChange, className }: PaginationProps) {
  const { t } = useTranslation('admin')
  if (pageCount <= 1) return null

  return (
    <nav
      aria-label={t('pagination.label')}
      className={cn('flex flex-wrap items-center justify-center gap-1', className)}
    >
      <Button
        variant="ghost"
        size="compact"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft aria-hidden="true" />
        {t('pagination.previous')}
      </Button>
      <ul className="flex flex-wrap items-center gap-1">
        {pageLinks(page, pageCount).map((link) =>
          link.kind === 'gap' ? (
            <li
              key={`gap-${link.before}`}
              aria-hidden="true"
              className="px-2 text-muted-foreground"
            >
              …
            </li>
          ) : (
            <li key={link.page}>
              <Button
                variant={link.page === page ? 'default' : 'ghost'}
                size="compact"
                className="min-w-touch"
                aria-label={t('pagination.page', { page: link.page })}
                aria-current={link.page === page ? 'page' : undefined}
                onClick={() => onChange(link.page)}
              >
                {link.page}
              </Button>
            </li>
          ),
        )}
      </ul>
      <Button
        variant="ghost"
        size="compact"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        {t('pagination.next')}
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  )
}

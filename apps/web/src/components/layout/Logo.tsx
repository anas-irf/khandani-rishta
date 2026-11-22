import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/utils'

/**
 * The brand mark: two arches and a diamond. Decorative, so it is hidden from screen readers; the
 * name next to it is the text. `public/favicon.svg` is the same drawing with fixed colours.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 30 36"
      aria-hidden="true"
      focusable="false"
      className={cn('h-9 w-auto shrink-0', className)}
    >
      <path
        d="M2 35V15A13 13 0 0 1 28 15V35"
        fill="none"
        strokeWidth="2"
        className="stroke-primary"
      />
      <path
        d="M8 35V16A7 7 0 0 1 22 16V35"
        fill="none"
        strokeWidth="1.4"
        className="stroke-accent-decor"
      />
      <rect
        x="12.2"
        y="23"
        width="5.6"
        height="5.6"
        transform="rotate(45 15 25.8)"
        className="fill-primary"
      />
    </svg>
  )
}

/**
 * The mark and the name in serif: 24 on phones, 28 on wide screens (DESIGN.md 6.16). The name
 * wraps at larger text and is never cut.
 */
export function Wordmark({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      data-slot="wordmark"
      className={cn(
        'flex min-w-0 items-center gap-3 font-display text-wordmark text-foreground wide:text-wordmark-lg',
        className,
      )}
    >
      <LogoMark className="h-[1.14em]" />
      <span className="min-w-0">{t('app_name')}</span>
    </span>
  )
}

/** The box of a link that is the logo. */
export const logoLinkClass = 'flex min-h-touch min-w-0 items-center rounded-sm'

/** The logo with the name, linking to the landing page. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn(logoLinkClass, className)}>
      <Wordmark />
    </Link>
  )
}

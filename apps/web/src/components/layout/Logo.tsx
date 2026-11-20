import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/utils'

/**
 * The brand mark: two joined rings on the primary colour. Decorative, so it is hidden from
 * screen readers; the name next to it is the link text. `public/favicon.svg` is the same drawing
 * with fixed colours.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
      className={cn('size-9 shrink-0', className)}
    >
      <rect width="40" height="40" rx="10" className="fill-primary" />
      <circle
        cx="16"
        cy="20"
        r="8"
        fill="none"
        strokeWidth="2.5"
        className="stroke-primary-foreground"
      />
      <circle cx="24" cy="20" r="8" fill="none" strokeWidth="2.5" className="stroke-accent-soft" />
    </svg>
  )
}

/** The logo with the name, linking to the landing page. */
export function Logo({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <Link
      to="/"
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--radius-input)] text-lg font-bold text-foreground',
        className,
      )}
    >
      <LogoMark />
      <span>{t('app_name')}</span>
    </Link>
  )
}

import { Link } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '~/components/ui/sheet'
import { useSignedInHint } from '~/features/auth/signed-in-hint'
import { signInLink } from '~/features/public/config'
import { Logo } from './Logo'

/**
 * The header's links (17 section 3.1). Below 1024 px the two least important links move to the
 * footer so that the bar never overflows at 768 px; the menu under 768 px lists all of them.
 */
const NAV_ITEMS = [
  { to: '/how-it-works', key: 'how_it_works', wideOnly: false },
  { to: '/safety', key: 'safety', wideOnly: false },
  { to: '/nikah-guide', key: 'nikah_guide', wideOnly: true },
  { to: '/faq', key: 'faq', wideOnly: true },
  { to: '/download', key: 'download', wideOnly: false },
] as const

const navLinkClass =
  'inline-flex min-h-11 items-center rounded-[var(--radius-input)] px-2 text-sm font-medium text-foreground transition-colors hover:bg-muted hover:text-primary data-[status=active]:text-primary lg:px-3'

/** Header of every public page: logo, links, and the account buttons (16 section 6.31). */
export function PublicHeader() {
  const { t } = useTranslation('public')
  const isSignedIn = useSignedInHint()

  return (
    <header className="border-b border-border bg-surface">
      <div className="container-app flex min-h-16 items-center justify-between gap-3">
        <Logo />

        <nav aria-label={t('common:nav.primary_label')} className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.to} className={item.wideOnly ? 'hidden lg:block' : undefined}>
                <Link to={item.to} className={navLinkClass}>
                  {t(`header.nav.${item.key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <HeaderActions signedIn={isSignedIn} />
        </div>

        <MobileMenu signedIn={isSignedIn} />
      </div>
    </header>
  )
}

/** "Sign in" and "Create profile", or "Open the app" for a signed-in visitor (17 section 4.4). */
function HeaderActions({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation()
  const { t: tp } = useTranslation('public')

  if (signedIn) {
    return (
      <Button asChild>
        <Link to="/home">{tp('header.open_app')}</Link>
      </Button>
    )
  }
  return (
    <>
      <Button asChild variant="outline">
        <Link {...signInLink}>{t('actions.sign_in')}</Link>
      </Button>
      <Button asChild>
        <Link {...signInLink}>{t('actions.create_profile')}</Link>
      </Button>
    </>
  )
}

/** The menu under 768 px: a sheet with every link and the account buttons. */
function MobileMenu({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation()
  const { t: tp } = useTranslation('public')
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={tp('header.menu_open')}
          className="md:hidden"
        >
          <Menu aria-hidden="true" className="size-6" />
        </Button>
      </SheetTrigger>
      <SheetContent side="end" closeLabel={tp('header.menu_close')} aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{tp('header.menu_title')}</SheetTitle>
        </SheetHeader>
        <nav aria-label={tp('header.menu_title')}>
          <ul className="flex flex-col">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <SheetClose asChild>
                  <Link
                    to={item.to}
                    className="flex min-h-11 items-center rounded-[var(--radius-input)] px-2 text-base font-medium text-foreground hover:bg-muted data-[status=active]:text-primary"
                  >
                    {tp(`header.nav.${item.key}`)}
                  </Link>
                </SheetClose>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-2 flex flex-col gap-2">
          {signedIn ? (
            <SheetClose asChild>
              <Button asChild size="lg">
                <Link to="/home">{tp('header.open_app')}</Link>
              </Button>
            </SheetClose>
          ) : (
            <>
              <SheetClose asChild>
                <Button asChild size="lg">
                  <Link {...signInLink}>{t('actions.create_profile')}</Link>
                </Button>
              </SheetClose>
              <SheetClose asChild>
                <Button asChild size="lg" variant="outline">
                  <Link {...signInLink}>{t('actions.sign_in')}</Link>
                </Button>
              </SheetClose>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

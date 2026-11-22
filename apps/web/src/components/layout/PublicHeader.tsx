import { Link } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '~/components/ui/sheet'
import { useSignedInHint } from '~/features/auth/signed-in-hint'
import { signInLink } from '~/features/public/config'
import { useBarHeight } from '~/lib/media'
import { Logo } from './Logo'

/** The pages in the phone menu. The bar itself has the three of 16 section 6.31. */
const NAV_ITEMS = [
  { to: '/how-it-works', key: 'how_it_works', inBar: true },
  { to: '/safety', key: 'safety', inBar: true },
  { to: '/nikah-guide', key: 'nikah_guide', inBar: false },
  { to: '/faq', key: 'faq', inBar: false },
  { to: '/download', key: 'download', inBar: true },
] as const

const BAR_ITEMS = NAV_ITEMS.filter((item) => item.inBar)

/**
 * Header of every public page (16 section 6.31). From 1100 the wordmark is in the middle of one
 * row; from 768 the links have a row of their own; on phones they are in the menu.
 */
export function PublicHeader() {
  const { t } = useTranslation('public')
  const isSignedIn = useSignedInHint()
  const ref = useBarHeight('--app-bar')

  return (
    <header ref={ref} className="sticky top-0 z-30 border-b border-border bg-background">
      <div className="container-app flex min-h-[64px] flex-wrap items-center gap-x-2 gap-y-1 py-2 wide:min-h-[80px] roomy:grid roomy:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] roomy:gap-x-4">
        <Logo className="me-auto max-w-full max-wide:[&_svg]:hidden roomy:col-start-2 roomy:row-start-1 roomy:me-0" />

        <nav
          aria-label={t('common:nav.primary_label')}
          className="hidden wide:order-last wide:block wide:basis-full roomy:order-none roomy:col-start-1 roomy:row-start-1"
        >
          <ul className="flex flex-wrap items-center gap-x-6">
            {BAR_ITEMS.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="inline-flex min-h-touch min-w-touch items-center rounded-sm text-label-lg text-foreground transition-colors hover:text-primary data-[status=active]:link-gold data-[status=active]:text-primary"
                >
                  {t(`header.nav.${item.key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex max-w-full flex-wrap items-center justify-end gap-2 roomy:col-start-3 roomy:row-start-1">
          <HeaderActions signedIn={isSignedIn} />
          <MobileMenu signedIn={isSignedIn} />
        </div>
      </div>
    </header>
  )
}

/**
 * "Sign in" and "Create a free profile", or "Open the app" for a signed-in visitor (17 section
 * 4.4). A phone keeps the first where it fits beside the menu: "Sign in" from 380, and the
 * wider "Open the app" from 410. The menu always has both.
 */
function HeaderActions({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation()
  const { t: tp } = useTranslation('public')

  if (signedIn) {
    return (
      <Button
        asChild
        size="compact"
        // 56 tall in a phone bar that stays 64 (DESIGN.md 6.16).
        className="text-label-md max-wide:-my-1 max-[410px]:hidden wide:px-[22px]"
      >
        <Link to="/home">{tp('header.open_app')}</Link>
      </Button>
    )
  }
  return (
    <>
      <Button
        asChild
        variant="quiet"
        size="compact"
        className="text-label-md max-[380px]:hidden wide:px-[20px]"
      >
        <Link {...signInLink}>{t('actions.sign_in')}</Link>
      </Button>
      <Button asChild className="text-label-md max-wide:hidden">
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
          variant="quiet"
          size="compact"
          aria-label={tp('header.menu_open')}
          className="gap-2 px-3 text-label-md wide:hidden"
        >
          <Menu aria-hidden="true" />
          {tp('header.menu_title')}
        </Button>
      </SheetTrigger>
      <SheetContent side="end" closeLabel={tp('header.menu_close')} aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{tp('header.menu_title')}</SheetTitle>
        </SheetHeader>
        <nav aria-label={tp('header.menu_title')}>
          <ul className="flex flex-col">
            {NAV_ITEMS.map((item) => (
              <li key={item.to} className="border-b border-border">
                <SheetClose asChild>
                  <Link
                    to={item.to}
                    className="flex min-h-touch-lg items-center py-2 text-title-sm text-foreground hover:text-primary data-[status=active]:text-primary"
                  >
                    {tp(`header.nav.${item.key}`)}
                  </Link>
                </SheetClose>
              </li>
            ))}
          </ul>
        </nav>
        <SheetFooter>
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
                <Button asChild size="lg" variant="secondary">
                  <Link {...signInLink}>{t('actions.sign_in')}</Link>
                </Button>
              </SheetClose>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

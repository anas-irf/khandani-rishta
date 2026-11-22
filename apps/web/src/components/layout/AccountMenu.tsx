import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CountBadge } from '~/components/common/CountBadge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { useSignOut } from '~/features/auth/useSignOut'
import { useCurrentMe } from '~/lib/me'
import { initialsOf } from '~/lib/utils'

/**
 * The account menu of the wide top bar (16 section 2.2, DESIGN.md 6.16): the arch and the name,
 * then My profile, Shortlist, Who viewed me, Photo requests, Settings, Sign out. A custom menu,
 * not Clerk's UserButton (17 section 5).
 */
export function AccountMenu() {
  const { t } = useTranslation()
  const me = useCurrentMe()
  const signOut = useSignOut()
  const [confirming, setConfirming] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const name = me.profile.first_name
  const initials = initialsOf(name ?? me.user.email?.slice(0, 1)) || '?'
  const isStaff = me.user.role === 'moderator' || me.user.role === 'admin'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          // The visible name is part of the accessible name (WCAG 2.5.3).
          aria-label={[t('nav.account_menu'), name].filter(Boolean).join(', ')}
          className="inline-flex min-h-touch max-w-full items-center gap-2.5 rounded-pill ps-1 pe-3 text-label-lg text-foreground transition-colors hover:bg-muted [&[data-state=open]>svg]:rotate-180"
        >
          <Avatar className="h-[48px] w-[38px]">
            {me.profile.photo?.thumb_url ? (
              <AvatarImage src={me.profile.photo.thumb_url} alt="" />
            ) : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          {name ? (
            <span className="hidden max-w-[6rem] min-w-0 text-start roomy:inline xl:max-w-[9rem]">
              {name}
            </span>
          ) : null}
          <ChevronDown
            aria-hidden="true"
            className="size-[18px] transition-transform duration-(--duration-base)"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[280px]">
          <DropdownMenuItem asChild>
            <Link to="/me">{t('nav.my_profile')}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/shortlist">{t('nav.shortlist')}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/visitors">{t('nav.visitors')}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/photo-requests" search={{ box: 'received' }}>
              {t('nav.photo_requests')}
              <CountBadge count={me.counters.pending_photo_requests} className="ms-auto" />
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings">{t('nav.settings')}</Link>
          </DropdownMenuItem>
          {isStaff ? (
            <DropdownMenuItem asChild>
              <Link to="/admin">{t('nav.admin')}</Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirming(true)}>
            {t('actions.sign_out')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sign_out_dialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('sign_out_dialog.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="ink"
              disabled={signingOut}
              aria-busy={signingOut || undefined}
              onClick={(event) => {
                event.preventDefault()
                setSigningOut(true)
                void signOut().finally(() => setSigningOut(false))
              }}
            >
              {t('actions.sign_out')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

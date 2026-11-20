import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { CountBadge } from './PrimaryNav'

/**
 * The avatar menu of the wide top bar (16 section 2.2): My profile, Shortlist, Who viewed me,
 * Photo requests, Settings, Sign out. A custom menu, not Clerk's UserButton (17 section 5).
 */
export function AccountMenu() {
  const { t } = useTranslation()
  const me = useCurrentMe()
  const signOut = useSignOut()
  const [confirming, setConfirming] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const initial = (me.profile.first_name ?? me.user.email ?? '?').slice(0, 1).toUpperCase()
  const isStaff = me.user.role === 'moderator' || me.user.role === 'admin'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('nav.account_menu')}
          className="inline-flex size-11 items-center justify-center rounded-full hover:bg-muted"
        >
          <Avatar className="size-9">
            {me.profile.photo?.thumb_url ? (
              <AvatarImage src={me.profile.photo.thumb_url} alt="" />
            ) : null}
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
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
              disabled={signingOut}
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

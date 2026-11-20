// APP-PROFILE (16 section 6.7)
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BlockDialog } from '~/components/common/BlockDialog'
import { ErrorState } from '~/components/common/ErrorState'
import { NoLongerAvailable } from '~/components/common/NoLongerAvailable'
import { useGoBack } from '~/components/common/PageHeader'
import { ReportDialog } from '~/components/common/ReportDialog'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import { isApiError } from '~/lib/api'
import type { ProfileDetail, Tier } from '~/lib/api-types'
import { ActionBar } from './components/ActionBar'
import { ProfileDetailView } from './ProfileDetailView'
import { forgetProfile, useProfile } from './queries'

/** A connection or an interest counterpart stays open while the own profile is paused or closed. */
function isRelated(tier: Tier): boolean {
  return tier === 'connection' || tier === 'interest_from_owner' || tier === 'interest_to_owner'
}

export function ProfileScreen({ profileId }: { profileId: string }) {
  const profile = useProfile(profileId)
  const error = profile.error
  const code = isApiError(error) ? error.code : null

  let content: ReactNode
  if (profile.data) {
    content = (
      <ScreenAccess screen="APP-PROFILE" allowed={isRelated(profile.data.relation.tier)}>
        <ProfileContent detail={profile.data} />
      </ScreenAccess>
    )
  } else if (code === 'not_found') {
    content = <NotFound profileId={profileId} />
  } else if (code === 'limit_reached') {
    content = <ViewLimitDialog />
  } else if (profile.isError) {
    // `profile_not_active`: Me is refetched by the global handler; the status panel follows.
    content = (
      <ScreenAccess screen="APP-PROFILE">
        <ErrorState
          error={error}
          onRetry={() => void profile.refetch()}
          retrying={profile.isFetching}
        />
      </ScreenAccess>
    )
  } else {
    content = <ProfileSkeleton />
  }

  return (
    <div className="container-app flex flex-col gap-2 pt-2">
      <BackRow />
      {content}
    </div>
  )
}

function BackRow() {
  const { t } = useTranslation('shared')
  const goBack = useGoBack()
  return (
    <div>
      <Button
        variant="ghost"
        size="icon"
        className="-ms-2"
        aria-label={t('header.back')}
        onClick={goBack}
      >
        <ArrowLeft aria-hidden="true" className="size-5 rtl:-scale-x-100" />
      </Button>
    </div>
  )
}

function ProfileContent({ detail }: { detail: ProfileDetail }) {
  return (
    <div className="pb-48 md:pb-0">
      <ProfileDetailView
        detail={detail}
        aside={<ActionBar detail={detail} />}
        footer={<SafetyFooter detail={detail} />}
      />
    </div>
  )
}

/** Block 12: "Report this profile", "Block" and the money warning. */
function SafetyFooter({ detail }: { detail: ProfileDetail }) {
  const { t } = useTranslation('profile')
  const [open, setOpen] = useState<'report' | 'block' | null>(null)
  const { card } = detail
  return (
    <footer className="flex flex-col gap-2 px-1 py-2">
      <div className="flex flex-wrap gap-x-4">
        <Button variant="link" className="px-0" onClick={() => setOpen('report')}>
          {t('safety.report')}
        </Button>
        <Button variant="link" className="px-0" onClick={() => setOpen('block')}>
          {t('safety.block')}
        </Button>
      </div>
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t('safety.money')}
      </p>
      <ReportDialog
        open={open === 'report'}
        onOpenChange={(next) => setOpen(next ? 'report' : null)}
        profileId={card.id}
        name={card.display_name}
      />
      <BlockDialog
        open={open === 'block'}
        onOpenChange={(next) => setOpen(next ? 'block' : null)}
        profileId={card.id}
        name={card.display_name}
      />
    </footer>
  )
}

/** `not_found`: "This profile is not available." and the member leaves the cached lists. */
function NotFound({ profileId }: { profileId: string }) {
  const { t } = useTranslation('profile')
  const queryClient = useQueryClient()
  useEffect(() => {
    forgetProfile(queryClient, profileId)
  }, [queryClient, profileId])
  return <NoLongerAvailable message={t('load.not_found')} />
}

/** `limit_reached` on a profile view: the dialog of 16 section 6.7, then back. */
function ViewLimitDialog() {
  const { t } = useTranslation('profile')
  const goBack = useGoBack()
  const [open, setOpen] = useState(true)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        setOpen(false)
        goBack()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('load.view_limit_title')}</AlertDialogTitle>
          <AlertDialogDescription className="text-base text-foreground">
            {t('load.view_limit')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={() => {
              setOpen(false)
              goBack()
            }}
          >
            {t('load.ok')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Loading: the gallery, the header and three blocks (16 section 6.7, "States"). */
export function ProfileSkeleton() {
  const { t } = useTranslation('shared')
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-6"
    >
      <span className="sr-only">{t('list.loading')}</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="aspect-[4/5] w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
      </div>
      <div aria-hidden="true" className="flex flex-col gap-4">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4"
          >
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  )
}

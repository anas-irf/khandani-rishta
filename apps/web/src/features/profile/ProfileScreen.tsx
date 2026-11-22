// APP-PROFILE (16 section 6.7)
import { useQueryClient } from '@tanstack/react-query'
import { Ban, Flag, TriangleAlert } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Band } from '~/components/common/Band'
import { ErrorState } from '~/components/common/ErrorState'
import { NoLongerAvailable } from '~/components/common/NoLongerAvailable'
import { useGoBack } from '~/components/common/PageHeader'
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
import { useIsWide } from '~/lib/media'
import { ActionBar, ActionRail, TopBarActions } from './components/ActionBar'
import { useProfileActions } from './components/actions'
import { ProfileActionsProvider } from './components/ProfileActionsProvider'
import { ProfileBackButton, ProfileTopBar } from './components/ProfileTopBar'
import { ProfileDetailView, profileColumnsClass } from './ProfileDetailView'
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
      <ScreenAccess
        screen="APP-PROFILE"
        allowed={isRelated(profile.data.relation.tier)}
        header={<ProfileTopBar />}
      >
        <ProfileContent detail={profile.data} />
      </ScreenAccess>
    )
  } else if (code === 'not_found') {
    content = (
      <ProfileStateLayout>
        <NotFound profileId={profileId} />
      </ProfileStateLayout>
    )
  } else if (code === 'limit_reached') {
    content = (
      <ProfileStateLayout>
        <ViewLimitDialog />
      </ProfileStateLayout>
    )
  } else if (profile.isError) {
    // `profile_not_active`: Me is refetched by the global handler; the status panel follows.
    content = (
      <ScreenAccess screen="APP-PROFILE" header={<ProfileTopBar />}>
        <ProfileStateLayout>
          <ErrorState
            error={error}
            onRetry={() => void profile.refetch()}
            retrying={profile.isFetching}
          />
        </ProfileStateLayout>
      </ScreenAccess>
    )
  } else {
    content = (
      <ProfileStateLayout>
        <ProfileSkeleton />
      </ProfileStateLayout>
    )
  }

  // `clip` and not `hidden`: the bands bleed to both edges and the bars inside stay sticky.
  return <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">{content}</div>
}

/** Loading and the errors: the back row, then the state on the page. */
export function ProfileStateLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ProfileTopBar />
      <Band as="div" space="sm" className="flex-1">
        {children}
      </Band>
    </>
  )
}

/**
 * Phones: the top bar, the article, and the action bar at the bottom. From 768 the actions are
 * a rail beside the article, and the bands still reach both edges of the window.
 */
function ProfileContent({ detail }: { detail: ProfileDetail }) {
  const wide = useIsWide()
  return (
    <ProfileActionsProvider detail={detail}>
      {wide ? null : (
        <ProfileTopBar name={detail.card.display_name}>
          <TopBarActions />
        </ProfileTopBar>
      )}
      <div className="container-app flex flex-1 gap-8 xl:gap-12">
        <ProfileDetailView
          detail={detail}
          lead={wide ? <ProfileBackButton className="-ms-3 mb-[8px]" /> : null}
          footer={<SafetyFooter />}
        />
        {wide ? (
          <div className="w-[320px] shrink-0 py-10 xl:w-[340px]">
            <ActionRail />
          </div>
        ) : null}
      </div>
      {wide ? null : <ActionBar />}
    </ProfileActionsProvider>
  )
}

/** Block 12: "Report this profile", "Block" and the money warning. */
function SafetyFooter() {
  const { t } = useTranslation('profile')
  const { openReport, openBlock } = useProfileActions()
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <div className="flex max-w-full flex-wrap gap-3">
        <Button variant="secondary" onClick={openReport}>
          <Flag aria-hidden="true" />
          {t('safety.report')}
        </Button>
        <Button variant="secondary" onClick={openBlock}>
          <Ban aria-hidden="true" />
          {t('safety.block')}
        </Button>
      </div>
      <p className="flex max-w-full items-center gap-3 text-foreground-secondary">
        <TriangleAlert aria-hidden="true" className="size-5 text-primary" />
        <span className="min-w-0">{t('safety.money')}</span>
      </p>
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
          <AlertDialogDescription className="text-foreground">
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
    <div role="status" aria-busy="true" className="flex flex-col gap-10">
      <span className="sr-only">{t('list.loading')}</span>
      <div aria-hidden="true" className={profileColumnsClass}>
        <div className="mx-auto min-w-0 max-w-[clamp(260px,80vw,380px)] flex-[1_1_300px]">
          <Skeleton className="aspect-[4/5] w-full rounded-arch-lg" />
        </div>
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-7 w-1/3 rounded-pill" />
          <Skeleton className="h-5 w-4/5" />
        </div>
      </div>
      {[0, 1, 2].map((index) => (
        <div key={index} aria-hidden="true" className="flex flex-col gap-3">
          <Skeleton className="h-7 w-2/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  )
}

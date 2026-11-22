import { Outlet, useParams } from '@tanstack/react-router'
import { EllipsisVertical } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Band } from '~/components/common/Band'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { OfflineBanner } from '~/components/common/OfflineBanner'
import { SkipLink } from '~/components/common/SkipLink'
import { Wordmark } from '~/components/layout/Logo'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { useSignOut } from '~/features/auth/useSignOut'
import { isOnboardingStep } from '~/lib/gate'
import { useMe } from '~/lib/me'
import { flush } from '~/lib/track'
import { fromSlug } from '~/lib/utils'
import { trackSignedOut } from './funnel'
import { ProgressHeader } from './ProgressHeader'

/**
 * The onboarding layout (17 section 3.3, 07 sections 2.3 and 2.6): the progress header with
 * the four groups and "Step N of 11", an overflow menu with "Sign out", no app navigation, and
 * one column that sits in a centred card at most 560 px wide on wide screens: on sand there,
 * straight on the page on phones.
 */
export function OnboardingLayout() {
  const { t } = useTranslation(['onboarding', 'common'])
  // Read without throwing: after sign-out the cache is cleared while this layout is still shown.
  const me = useMe({ enabled: false }).data
  const params = useParams({ strict: false }) as { step?: string }
  const step = params.step ? fromSlug(params.step) : null
  const signOut = useSignOut()
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SkipLink label={t('common:nav.skip_to_content')} />
      <OfflineBanner />
      <Band
        as="header"
        width="form"
        space="none"
        className="border-b border-border"
        innerClassName="flex flex-col gap-2 py-2"
      >
        <div className="flex min-h-touch items-center justify-between gap-3">
          <Wordmark />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-me-[12px]"
                aria-label={t('onboarding:menu.label')}
              >
                <EllipsisVertical aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setConfirmSignOut(true)}>
                {t('onboarding:menu.sign_out')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {me && step && isOnboardingStep(step) ? (
          <ProgressHeader step={step} currentStep={me.profile.onboarding_step} />
        ) : null}
      </Band>
      <main id="main" tabIndex={-1} className="band-page flex flex-1 flex-col wide:band-sand">
        <div className="mx-auto w-full max-w-form px-gutter pt-6 pb-10 wide:band-page wide:my-10 wide:w-[calc(100%-48px)] wide:rounded-xl wide:px-8 wide:py-8">
          <Outlet />
        </div>
      </main>
      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title={t('common:sign_out_dialog.title')}
        description={t('common:sign_out_dialog.body')}
        confirmLabel={t('common:actions.sign_out')}
        tone="ink"
        onConfirm={async () => {
          if (step) trackSignedOut(step)
          // Sign-out drops unsent events, so the funnel event goes out first.
          await flush()
          await signOut()
        }}
      />
    </div>
  )
}

import { Outlet, useParams } from '@tanstack/react-router'
import { MoreVertical } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { OfflineBanner } from '~/components/common/OfflineBanner'
import { LogoMark } from '~/components/layout/Logo'
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
 * one column that sits in a centred card at most 560 px wide on wide screens.
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
      <OfflineBanner />
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-h-11 items-center gap-2 font-bold text-primary">
              <LogoMark />
              <span className="text-lg">{t('common:app_name')}</span>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('onboarding:menu.label')}>
                  <MoreVertical aria-hidden="true" />
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
        </div>
      </header>
      <main id="main" className="flex-1 md:py-8">
        <div className="mx-auto w-full max-w-[560px] px-4 py-6 md:rounded-[var(--radius-card)] md:border md:border-border md:bg-surface md:px-8 md:py-8 md:shadow-sm">
          <Outlet />
        </div>
      </main>
      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title={t('common:sign_out_dialog.title')}
        description={t('common:sign_out_dialog.body')}
        confirmLabel={t('common:actions.sign_out')}
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

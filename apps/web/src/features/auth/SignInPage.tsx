import { SignIn } from '@clerk/tanstack-react-start'
import { Link, Navigate, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Wordmark } from '~/components/layout/Logo'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { clerkEnabled, isMockMode } from '~/lib/env'
import { useAuthSession } from './session'

/**
 * AUTH-SIGNIN (16 section 6.1, 17 section 5): Clerk's combined sign-in-or-sign-up component,
 * centred on a plain page with the logo and a link back to `/`.
 */
export function SignInPage({ redirectUrl }: { redirectUrl?: string }) {
  const { t } = useTranslation('auth')
  const session = useAuthSession()
  const target = redirectUrl ?? '/home'

  // A signed-in visitor goes on to the redirect target; AuthGate then applies the gate.
  if (session.isLoaded && session.isSignedIn) return <Navigate to={target} replace />

  return (
    <div className="band-page flex min-h-dvh flex-col items-center px-gutter py-8">
      <Link
        to="/"
        className="mb-8 flex min-h-touch max-w-full items-center rounded-sm"
        aria-label={t('back_home')}
      >
        <Wordmark />
      </Link>
      <main id="main" className="flex w-full max-w-[28rem] flex-col items-center gap-6">
        {/* Clerk's card brings its own visible h1, so this one is only for the other cards. */}
        {(isMockMode || !clerkEnabled) && <h1 className="sr-only">{t('title')}</h1>}
        {isMockMode ? (
          <MockSignIn target={target} />
        ) : clerkEnabled ? (
          // `withSignUp` turns on Clerk's combined sign-in-or-sign-up flow: there is no separate
          // sign-up page, and a new email address continues straight into sign-up (17 section 3.2).
          <SignIn
            routing="path"
            path="/sign-in"
            withSignUp
            fallbackRedirectUrl={target}
            signUpFallbackRedirectUrl={target}
          />
        ) : (
          <Card className="w-full">
            <CardHeader>
              <CardTitle as="h2">{t('unavailable.title')}</CardTitle>
              <CardDescription>{t('unavailable.description')}</CardDescription>
            </CardHeader>
          </Card>
        )}
        <p className="text-center text-caption text-muted-foreground">{t('privacy_note')}</p>
      </main>
    </div>
  )
}

function MockSignIn({ target }: { target: string }) {
  const { t } = useTranslation('auth')
  const session = useAuthSession()
  const navigate = useNavigate()
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle as="h2">{t('mock.title')}</CardTitle>
        <CardDescription>{t('mock.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          className="w-full"
          // The mock API starts first; signing in before it answers would reach the network.
          disabled={!session.isLoaded}
          loading={!session.isLoaded}
          onClick={() => {
            session.mockSignIn?.()
            void navigate({ to: target, replace: true })
          }}
        >
          {t('mock.continue')}
        </Button>
      </CardContent>
    </Card>
  )
}

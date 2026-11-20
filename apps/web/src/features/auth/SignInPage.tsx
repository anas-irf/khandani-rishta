import { SignIn } from '@clerk/tanstack-react-start'
import { Link, Navigate, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
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
    <div className="flex min-h-dvh flex-col items-center bg-background px-4 py-8">
      <Link
        to="/"
        className="mb-8 flex min-h-11 items-center gap-2 text-xl font-bold text-primary"
        aria-label={t('back_home')}
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-base text-primary-foreground">
          KR
        </span>
        {t('common:app_name')}
      </Link>
      <main id="main" className="flex w-full max-w-md flex-col items-center gap-6">
        <h1 className="sr-only">{t('title')}</h1>
        {isMockMode ? (
          <MockSignIn target={target} />
        ) : clerkEnabled ? (
          <SignIn
            routing="path"
            path="/sign-in"
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
        <p className="text-center text-sm text-muted-foreground">{t('privacy_note')}</p>
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

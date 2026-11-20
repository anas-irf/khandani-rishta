import { ClerkProvider, useAuth, useClerk } from '@clerk/tanstack-react-start'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { setTokenGetter } from '~/lib/api'
import { clerkEnabled, clerkPublishableKey, isMockMode } from '~/lib/env'

/**
 * The one place that talks to Clerk (17 section 5). Components read the session through
 * `useAuthSession()`, never from Clerk directly, so that mock mode can replace Clerk.
 */
export type AuthSession = {
  isLoaded: boolean
  isSignedIn: boolean
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>
  signOut: () => Promise<void>
  /** Opens Clerk's account dialog (email, Google account, devices). Not available in mock mode. */
  openUserProfile?: () => void
  /** Mock mode only: starts a fake session. */
  mockSignIn?: () => void
}

const AuthSessionContext = createContext<AuthSession | null>(null)

export function useAuthSession(): AuthSession {
  const session = useContext(AuthSessionContext)
  if (!session) throw new Error('useAuthSession() must be used inside AuthProvider')
  return session
}

/**
 * Hands the token getter to the API client (17 section 6.1). It is set during render, so the
 * first request of a child (such as GET /v1/me) already has it, and it is only ever replaced,
 * never cleared: route layouts can unmount and mount again while a screen's code loads, and a
 * request sent in that gap would be treated as signed out. A signed-out session registers a
 * getter that returns no token.
 */
function useRegisterTokenGetter(getToken: AuthSession['getToken']) {
  setTokenGetter(getToken)
  useEffect(() => {
    setTokenGetter(getToken)
  }, [getToken])
}

function ClerkSessionBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth()
  const clerk = useClerk()

  const session = useMemo<AuthSession>(
    () => ({
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      getToken: (options) => getToken(options?.skipCache ? { skipCache: true } : undefined),
      signOut: () => clerk.signOut(),
      openUserProfile: () => clerk.openUserProfile(),
    }),
    [isLoaded, isSignedIn, getToken, clerk],
  )
  useRegisterTokenGetter(session.getToken)

  return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>
}

/** Clerk's appearance set to the brand colours and font (17 section 9.3). */
const clerkAppearance = {
  variables: {
    colorPrimary: '#0F766E',
    colorDanger: '#B91C1C',
    colorSuccess: '#15803D',
    colorWarning: '#B45309',
    colorBackground: '#FFFFFF',
    fontFamily: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    fontSize: '16px',
    borderRadius: '8px',
  },
}

// ---------------------------------------------------------------------------
// Mock mode (src/lib/env.ts): a fake session kept in localStorage.
// ---------------------------------------------------------------------------

const MOCK_SESSION_KEY = 'kr.mock.session'
const MOCK_TOKEN = 'mock-session-token'

/**
 * The mock session outlives one provider: the signed-in layout can mount again while a screen's
 * code loads, and it should find the session already known instead of loading it again.
 */
let mockSessionKnown: boolean | null = null

function MockSessionProvider({ children }: { children: ReactNode }) {
  // null until the mock API has started (and on the server, so the first render agrees).
  const [signedIn, setSignedInState] = useState<boolean | null>(() =>
    typeof window === 'undefined' ? null : mockSessionKnown,
  )
  const setSignedIn = useCallback((value: boolean) => {
    mockSessionKnown = value
    setSignedInState(value)
  }, [])

  useEffect(() => {
    let cancelled = false
    // The mock API must answer before the first request is sent.
    import('~/mocks/browser')
      .then(({ startMockWorker }) => startMockWorker())
      .catch((error: unknown) => console.error('Mock API failed to start', error))
      .finally(() => {
        if (cancelled) return
        try {
          setSignedIn(window.localStorage.getItem(MOCK_SESSION_KEY) === '1')
        } catch {
          setSignedIn(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [setSignedIn])

  const session = useMemo<AuthSession>(
    () => ({
      isLoaded: signedIn !== null,
      isSignedIn: signedIn === true,
      getToken: async () => (signedIn ? MOCK_TOKEN : null),
      signOut: async () => {
        window.localStorage.removeItem(MOCK_SESSION_KEY)
        setSignedIn(false)
      },
      mockSignIn: () => {
        window.localStorage.setItem(MOCK_SESSION_KEY, '1')
        setSignedIn(true)
      },
    }),
    [signedIn, setSignedIn],
  )
  useRegisterTokenGetter(session.getToken)

  return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>
}

/** Test helper: provides a fixed session without Clerk. */
export function TestSessionProvider({
  session,
  children,
}: {
  session?: Partial<AuthSession>
  children: ReactNode
}) {
  const value = useMemo<AuthSession>(
    () => ({
      isLoaded: true,
      isSignedIn: true,
      getToken: async () => 'test-token',
      signOut: async () => {},
      ...session,
    }),
    [session],
  )
  useRegisterTokenGetter(value.getToken)
  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>
}

/** No Clerk key configured: everyone is signed out (see `clerkEnabled` in src/lib/env.ts). */
function SignedOutProvider({ children }: { children: ReactNode }) {
  const session = useMemo<AuthSession>(
    () => ({
      isLoaded: true,
      isSignedIn: false,
      getToken: async () => null,
      signOut: async () => {},
    }),
    [],
  )
  return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (isMockMode) return <MockSessionProvider>{children}</MockSessionProvider>
  if (!clerkEnabled) return <SignedOutProvider>{children}</SignedOutProvider>
  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey || undefined}
      appearance={clerkAppearance}
      signInUrl="/sign-in"
      signUpUrl="/sign-in"
      signInFallbackRedirectUrl="/home"
      signUpFallbackRedirectUrl="/home"
    >
      <ClerkSessionBridge>{children}</ClerkSessionBridge>
    </ClerkProvider>
  )
}

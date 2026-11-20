import { useEffect, useState } from 'react'
import { isMockMode } from '~/lib/env'

/**
 * Whether the visitor probably has a session, for public pages only (the "Open the app" link of
 * the public header). Public pages do not load Clerk at all, which keeps them within the
 * performance budget of 17 section 17; instead they read Clerk's `__client_uat` cookie, which is
 * `0` when signed out and the time of the last sign-in otherwise. It is a hint for one link: the
 * signed-in area itself always checks the real session (AuthGate).
 */
export function readSignedInHint(cookie: string, mockSession: string | null): boolean {
  if (isMockMode) return mockSession === '1'
  const value = /(?:^|;\s*)__client_uat(?:_[^=]+)?=([^;]*)/.exec(cookie)?.[1]
  return Boolean(value && value !== '0')
}

export function useSignedInHint(): boolean {
  // false on the server and in the first client render, so hydration matches.
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    let mock: string | null = null
    try {
      mock = window.localStorage.getItem('kr.mock.session')
    } catch {
      mock = null
    }
    setSignedIn(readSignedInHint(document.cookie, mock))
  }, [])
  return signedIn
}

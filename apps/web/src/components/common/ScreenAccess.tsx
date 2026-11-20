import type { ReactNode } from 'react'
import { type LeveledScreen, requiredLevel, statusPanelFor } from '~/lib/gate'
import { useCurrentMe } from '~/lib/me'
import { StatusPanel } from './StatusPanel'

/**
 * Renders a screen, or the status panel in its place when the own profile status does not
 * meet the screen's access level (16 rule G16, 17 section 4.3). The only place that decides
 * this; screens never check the status themselves.
 */
export function ScreenAccess({
  screen,
  allowed = false,
  children,
}: {
  /** The screen ID of 16. */
  screen: LeveledScreen
  /**
   * Shows the screen whatever the status. `APP-PROFILE` passes true for a connection or an
   * interest counterpart, which stays open while paused or closed (17 section 4.3).
   */
  allowed?: boolean
  children: ReactNode
}) {
  const me = useCurrentMe()
  const panel = allowed ? null : statusPanelFor(me.profile.status, requiredLevel(screen))
  if (panel) return <StatusPanel status={panel} />
  return <>{children}</>
}

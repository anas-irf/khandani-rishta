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
  header,
  panelTitleAs,
  children,
}: {
  /** The screen ID of 16. */
  screen: LeveledScreen
  /**
   * Shows the screen whatever the status. `APP-PROFILE` passes true for a connection or an
   * interest counterpart, which stays open while paused or closed (17 section 4.3).
   */
  allowed?: boolean
  /** Stays above the panel: the way back of a screen that has no header of its own then. */
  header?: ReactNode
  /** `h2` when that header holds the page's `h1`. */
  panelTitleAs?: 'h1' | 'h2'
  children: ReactNode
}) {
  const me = useCurrentMe()
  const panel = allowed ? null : statusPanelFor(me.profile.status, requiredLevel(screen))
  if (panel) {
    return (
      <>
        {header}
        <StatusPanel status={panel} titleAs={panelTitleAs} />
      </>
    )
  }
  return <>{children}</>
}

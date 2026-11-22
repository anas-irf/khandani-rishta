import { useCallback, useSyncExternalStore } from 'react'

/** The one layout switch (17 section 9.1), the same width as `--breakpoint-wide`. */
const WIDE_QUERY = '(min-width: 768px)'

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia(WIDE_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function isWide() {
  return typeof window.matchMedia !== 'function' || window.matchMedia(WIDE_QUERY).matches
}

/**
 * Whether the wide layout applies. Use it only where phones and wide screens need different
 * controls in a different place (the action bar or the side rail of APP-PROFILE), on screens
 * rendered in the browser; everything else switches with `wide:` classes.
 */
export function useIsWide(): boolean {
  return useSyncExternalStore(subscribe, isWide, () => true)
}

/** The sticky bars that can cover content. `styles/app.css` adds them up for scroll padding. */
type Bar = '--app-bar' | '--screen-bar' | '--bottom-nav' | '--action-bar'

/**
 * A ref that publishes a sticky bar's height as a CSS variable on `<html>`, kept up to date as
 * the bar wraps at larger text. A bar that is hidden or not sticky publishes 0.
 */
export function useBarHeight(name: Bar) {
  return useCallback(
    (node: HTMLElement | null) => {
      if (!node) return
      const root = document.documentElement
      // Marks the bar, so focus inside it never scrolls the page (styles/app.css).
      node.dataset.stickyBar = ''
      const publish = () => {
        // A bar that is static at this width covers nothing.
        const covers = getComputedStyle(node).position !== 'static'
        const height = covers ? Math.round(node.getBoundingClientRect().height) : 0
        root.style.setProperty(name, `${height}px`)
      }
      publish()
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
      observer?.observe(node)
      return () => {
        observer?.disconnect()
        root.style.removeProperty(name)
      }
    },
    [name],
  )
}

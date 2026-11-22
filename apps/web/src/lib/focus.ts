import { useEffect, useRef } from 'react'

/**
 * Moves keyboard focus to the element the ref is put on, when it takes the place of the control
 * that was used (the Undo of a passed card, then that card's link again). It runs as an effect,
 * so a closing menu has let go of the focus by then.
 */
export function useFocusOnMount<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (enabled) ref.current?.focus()
  }, [enabled])
  return ref
}

let menuOpener: HTMLElement | null = null

/** A key or a press outside every menu means the menu's item is not what opens the next dialog. */
function forgetMenuOpener(event: Event) {
  if (event.target instanceof Element && event.target.closest('[role="menu"]')) return
  menuOpener = null
  document.removeEventListener('keydown', forgetMenuOpener, true)
  document.removeEventListener('pointerdown', forgetMenuOpener, true)
}

/** A menu names its button with `aria-labelledby`. It is kept for a dialog opened from an item. */
export function rememberMenuOpener(menu: HTMLElement) {
  const id = menu.getAttribute('aria-labelledby')
  menuOpener = id ? document.getElementById(id) : null
  document.addEventListener('keydown', forgetMenuOpener, true)
  document.addEventListener('pointerdown', forgetMenuOpener, true)
}

/**
 * Radix gives focus back to a dialog's own Trigger only. Most dialogs here open from code (a
 * button, a menu item), so they give it back to the control that had it, or to the button of the
 * menu that had the item (DESIGN.md 6.18, 8).
 */
export function useReturnFocus({
  onOpenAutoFocus,
  onCloseAutoFocus,
}: {
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const opener = useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus(event: Event) {
      const active = document.activeElement
      // By now the menu is gone (focus is on the body) or still holds the focus.
      const fromMenu = !active || active === document.body || active.closest('[role="menu"]')
      opener.current = fromMenu ? menuOpener : (active as HTMLElement)
      menuOpener = null
      onOpenAutoFocus?.(event)
    },
    onCloseAutoFocus(event: Event) {
      onCloseAutoFocus?.(event)
      const target = opener.current
      opener.current = null
      if (event.defaultPrevented || !target?.isConnected) return
      event.preventDefault()
      target.focus()
    },
  }
}

/** Scrolls a field to the middle and focuses it, without the glide for those who ask for less motion. */
export function revealAndFocus(element: HTMLElement) {
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' })
  element.focus({ preventScroll: true })
}

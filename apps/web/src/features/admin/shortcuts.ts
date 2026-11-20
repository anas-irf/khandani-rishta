import { type RefObject, useEffect, useRef } from 'react'

/**
 * Keyboard shortcuts of the staff console (18 section 3). They work only when no text field
 * has focus and no dialog is open, and never with Ctrl, Alt or Meta held.
 */

export type ShortcutHandler = (event: KeyboardEvent) => void

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function dialogIsOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
}

/**
 * Registers `bindings` (key to handler, keys compared case-insensitively) for as long as the
 * component is mounted and `enabled` is true.
 */
export function useShortcuts(
  bindings: Record<string, ShortcutHandler | undefined>,
  enabled = true,
) {
  const latest = useRef(bindings)
  latest.current = bindings

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditable(event.target) || dialogIsOpen()) return
      const handler = latest.current[event.key.toLowerCase()]
      if (!handler) return
      event.preventDefault()
      handler(event)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/** The attribute that marks the link of a list row for J and K navigation. */
export const QUEUE_LINK_ATTRIBUTE = 'data-queue-link'

/**
 * `J` and `K` move focus to the next and previous row link of a list (18 section 3). Enter then
 * opens the row. With no row focused, `J` goes to the first row.
 */
export function useQueueFocusNavigation(
  containerRef: RefObject<HTMLElement | null>,
  enabled = true,
) {
  const move = (direction: 1 | -1) => {
    const container = containerRef.current
    if (!container) return
    const links = Array.from(container.querySelectorAll<HTMLElement>(`[${QUEUE_LINK_ATTRIBUTE}]`))
    if (links.length === 0) return
    const current = links.indexOf(document.activeElement as HTMLElement)
    const next = current === -1 ? (direction === 1 ? 0 : links.length - 1) : current + direction
    links[Math.min(Math.max(next, 0), links.length - 1)]?.focus()
  }
  useShortcuts({ j: () => move(1), k: () => move(-1) }, enabled)
}

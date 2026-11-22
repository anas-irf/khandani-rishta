import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { rememberMenuOpener, useReturnFocus } from './focus'

/** A menu that was opened from its button, with the focus gone as it closes. */
function openedMenu() {
  document.body.innerHTML = `
    <button id="more">More</button>
    <button id="other">Accept</button>
    <div id="menu" role="menu" aria-labelledby="more"><div role="menuitem">Report</div></div>`
  const byId = (id: string) => document.getElementById(id) as HTMLElement
  rememberMenuOpener(byId('menu'))
  return { more: byId('more'), other: byId('other'), menu: byId('menu') }
}

/** Opens a dialog while the body has the focus, then closes it. */
function openAndCloseDialog() {
  const { result } = renderHook(() => useReturnFocus({}))
  result.current.onOpenAutoFocus(new Event('focus'))
  result.current.onCloseAutoFocus(new Event('focus', { cancelable: true }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useReturnFocus', () => {
  it('gives focus back to the button of the menu whose item opened the dialog', () => {
    const { more, menu } = openedMenu()
    menu.firstElementChild?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    )
    openAndCloseDialog()
    expect(document.activeElement).toBe(more)
  })

  it.each(['keydown', 'pointerdown'])('forgets that menu after a %s outside it', (type) => {
    const { more, other } = openedMenu()
    other.dispatchEvent(new Event(type, { bubbles: true }))
    openAndCloseDialog()
    expect(document.activeElement).not.toBe(more)
  })
})

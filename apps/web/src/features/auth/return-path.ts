/**
 * Where to return after the member accepts updated terms (16 section 3.4: "After acceptance,
 * return to the previous screen"). Kept for the tab only.
 */
const KEY = 'kr.return_after_gate'

export function rememberReturnPath(path: string) {
  try {
    window.sessionStorage.setItem(KEY, path)
  } catch {
    // Storage unavailable: the member lands on the gate home instead.
  }
}

export function takeReturnPath(): string | null {
  try {
    const value = window.sessionStorage.getItem(KEY)
    window.sessionStorage.removeItem(KEY)
    return value?.startsWith('/') && !value.startsWith('//') ? value : null
  } catch {
    return null
  }
}

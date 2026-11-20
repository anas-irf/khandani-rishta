import { useCallback, useState } from 'react'

/**
 * A yes/no flag kept on this device only (`localStorage`), for one-time dismissals such as the
 * announcement and the first-run tip of `APP-HOME` (16 section 6.4, 07 section 15.2). A null
 * key is never set. Storage errors (private mode, full storage) keep the flag in memory.
 */
export function useDeviceFlag(key: string | null): [boolean, () => void] {
  const [value, setValue] = useState(() => (key ? readFlag(key) : false))
  const [seenKey, setSeenKey] = useState(key)
  if (seenKey !== key) {
    setSeenKey(key)
    setValue(key ? readFlag(key) : false)
  }

  const set = useCallback(() => {
    setValue(true)
    if (!key) return
    try {
      window.localStorage.setItem(key, '1')
    } catch {
      // The flag still holds for this visit.
    }
  }, [key])

  return [value, set]
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

/** A short stable hash of a text, so a dismissal is stored "against the text". */
export function textKey(text: string): string {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}

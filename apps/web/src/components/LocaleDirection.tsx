import { Direction } from 'radix-ui'
import { type ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { directionOf, initialLanguage, setLanguage } from '~/lib/i18n'
import { initMonitoring } from '~/lib/monitoring'

/**
 * Gives Radix primitives (menus, tabs, toggle groups, scroll areas) the text direction of the
 * active language; `<html dir>` alone does not reach them (17 section 12). In the browser it also
 * picks the language before `Me` is known (the saved choice, then the browser language, then
 * English; AuthGate switches to `Me.user.locale` once signed in) and starts error reporting.
 */
export function LocaleDirection({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()

  useEffect(() => {
    const language = initialLanguage()
    if (language !== i18n.language) void setLanguage(language)
    void initMonitoring()
  }, [i18n])

  return <Direction.Provider dir={directionOf(i18n.language)}>{children}</Direction.Provider>
}

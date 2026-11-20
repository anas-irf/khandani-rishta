import i18next, { type BackendModule, type ResourceKey } from 'i18next'
import { initReactI18next } from 'react-i18next'

/**
 * Translations (17 section 12). Every string a member reads comes from `src/locales`.
 *
 * - One JSON file per namespace and language: `locales/<lng>/<namespace>.json`.
 * - `common`, `errors` and `public` are bundled, so public pages render on the Worker
 *   without waiting. Every other namespace is loaded on first use with a dynamic import,
 *   which keeps the landing page small; `useTranslation('<namespace>')` suspends until then.
 * - Keys are stable descriptive paths (`chat.composer.placeholder`), never English sentences.
 * - Enumeration labels come from the API (lib/reference.ts), not from these files.
 */

type LocaleModule = { default: ResourceKey }

const bundled = import.meta.glob<LocaleModule>(
  ['../locales/en/common.json', '../locales/en/errors.json', '../locales/en/public.json'],
  { eager: true },
)
const lazy = import.meta.glob<LocaleModule>('../locales/*/*.json')

function parsePath(path: string): { lng: string; ns: string } {
  const match = /locales\/([^/]+)\/([^/]+)\.json$/.exec(path)
  return { lng: match?.[1] ?? 'en', ns: match?.[2] ?? 'common' }
}

/** Languages that have a locale folder. Urdu joins when `locales/ur` is added (20 section 6). */
export const SUPPORTED_LANGUAGES: readonly string[] = Array.from(
  new Set(Object.keys(lazy).map((path) => parsePath(path).lng)),
)

const resources: Record<string, Record<string, ResourceKey>> = {}
for (const [path, module] of Object.entries(bundled)) {
  const { lng, ns } = parsePath(path)
  resources[lng] ??= {}
  resources[lng][ns] = module.default
}

const lazyBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    const loader = lazy[`../locales/${language}/${namespace}.json`]
    if (!loader) {
      callback(null, {})
      return
    }
    loader().then(
      (module) => callback(null, module.default),
      (error: unknown) => callback(error as Error, false),
    )
  },
}

export const i18n = i18next.createInstance()

void i18n
  .use(lazyBackend)
  .use(initReactI18next)
  .init({
    resources,
    partialBundledLanguages: true,
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.length > 0 ? SUPPORTED_LANGUAGES : ['en'],
    ns: ['common', 'errors', 'public'],
    defaultNS: 'common',
    fallbackNS: 'common',
    initAsync: false,
    returnNull: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: true },
  })

const LOCALE_STORAGE_KEY = 'kr.locale'

/** Right-to-left languages among the ones the app may offer. */
export function directionOf(language: string): 'ltr' | 'rtl' {
  return language === 'ur' ? 'rtl' : 'ltr'
}

/**
 * The language to use before `Me` is known: the saved choice, then the browser language,
 * then English (17 section 12).
 */
export function initialLanguage(): string {
  if (typeof window === 'undefined') return 'en'
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved && SUPPORTED_LANGUAGES.includes(saved)) return saved
  } catch {
    // Storage can be unavailable (private mode); fall through.
  }
  const browser = window.navigator.language?.slice(0, 2)
  if (browser && SUPPORTED_LANGUAGES.includes(browser)) return browser
  return 'en'
}

/** Switches the language, remembers it and updates `<html lang dir>`. */
export async function setLanguage(language: string): Promise<void> {
  const next = SUPPORTED_LANGUAGES.includes(language) ? language : 'en'
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
  } catch {
    // Ignore storage failures.
  }
  if (i18n.language !== next) await i18n.changeLanguage(next)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next
    document.documentElement.dir = directionOf(next)
  }
}

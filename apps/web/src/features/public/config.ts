/**
 * Constants of the public pages (17 section 3.1 and 13).
 */

/** The production origin (02 Q-11). Used where a page needs an absolute URL. */
export const SITE_URL = 'https://khandanirishta.app'

/** The support address (02 Q-11). Every public page reads it from here. */
export const SUPPORT_EMAIL = 'support@khandanirishta.app'

/** The one static brand image used for Open Graph (17 section 13). Export a PNG before launch. */
export const OG_IMAGE_PATH = '/og-image.svg'

/** Every public page, in the order the sitemap lists them (17 section 3.1). */
export const PUBLIC_PAGE_PATHS = [
  '/',
  '/how-it-works',
  '/safety',
  '/nikah-guide',
  '/faq',
  '/download',
  '/contact',
  '/terms',
  '/privacy',
  '/community-guidelines',
] as const

/** Page keys used by `meta.pages.<key>` in `locales/en/public.json`. */
export type PublicPageKey =
  | 'home'
  | 'how_it_works'
  | 'safety'
  | 'nikah_guide'
  | 'faq'
  | 'download'
  | 'contact'
  | 'terms'
  | 'privacy'
  | 'community_guidelines'

/**
 * Props for a `<Link>` to the sign-in page. `/sign-in/$` is a splat route (Clerk owns the
 * sub-paths), and "Create a free profile" and "Sign in" both open it (17 section 3.2).
 */
export const signInLink = { to: '/sign-in/$', params: { _splat: '' } } as const

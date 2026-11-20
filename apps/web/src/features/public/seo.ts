import { i18n } from '~/lib/i18n'
import { OG_IMAGE_PATH, type PublicPageKey } from './config'

/** A JSON-LD value (schema.org structured data). */
export type LdValue = string | number | boolean | null | LdValue[] | { [key: string]: LdValue }
export type LdObject = { [key: string]: LdValue }

type Meta = Record<string, unknown>

/**
 * The `head()` of a public page (17 section 13): its own title ("<Page> | Khandani Rishta"),
 * description, Open Graph tags with the one static brand image (never a member photo), and
 * optional structured data.
 */
export function pageHead(
  page: PublicPageKey,
  options: { jsonLd?: LdObject } = {},
): { meta: Meta[] } {
  const title = i18n.t('public:meta.title', {
    page: i18n.t(`public:meta.pages.${page}.title`),
  })
  const description = i18n.t(`public:meta.pages.${page}.description`)

  const meta: Meta[] = [
    { title },
    { name: 'description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:locale', content: 'en_PK' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: OG_IMAGE_PATH },
    { property: 'og:image:alt', content: i18n.t('public:meta.og_image_alt') },
    { name: 'twitter:card', content: 'summary_large_image' },
  ]
  if (options.jsonLd) meta.push({ 'script:ld+json': options.jsonLd })
  return { meta }
}

/** `Organization` structured data for the landing page (17 section 13). */
export function organizationJsonLd(): LdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: i18n.t('common:app_name'),
    slogan: i18n.t('public:home.hero.title'),
    description: i18n.t('public:meta.default_description'),
    areaServed: 'PK',
    // `url` and `logo` are added when the domain is decided (02 Q-11). Prerendered pages must
    // not bake in the origin of the build machine, so they are left out until then.
  }
}

export type FaqEntry = { question: string; answer: string }

/** `FAQPage` structured data for the questions and answers page (17 section 13). */
export function faqJsonLd(entries: readonly FaqEntry[]): LdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  }
}

import { Link } from '@tanstack/react-router'
import {
  BadgeCheck,
  Ban,
  Camera,
  Check,
  Flag,
  HeartHandshake,
  Lock,
  ShieldCheck,
  Smartphone,
  Users,
} from 'lucide-react'
import type { ComponentType, ReactNode, SVGProps } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { CreateProfileButton, CtaBand, FaqItem, linkClass, useList } from './content'
import { faqEntry, HOME_FAQ_IDS } from './faq'

/**
 * PUB-HOME (16 section 7.1): explains the product and invites sign-up. Static content, no data.
 * The signed-in redirect to /home happens in the route's `beforeLoad` (17 section 4.4).
 */
export function HomePage() {
  const { t } = useTranslation('public')
  const promises = useList<{ title: string; body: string }>('home.promises.items')
  const steps = useList<string>('home.how.steps')
  const privacyItems = useList<string>('home.privacy.items')
  const verification = useList<{ title: string; body: string }>('home.verification.items')
  const safety = useList<{ title: string; body: string }>('home.safety.items')
  const translate = (key: string) => t(key)

  return (
    <>
      <Hero />

      <HomeSection id="promises" title={t('home.promises.title')} tone="surface">
        <ul className="grid gap-4 md:grid-cols-3">
          {promises.map((promise, index) => (
            <li key={promise.title}>
              <FeatureCard
                icon={PROMISE_ICONS[index] ?? Lock}
                title={promise.title}
                body={promise.body}
              />
            </li>
          ))}
        </ul>
      </HomeSection>

      <HomeSection id="how" title={t('home.how.title')}>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <li
              key={step}
              className="flex gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground"
              >
                {index + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-5">
          <Link to="/how-it-works" className={cn(linkClass, 'inline-flex min-h-11 items-center')}>
            {t('home.how.more')}
          </Link>
        </p>
      </HomeSection>

      <HomeSection id="privacy" title={t('home.privacy.title')} tone="soft">
        <ul className="grid gap-3 md:grid-cols-2">
          {privacyItems.map((item) => (
            <li key={item} className="flex items-start gap-3 leading-relaxed">
              <Check aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </HomeSection>

      <HomeSection id="verification" title={t('home.verification.title')}>
        <p className="max-w-3xl text-lg leading-relaxed">{t('home.verification.body')}</p>
        <ul className="mt-5 grid gap-4 md:grid-cols-2">
          {verification.map((item, index) => (
            <li key={item.title}>
              <FeatureCard
                icon={index === 0 ? BadgeCheck : Camera}
                title={item.title}
                body={item.body}
              />
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
          {t('home.verification.note')}
        </p>
      </HomeSection>

      <HomeSection id="families" title={t('home.families.title')} tone="surface">
        <div className="flex max-w-3xl items-start gap-4">
          <Users aria-hidden="true" className="mt-1 size-8 shrink-0 text-primary" />
          <div className="space-y-2">
            <p className="text-lg font-semibold">{t('home.families.lead')}</p>
            <p className="leading-relaxed">{t('home.families.body')}</p>
          </div>
        </div>
      </HomeSection>

      <HomeSection id="safety" title={t('home.safety.title')}>
        <ul className="grid gap-4 md:grid-cols-3">
          {safety.map((item, index) => (
            <li key={item.title}>
              <FeatureCard
                icon={SAFETY_ICONS[index] ?? ShieldCheck}
                title={item.title}
                body={item.body}
              />
            </li>
          ))}
        </ul>
        <p className="mt-5">
          <Link to="/safety" className={cn(linkClass, 'inline-flex min-h-11 items-center')}>
            {t('home.safety.link')}
          </Link>
        </p>
      </HomeSection>

      <HomeSection id="app" title={t('home.download.title')} tone="soft">
        <div className="flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-start">
          <Smartphone aria-hidden="true" className="size-8 shrink-0 text-primary" />
          <div className="space-y-4">
            <p className="leading-relaxed">{t('home.download.body')}</p>
            <div className="flex flex-wrap items-center gap-4">
              <Button asChild size="lg">
                <Link to="/download">{t('home.download.button')}</Link>
              </Button>
              <p className="text-sm text-foreground">{t('home.download.note')}</p>
            </div>
          </div>
        </div>
      </HomeSection>

      <HomeSection id="questions" title={t('home.faq.title')}>
        <div className="max-w-3xl space-y-2">
          {HOME_FAQ_IDS.map((id) => {
            const entry = faqEntry(translate, id)
            return <FaqItem key={id} question={entry.question} answer={entry.answer} />
          })}
        </div>
        <p className="mt-5">
          <Link to="/faq" className={cn(linkClass, 'inline-flex min-h-11 items-center')}>
            {t('home.faq.link')}
          </Link>
        </p>
      </HomeSection>

      <CtaBand title={t('home.cta.title')} body={t('home.cta.body')} />
    </>
  )
}

type IconType = ComponentType<SVGProps<SVGSVGElement>>

const PROMISE_ICONS: IconType[] = [Lock, BadgeCheck, HeartHandshake]
const SAFETY_ICONS: IconType[] = [Ban, Flag, ShieldCheck]

function Hero() {
  const { t } = useTranslation('public')
  return (
    <section aria-labelledby="home-title" className="bg-primary-soft">
      <div className="container-app grid items-center gap-8 py-12 md:grid-cols-[3fr_2fr] md:py-16">
        <div className="space-y-5">
          <h1 id="home-title" className="text-4xl font-bold leading-tight md:text-5xl">
            {t('home.hero.title')}
          </h1>
          <p className="max-w-xl text-lg leading-relaxed md:text-xl">{t('home.hero.subtitle')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <CreateProfileButton />
            <Button asChild size="lg" variant="outline">
              <Link to="/how-it-works">{t('home.hero.secondary')}</Link>
            </Button>
          </div>
        </div>
        <HeroIllustration className="mx-auto w-full max-w-xs md:max-w-sm" />
      </div>
    </section>
  )
}

/**
 * A calm, decorative drawing: an arch with two joined rings. No photos of couples (16 section
 * 7.1). Hidden from screen readers.
 */
function HeroIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 320" aria-hidden="true" focusable="false" className={className}>
      <rect width="320" height="320" rx="28" className="fill-surface" />
      <path
        d="M56 288V148a104 104 0 0 1 208 0v140z"
        strokeWidth="5"
        className="fill-primary-soft stroke-primary"
      />
      <path
        d="M88 288V150a72 72 0 0 1 144 0v138z"
        strokeWidth="3"
        className="fill-surface stroke-primary"
      />
      <circle cx="140" cy="172" r="34" fill="none" strokeWidth="7" className="stroke-primary" />
      <circle cx="180" cy="172" r="34" fill="none" strokeWidth="7" className="stroke-accent" />
      <path d="M160 96l6 14 15 2-11 10 3 15-13-8-13 8 3-15-11-10 15-2z" className="fill-accent" />
      <path d="M40 288h240" strokeWidth="5" strokeLinecap="round" className="stroke-primary" />
      <circle cx="44" cy="52" r="5" className="fill-primary" />
      <circle cx="276" cy="64" r="7" className="fill-accent" />
      <circle cx="288" cy="120" r="4" className="fill-primary" />
    </svg>
  )
}

function HomeSection({
  id,
  title,
  tone,
  children,
}: {
  id: string
  title: string
  tone?: 'surface' | 'soft'
  children: ReactNode
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        'py-10 md:py-14',
        tone === 'surface' && 'border-y border-border bg-surface',
        tone === 'soft' && 'bg-primary-soft',
      )}
    >
      <div className="container-app">
        <h2 id={`${id}-title`} className="mb-6 text-2xl font-semibold md:text-3xl">
          {title}
        </h2>
        {children}
      </div>
    </section>
  )
}

function FeatureCard({ icon: Icon, title, body }: { icon: IconType; title: string; body: string }) {
  return (
    <div className="h-full rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <Icon aria-hidden="true" className="size-8 text-primary" />
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mt-1 leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

import { Link } from '@tanstack/react-router'
import {
  Camera,
  Check,
  CirclePause,
  Download,
  EyeOff,
  Flag,
  IdCard,
  Lock,
  type LucideIcon,
  Phone,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  UserRound,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  ArchFrame,
  ArchIcon,
  ArchInlay,
  type ArchTone,
  Monogram,
  MonogramArch,
} from '~/components/common/Arch'
import { Band } from '~/components/common/Band'
import { DisplayHeading } from '~/components/common/DisplayHeading'
import { NameAge } from '~/components/common/NameAge'
import { Diamond, OrnamentRule } from '~/components/common/Ornament'
import { TextLink } from '~/components/common/TextLink'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { CreateProfileButton, CtaBand, FaqItem, useList } from './content'
import { faqEntry, HOME_FAQ_IDS } from './faq'

/**
 * PUB-HOME (16 section 7.1): explains the product and invites sign-up. Static content, no data.
 * The signed-in redirect to /home happens in the route's `beforeLoad` (17 section 4.4).
 */
export function HomePage() {
  const { t } = useTranslation('public')
  return (
    <>
      <Hero />
      <Promises />
      <HowItWorks />
      <PrivacyAndVerification />
      <Families />
      <SafetyAndApp />
      <Questions />
      <CtaBand
        title={
          <Trans t={t} i18nKey="home.cta.title" components={{ em: <em className="italic" /> }} />
        }
        body={t('home.cta.body')}
      />
    </>
  )
}

/** The people of the illustrations. They are drawings, and the names are examples. */
const SAMPLE = { name: 'Ayesha K.', age: 26, parent: 'Nasreen K.' }

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero() {
  const { t } = useTranslation(['public', 'shared'])
  const promises = useList<{ title: string; body: string }>('home.promises.items')
  const privacy = useList<string>('home.privacy.items')

  return (
    <Band
      aria-labelledby="home-title"
      space="none"
      innerClassName="flex flex-col items-center gap-6 pt-[clamp(36px,6vw,96px)] pb-[clamp(48px,6vw,96px)] text-center"
    >
      <OrnamentRule centered />
      <h1 id="home-title" className="max-w-full display-hero font-display font-normal text-balance">
        <Trans
          t={t}
          i18nKey="home.hero.title"
          components={{ em: <em className="text-primary italic" /> }}
        />
      </h1>
      <p className="max-w-[38ch] text-body-lg text-foreground-secondary wide:text-[1.3125rem] wide:leading-[1.6]">
        {t('home.hero.subtitle')}
      </p>
      <div className="flex max-w-full flex-wrap justify-center gap-x-4 gap-y-3">
        <CreateProfileButton />
        <Button asChild size="lg" variant="secondary">
          <Link to="/how-it-works">{t('home.hero.secondary')}</Link>
        </Button>
      </div>

      <ul className="mt-2 flex w-full flex-col gap-3 wide:mt-[clamp(16px,3vw,40px)] wide:flex-row wide:items-end wide:justify-center wide:gap-[clamp(16px,3vw,40px)]">
        <HeroArch caption={privacy[0]}>
          {/* The file itself is blurred, as a private photo from the API is (16 rule G10). */}
          <Illustration src="/illustrations/portrait-private.svg" />
          <span className="absolute inset-0 flex items-center justify-center bg-background/35 wide:items-end wide:px-2 wide:pb-[16px]">
            <span className="flex size-[30px] items-center justify-center rounded-pill bg-background text-label-sm font-bold text-foreground wide:size-auto wide:max-w-full wide:gap-2 wide:px-3 wide:py-2">
              <Lock aria-hidden="true" strokeWidth={2.2} className="size-[15px]" />
              <span className="min-w-0 max-wide:sr-only">{t('shared:photo.private')}</span>
            </span>
          </span>
        </HeroArch>

        <HeroArch caption={privacy[1]} centre>
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-2 wide:p-6">
            <span className="contents max-wide:hidden">
              <ArchInlay double />
              <Diamond className="size-[10px]" />
            </span>
            <Monogram name={SAMPLE.name} size="hero" />
            <span className="relative max-w-full text-figure max-wide:hidden">
              <NameAge name={SAMPLE.name} age={SAMPLE.age} />
            </span>
          </span>
        </HeroArch>

        <HeroArch caption={promises[1]?.body}>
          <Illustration src="/illustrations/portrait.svg" />
          <span className="absolute inset-0 flex items-end justify-end p-1 wide:justify-center wide:px-2 wide:pb-[16px]">
            <span className="flex size-[26px] items-center justify-center rounded-pill bg-success text-label-sm font-bold text-success-foreground wide:size-auto wide:max-w-full wide:gap-2 wide:px-3 wide:py-2">
              <Check aria-hidden="true" strokeWidth={2.6} className="size-[15px]" />
              <span className="min-w-0 max-wide:sr-only">{t('shared:badge.photo_verified')}</span>
            </span>
          </span>
        </HeroArch>
      </ul>
    </Band>
  )
}

/**
 * One of the three arches: 4:5 and captioned on wide screens, a row with a small arch on phones.
 * The drawing is decoration; the caption is what it says.
 */
function HeroArch({
  caption,
  centre = false,
  children,
}: {
  caption: string | undefined
  centre?: boolean
  children: ReactNode
}) {
  return (
    <li
      className={cn(
        'min-w-0',
        centre ? 'wide:w-[clamp(210px,23vw,280px)]' : 'wide:w-[clamp(180px,19vw,230px)]',
      )}
    >
      <figure className="flex w-full items-center gap-4 rounded-row bg-muted py-3 ps-3 pe-4 text-start [--tonal:var(--color-background)] wide:flex-col wide:gap-4 wide:bg-transparent wide:p-0 wide:text-center wide:[--tonal:var(--color-muted)]">
        <ArchFrame
          aria-hidden="true"
          className={cn(
            'h-[80px] w-[64px] shrink-0 wide:aspect-[4/5] wide:h-auto wide:w-full',
            centre && 'border-[1.5px] border-accent-decor wide:border-0',
          )}
        >
          {children}
        </ArchFrame>
        <figcaption className="min-w-0 text-body-sm text-foreground-secondary wide:max-w-[24ch] wide:text-muted-foreground">
          {caption}
        </figcaption>
      </figure>
    </li>
  )
}

function Illustration({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      width={400}
      height={500}
      decoding="async"
      className="block size-full object-cover"
    />
  )
}

// ---------------------------------------------------------------------------
// Promises and steps
// ---------------------------------------------------------------------------

const NUMERALS = ['i', 'ii', 'iii']

function Promises() {
  const { t } = useTranslation('public')
  const promises = useList<{ title: string; body: string }>('home.promises.items')
  return (
    <Band
      id="promises"
      aria-labelledby="promises-title"
      tone="sand"
      space="lg"
      innerClassName="flex flex-col gap-10"
    >
      <DisplayHeading id="promises-title" className="text-center">
        {t('home.promises.title')}
      </DisplayHeading>
      <ol className="border-t border-accent-decor">
        {promises.map((promise, index) => (
          <li
            key={promise.title}
            className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b border-accent-decor/55 py-8"
          >
            <span
              aria-hidden="true"
              className="min-w-[1.5em] font-display text-display-sm text-primary italic"
            >
              {NUMERALS[index]}
            </span>
            <h3 className="max-w-full flex-[1_1_340px] text-title-lg wide:text-headline-sm">
              {promise.title}
            </h3>
            <p className="max-w-full flex-[1_1_340px] text-body-lg text-foreground-secondary">
              {promise.body}
            </p>
          </li>
        ))}
      </ol>
    </Band>
  )
}

function HowItWorks() {
  const { t } = useTranslation('public')
  const steps = useList<string>('home.how.steps')
  return (
    <Band
      id="how"
      aria-labelledby="how-title"
      tone="inverse"
      space="lg"
      innerClassName="flex flex-col items-center gap-10"
    >
      <DisplayHeading id="how-title" className="text-center">
        {t('home.how.title')}
      </DisplayHeading>
      <ol className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-6">
        {steps.map((step, index) => (
          <li
            key={step}
            className="flex min-h-[300px] min-w-0 flex-col items-center gap-4 rounded-arch-step border border-accent-decor/70 px-[24px] pt-[64px] pb-8 text-center"
          >
            <span
              aria-hidden="true"
              className="font-display text-display-md text-accent-on-inverse"
            >
              {index + 1}
            </span>
            <p className="max-w-full text-title-lg">{step}</p>
          </li>
        ))}
      </ol>
      <TextLink to="/how-it-works" className="text-inverse-foreground hover:text-accent-on-inverse">
        {t('home.how.more')}
      </TextLink>
    </Band>
  )
}

// ---------------------------------------------------------------------------
// Privacy and verification
// ---------------------------------------------------------------------------

const PRIVACY_ICONS: LucideIcon[] = [EyeOff, UserRound, Phone, IdCard, CirclePause]

/** Two columns that stack when they no longer fit. */
const SPLIT = 'flex flex-wrap items-start gap-x-[clamp(40px,5vw,80px)] gap-y-12'
const SPLIT_MAIN = 'flex min-w-0 max-w-full flex-[6_1_440px] flex-col items-start gap-6'
const SPLIT_ASIDE =
  'flex min-w-0 max-w-full flex-[5_1_340px] flex-col items-start gap-5 rounded-xl p-[clamp(24px,3vw,44px)]'

function PrivacyAndVerification() {
  const { t } = useTranslation('public')
  const items = useList<string>('home.privacy.items')
  const checks = useList<{ title: string; body: string }>('home.verification.items')

  return (
    <Band as="div" space="lg" innerClassName={SPLIT}>
      <section id="privacy" aria-labelledby="privacy-title" className={SPLIT_MAIN}>
        <DisplayHeading id="privacy-title">{t('home.privacy.title')}</DisplayHeading>
        <ul className="flex w-full flex-col gap-3">
          {items.map((item, index) => {
            const Icon = PRIVACY_ICONS[index] ?? Lock
            return (
              <li
                key={item}
                className="tonal flex min-h-[72px] flex-col justify-center rounded-row px-[20px] py-4 text-body-lg"
              >
                <span className="flex items-start gap-[16px]">
                  <span aria-hidden="true" className="flex h-[1lh] items-center text-primary">
                    <Icon strokeWidth={1.8} className="size-[1.2em]" />
                  </span>
                  <span className="min-w-0">{item}</span>
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      <section
        id="verification"
        aria-labelledby="verification-title"
        className={cn('band-success', SPLIT_ASIDE)}
      >
        <h2 id="verification-title" className="max-w-full text-headline-sm wide:text-headline-md">
          {t('home.verification.title')}
        </h2>
        <p>{t('home.verification.body')}</p>
        <ul className="flex flex-col gap-5">
          {checks.map((check, index) => (
            <li key={check.title} className="flex items-start gap-4">
              <ArchIcon icon={index === 0 ? IdCard : Camera} size="lg" tone="solid" />
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="text-title-md font-bold text-success">{check.title}</h3>
                <p>{check.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t border-success/30 pt-4 text-body-sm text-foreground-secondary">
          {t('home.verification.note')}
        </p>
      </section>
    </Band>
  )
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

function Families() {
  const { t } = useTranslation('public')
  return (
    <Band
      id="families"
      aria-label={t('home.families.title')}
      tone="sand"
      space="lg"
      innerClassName="flex flex-col items-center gap-10 text-center"
    >
      <div className="flex max-w-full flex-col items-center gap-4">
        <DisplayHeading>{t('home.families.lead')}</DisplayHeading>
        <p className="max-w-[56ch] text-body-lg text-foreground-secondary">
          {t('home.families.body')}
        </p>
      </div>
      {/* The parent, the person the profile is for, and the guardian's phone. */}
      <div aria-hidden="true" className="flex max-w-full items-center justify-center">
        <MonogramArch name={SAMPLE.parent} size="xl" tone="page" className={FAMILY_ARCH} />
        <span className={FAMILY_LINE} />
        <MonogramArch name={SAMPLE.name} size="xl" tone="primary" className={FAMILY_ARCH} />
        <span className={FAMILY_LINE} />
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-arch border-[1.5px] border-accent-decor bg-background text-primary',
            FAMILY_ARCH,
          )}
        >
          <Smartphone strokeWidth={1.5} className="size-[30px]" />
        </span>
      </div>
    </Band>
  )
}

const FAMILY_ARCH = 'aspect-[4/5] h-auto w-[clamp(68px,22vw,96px)]'
const FAMILY_LINE = 'h-px w-[clamp(8px,4vw,64px)] bg-accent-decor'

// ---------------------------------------------------------------------------
// Safety and the app
// ---------------------------------------------------------------------------

const SAFETY_LOOK: { icon: LucideIcon; tone: ArchTone }[] = [
  { icon: TriangleAlert, tone: 'primary' },
  { icon: Flag, tone: 'tonal' },
  { icon: ShieldCheck, tone: 'success' },
]

function SafetyAndApp() {
  const { t } = useTranslation('public')
  const items = useList<{ title: string; body: string }>('home.safety.items')
  return (
    <Band as="div" space="lg" innerClassName={SPLIT}>
      <section id="safety" aria-labelledby="safety-title" className={SPLIT_MAIN}>
        <DisplayHeading id="safety-title">{t('home.safety.title')}</DisplayHeading>
        <ul className="flex flex-col gap-5">
          {items.map((item, index) => (
            <li key={item.title} className="flex items-start gap-4">
              <ArchIcon
                icon={SAFETY_LOOK[index]?.icon ?? ShieldCheck}
                tone={SAFETY_LOOK[index]?.tone}
              />
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="text-title-md font-bold">{item.title}</h3>
                <p className="text-foreground-secondary">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <TextLink to="/safety">{t('home.safety.link')}</TextLink>
      </section>

      <section id="app" aria-labelledby="app-title" className={cn('band-sand', SPLIT_ASIDE)}>
        <h2 id="app-title" className="max-w-full text-headline-sm wide:text-headline-md">
          {t('home.download.title')}
        </h2>
        <p className="text-body-lg text-foreground-secondary">{t('home.download.body')}</p>
        <Button asChild size="lg" variant="secondary">
          <Link to="/download">
            <Download aria-hidden="true" />
            {t('home.download.button')}
          </Link>
        </Button>
        <p className="text-body-sm text-muted-foreground">{t('home.download.note')}</p>
      </section>
    </Band>
  )
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

function Questions() {
  const { t } = useTranslation('public')
  const translate = (key: string) => t(key)
  return (
    <Band
      id="questions"
      aria-labelledby="questions-title"
      tone="sand"
      width="column"
      space="lg"
      innerClassName="flex flex-col gap-8"
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <DisplayHeading id="questions-title">{t('home.faq.title')}</DisplayHeading>
        <TextLink to="/faq">{t('home.faq.link')}</TextLink>
      </div>
      <div className="flex flex-col gap-3">
        {HOME_FAQ_IDS.map((id) => {
          const entry = faqEntry(translate, id)
          return <FaqItem key={id} question={entry.question} answer={entry.answer} />
        })}
      </div>
    </Band>
  )
}

// ME-EDIT (16 section 6.18, 08 section 2)
import { useBlocker, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { PageHeader } from '~/components/common/PageHeader'
import { NotFound } from '~/components/NotFound'
import { Button } from '~/components/ui/button'
import { useOwnProfile } from '~/features/profile-sections/queries'
import { SectionForm, type SectionKey } from '~/features/profile-sections/SectionForm'
import type { OwnProfile } from '~/lib/api-types'
import { fromSlug } from '~/lib/utils'

export const EDIT_SECTIONS: readonly SectionKey[] = [
  'account_for',
  'basics',
  'community',
  'location',
  'education_career',
  'family',
  'lifestyle',
]

/** The section of a `$section` slug (17 section 3.3), or null for an unknown slug. */
export function sectionFromSlug(slug: string | undefined): SectionKey | null {
  if (!slug) return null
  const key = fromSlug(slug)
  return (EDIT_SECTIONS as readonly string[]).includes(key) ? (key as SectionKey) : null
}

type ReviewPrompt = 'religion' | 'country'

/**
 * Edit one section of the own profile with the onboarding form of the same name (`mode="edit"`).
 * Save shows "Saved" and returns to `ME-PROFILE`; leaving with unsaved input asks first.
 */
export function MeEditScreen({ section: slug }: { section: string }) {
  const { t } = useTranslation('me')
  const section = sectionFromSlug(slug)
  if (!section) {
    return (
      <div className="container-app">
        <NotFound>
          <p>{t('edit.not_found')}</p>
        </NotFound>
      </div>
    )
  }
  return <EditSection key={section} section={section} />
}

function EditSection({ section }: { section: SectionKey }) {
  const { t } = useTranslation('me')
  const navigate = useNavigate()
  const profile = useOwnProfile()
  // The values the form was filled from, to notice a changed religion or country (08 2.3).
  const before = useRef<OwnProfile | null>(null)
  if (!before.current && profile.isFetchedAfterMount && profile.data) before.current = profile.data
  const [dirty, setDirty] = useState(false)
  const [prompt, setPrompt] = useState<ReviewPrompt | null>(null)
  const leaving = useRef(false)
  const reviewChosen = useRef(false)

  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !leaving.current,
    enableBeforeUnload: () => dirty && !leaving.current,
    withResolver: true,
  })

  const done = (to: '/me' | '/me/preferences') => {
    leaving.current = true
    void navigate({ to })
  }

  const onSaved = (saved: OwnProfile) => {
    toast.success(t('common:toast.saved'))
    const previous = before.current
    leaving.current = true
    if (
      section === 'community' &&
      previous &&
      previous.community.religion_code !== saved.community.religion_code
    ) {
      setPrompt('religion')
      return
    }
    if (
      section === 'location' &&
      previous &&
      previous.location.country_code !== saved.location.country_code
    ) {
      setPrompt('country')
      return
    }
    done('/me')
  }

  return (
    <div className="container-app flex max-w-xl flex-col gap-4">
      <PageHeader title={t(`edit.title.${section}`)} showBack />
      <SectionForm
        section={section}
        mode="edit"
        onSaved={onSaved}
        onDirtyChange={setDirty}
        footer={
          <Button type="button" variant="secondary" onClick={() => void navigate({ to: '/me' })}>
            {t('contacts.cancel')}
          </Button>
        }
      />

      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset()
        }}
        title={t('discard.title')}
        description={t('discard.body')}
        confirmLabel={t('discard.discard')}
        cancelLabel={t('discard.keep')}
        destructive
        onConfirm={() => {
          if (blocker.status === 'blocked') blocker.proceed()
        }}
      />

      <ConfirmDialog
        open={prompt !== null}
        onOpenChange={(open) => {
          if (open) return
          setPrompt(null)
          if (!reviewChosen.current) done('/me')
        }}
        title={prompt === 'country' ? t('edit.review_country') : t('edit.review_religion')}
        description={null}
        confirmLabel={t('edit.review')}
        cancelLabel={t('edit.later')}
        onConfirm={() => {
          reviewChosen.current = true
          done('/me/preferences')
        }}
      />
    </div>
  )
}

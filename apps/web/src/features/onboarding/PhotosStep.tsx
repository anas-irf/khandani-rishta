// ONB-08 (07 section 10): photos, the photo privacy choice, Continue and "Add photos later".
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '~/components/common/ErrorState'
import { FormSkeleton } from '~/components/common/FormSkeleton'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { usePrivacy } from '~/features/me/queries'
import { PhotoManager } from '~/features/photos/PhotoManager'
import { useOwnPhotos } from '~/features/photos/queries'
import { FormShell, useFormControls, useManagedForm } from '~/features/profile-sections/form-shell'
import { sectionSchema } from '~/features/profile-sections/schemas'
import type { OwnPhoto, Privacy } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'
import { track } from '~/lib/track'
import { trackStepSkipped } from './funnel'
import { useSetPhotoVisibility } from './queries'
import { StepFooter } from './StepFooter'
import { useStepFlow } from './useStepFlow'

const VISIBILITY: Privacy['photo_visibility'][] = [
  'members',
  'interests_and_connections',
  'connections',
  'approved_only',
]

type PhotoValues = { photo_visibility: Privacy['photo_visibility'] }

const photoSchema = sectionSchema<PhotoValues>(() => [])

/** Photos that count for `photo_required`: every one that is not `rejected` or `failed`. */
export function usablePhotos(photos: readonly OwnPhoto[] | undefined): OwnPhoto[] {
  return (photos ?? []).filter((photo) => photo.status !== 'rejected' && photo.status !== 'failed')
}

export function PhotosStep({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const privacy = usePrivacy()
  if (privacy.isError) {
    return (
      <ErrorState
        error={privacy.error}
        onRetry={() => void privacy.refetch()}
        retrying={privacy.isFetching}
      />
    )
  }
  if (privacy.isPending) return <FormSkeleton fields={3} />
  return <PhotosForm initial={privacy.data.photo_visibility} onDirtyChange={onDirtyChange} />
}

function PhotosForm({
  initial,
  onDirtyChange,
}: {
  initial: Privacy['photo_visibility']
  onDirtyChange: (dirty: boolean) => void
}) {
  const { t } = useTranslation('onboarding')
  const me = useCurrentMe()
  const flow = useStepFlow()
  const photos = useOwnPhotos()
  const setVisibility = useSetPhotoVisibility()
  const [defaultValues] = useState<PhotoValues>(() => ({ photo_visibility: initial }))
  const usable = usablePhotos(photos.data)

  const managed = useManagedForm({
    namespace: 'onboarding',
    mode: 'onboarding',
    step: 'photos',
    defaultValues,
    schema: photoSchema,
    onDirtyChange,
    rewrite: (error) =>
      error.field === 'photos' ? { ...error, message: t('photos.required') } : error,
    submit: async (values) => {
      const count = usablePhotos(photos.data).length
      // 07 section 10.2: a photo is needed first when the setting requires one.
      if (me.config.photo_required && count === 0) {
        managed.showFieldErrors([
          { field: 'photos', code: 'required', message: t('photos.required') },
        ])
        return
      }
      // Always sent, even when unchanged, so the choice is explicit.
      await setVisibility.mutateAsync(values.photo_visibility)
      track('onboarding_photo_privacy_chosen', {
        photo_visibility: values.photo_visibility,
        photo_count: count,
      })
      const wasCurrent = flow.isCurrent()
      await flow.advance()
      if (count === 0 && wasCurrent && !flow.edit) trackStepSkipped('photos')
    },
  })
  const { form } = managed

  const options = VISIBILITY.map((code) => ({
    code,
    label: t(`photos.visibility.${code}`),
    description: t(`photos.visibility.${code}_help`),
  }))
  const showAddLater = !me.config.photo_required && photos.isSuccess && photos.data.length === 0

  return (
    <div className="flex flex-col gap-8">
      <PhotoManager context="onboarding" />
      <FormShell
        form={form}
        controls={managed.controls}
        unmatched={managed.unmatched}
        failure={managed.failure}
        submitLabel={flow.edit ? t('actions.save') : t('actions.continue')}
        failureText={t('failed')}
        footer={<StepFooter extra={showAddLater && !flow.edit ? <AddLater /> : null} />}
      >
        <form.AppField name="photo_visibility">
          {(field) => (
            <field.RadioCardsField
              label={t('photos.visibility_label')}
              options={options}
              required
            />
          )}
        </form.AppField>
        <p className="text-caption text-muted-foreground">{t('photos.visibility_note')}</p>
        {usable.length === 0 && me.config.photo_required ? (
          <p className="text-caption text-muted-foreground">{t('photos.required')}</p>
        ) : null}
      </FormShell>
    </div>
  )
}

/** "Add photos later" with "Continue without a photo?" (07 section 10.2). */
function AddLater() {
  const { t } = useTranslation('onboarding')
  const controls = useFormControls()
  const online = useOnlineStatus()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        fill="phone"
        disabled={controls.isSubmitting || !online}
        onClick={() => setOpen(true)}
      >
        {t('photos.add_later')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('photos.skip_dialog.title')}</DialogTitle>
            <DialogDescription className="text-foreground">
              {t('photos.skip_dialog.body')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('photos.skip_dialog.add')}
            </Button>
            <Button
              type="button"
              disabled={!online}
              onClick={() => {
                setOpen(false)
                // "Continue without" performs the same two calls as "Continue".
                void controls.submit()
              }}
            >
              {t('photos.skip_dialog.continue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

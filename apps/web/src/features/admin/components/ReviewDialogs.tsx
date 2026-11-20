import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '~/components/ui/input'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { isOneOf, PHOTO_REJECTION_REASONS } from '~/lib/api-enums'
import { useOptions } from '~/lib/reference'
import { validate } from '../forms'
import { sha256Hex } from '../hash'
import {
  useCorrectLockedFields,
  useRejectPhoto,
  useRejectText,
  useRequestProfileChanges,
} from '../queries'
import { lockedFieldsSchema, requestChangesSchema, textRejectSchema } from '../schemas'
import type { AdminProfile, AdminTextField } from '../types'
import { ActionDialog } from './ActionDialog'
import { CountedTextarea, FormField, PresetButtons } from './FormField'
import { ErrorSummary, useDialogErrors } from './useDialogErrors'

/** "Request changes" on a profile under review (18 section 4.1). */
export function RequestChangesDialog({
  profileId,
  onDone,
  onClose,
}: {
  profileId: string
  onDone: () => void
  onClose: () => void
}) {
  const { t } = useTranslation('admin')
  const mutation = useRequestProfileChanges()
  const [reason, setReason] = useState('')
  const form = useDialogErrors(['reason'])
  const presets = t('profile.change_presets', { returnObjects: true }) as string[]

  const submit = async () => {
    const result = validate(requestChangesSchema, { reason }, t)
    if (!result.ok) {
      form.setErrors(result.errors)
      throw new Error('invalid')
    }
    try {
      await mutation.mutateAsync({ profileId, reason: result.data.reason })
    } catch (error) {
      form.fail(error)
      throw error
    }
    onDone()
  }

  return (
    <ActionDialog
      title={t('profile.request_changes.title')}
      description={t('profile.request_changes.description')}
      submitLabel={t('profile.request_changes.submit')}
      onSubmit={submit}
      onClose={onClose}
      error={<ErrorSummary messages={form.rest} />}
    >
      <PresetButtons
        label={t('profile.request_changes.presets')}
        presets={presets}
        onPick={setReason}
      />
      <CountedTextarea
        label={t('profile.request_changes.reason')}
        error={form.errors.reason}
        value={reason}
        onChange={setReason}
        max={500}
        name="reason"
      />
    </ActionDialog>
  )
}

/** Rejects one photo with a reason from the list (a photo under review, or a reported one). */
export function RejectPhotoDialog({
  photoId,
  onDone,
  onClose,
}: {
  photoId: string
  onDone?: () => void
  onClose: () => void
}) {
  const { t } = useTranslation('admin')
  const reasons = useOptions('photo_rejection_reason')
  const mutation = useRejectPhoto()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()

  const submit = async () => {
    if (!isOneOf(PHOTO_REJECTION_REASONS, reason)) {
      setError(t('validation.required'))
      throw new Error('invalid')
    }
    await mutation.mutateAsync({ photoId, reason })
    onDone?.()
  }

  return (
    <ActionDialog
      title={t('photo.reject_title')}
      description={t('photo.reject_description')}
      submitLabel={t('photo.reject')}
      destructive
      onSubmit={submit}
      onClose={onClose}
    >
      <FormField label={t('photo.reason')} error={error}>
        {(props) => (
          <NativeSelect
            {...props}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value)
              setError(undefined)
            }}
          >
            <NativeSelectOption value="">{t('form.choose')}</NativeSelectOption>
            {reasons.map((option) => (
              <NativeSelectOption key={option.code} value={option.code}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
    </ActionDialog>
  )
}

/**
 * Rejects a free text with an optional note the member will see (18 section 4.3). The decision
 * carries the SHA-256 of the text as it is shown here.
 */
export function RejectTextDialog({
  profileId,
  field,
  text,
  onDone,
  onClose,
}: {
  profileId: string
  field: AdminTextField
  text: string
  onDone?: () => void
  onClose: () => void
}) {
  const { t } = useTranslation('admin')
  const mutation = useRejectText()
  const [note, setNote] = useState('')
  const form = useDialogErrors(['note'])
  const presets = t('texts.note_presets', { returnObjects: true }) as string[]

  const submit = async () => {
    const result = validate(textRejectSchema, { note }, t)
    if (!result.ok) {
      form.setErrors(result.errors)
      throw new Error('invalid')
    }
    try {
      await mutation.mutateAsync({
        profileId,
        field,
        text_sha256: await sha256Hex(text),
        note: result.data.note || undefined,
      })
    } catch (error) {
      form.fail(error)
      throw error
    }
    onDone?.()
  }

  return (
    <ActionDialog
      title={t('texts.reject_title', { field: t(`texts.field.${field}`) })}
      description={t('texts.reject_description')}
      submitLabel={t('texts.reject')}
      destructive
      onSubmit={submit}
      onClose={onClose}
      error={<ErrorSummary messages={form.rest} />}
    >
      <PresetButtons label={t('texts.presets')} presets={presets} onPick={setNote} />
      <CountedTextarea
        label={t('texts.note_label')}
        hint={t('texts.note_hint')}
        error={form.errors.note}
        value={note}
        onChange={setNote}
        max={300}
        rows={3}
        name="note"
      />
    </ActionDialog>
  )
}

/** Corrects name, gender or date of birth on the owner's behalf (admin, 18 section 5.4). */
export function LockedFieldsDialog({
  profile,
  onClose,
}: {
  profile: AdminProfile
  onClose: () => void
}) {
  const { t } = useTranslation('admin')
  const mutation = useCorrectLockedFields()
  const basics = profile.profile.basics
  const [values, setValues] = useState({
    first_name: basics.first_name ?? '',
    last_name: basics.last_name ?? '',
    gender: basics.gender ?? '',
    date_of_birth: basics.date_of_birth ?? '',
    reason: '',
  })
  const form = useDialogErrors(['first_name', 'last_name', 'gender', 'date_of_birth', 'reason'])
  const set = (key: keyof typeof values, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }))

  const submit = async () => {
    const result = validate(lockedFieldsSchema, values, t)
    if (!result.ok) {
      form.setErrors(result.errors)
      throw new Error('invalid')
    }
    const data = result.data
    const changes: Record<string, string> = {}
    if (data.first_name && data.first_name !== (basics.first_name ?? '')) {
      changes.first_name = data.first_name
    }
    if (data.last_name && data.last_name !== (basics.last_name ?? '')) {
      changes.last_name = data.last_name
    }
    if (data.gender && data.gender !== basics.gender) changes.gender = data.gender
    if (data.date_of_birth && data.date_of_birth !== basics.date_of_birth) {
      changes.date_of_birth = data.date_of_birth
    }
    if (Object.keys(changes).length === 0) {
      form.setErrors({ reason: t('profile.locked.nothing_changed') })
      throw new Error('invalid')
    }
    try {
      await mutation.mutateAsync({
        profileId: profile.profile.id,
        ...changes,
        reason: data.reason,
      })
    } catch (error) {
      form.fail(error)
      throw error
    }
  }

  return (
    <ActionDialog
      title={t('profile.locked.title')}
      description={t('profile.locked.description')}
      submitLabel={t('profile.locked.submit')}
      onSubmit={submit}
      onClose={onClose}
      error={<ErrorSummary messages={form.rest} />}
    >
      {profile.profile.verification.id_verified ? (
        <p className="rounded-md bg-warning-soft p-2 text-sm">{t('profile.locked.id_reminder')}</p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('profile.field.first_name')} error={form.errors.first_name}>
          {(props) => (
            <Input
              {...props}
              name="first_name"
              value={values.first_name}
              onChange={(event) => set('first_name', event.target.value)}
            />
          )}
        </FormField>
        <FormField label={t('profile.field.last_name')} error={form.errors.last_name}>
          {(props) => (
            <Input
              {...props}
              name="last_name"
              value={values.last_name}
              onChange={(event) => set('last_name', event.target.value)}
            />
          )}
        </FormField>
        <FormField label={t('profile.field.gender')} error={form.errors.gender}>
          {(props) => (
            <NativeSelect
              {...props}
              name="gender"
              value={values.gender}
              onChange={(event) => set('gender', event.target.value)}
            >
              <NativeSelectOption value="male">{t('profile.gender.male')}</NativeSelectOption>
              <NativeSelectOption value="female">{t('profile.gender.female')}</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t('profile.field.date_of_birth')} error={form.errors.date_of_birth}>
          {(props) => (
            <Input
              {...props}
              name="date_of_birth"
              type="date"
              value={values.date_of_birth}
              onChange={(event) => set('date_of_birth', event.target.value)}
            />
          )}
        </FormField>
      </div>
      <CountedTextarea
        label={t('profile.locked.reason')}
        hint={t('profile.locked.reason_hint')}
        error={form.errors.reason}
        value={values.reason}
        onChange={(value) => set('reason', value)}
        max={500}
        rows={3}
        name="reason"
      />
    </ActionDialog>
  )
}

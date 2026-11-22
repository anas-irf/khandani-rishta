// SET-CONTACTS (16 section 6.28, 08 section 3)
import { useStore } from '@tanstack/react-form'
import { useBlocker, useNavigate, useSearch } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { ErrorState } from '~/components/common/ErrorState'
import { FormSkeleton } from '~/components/common/FormSkeleton'
import { DiamondTitle } from '~/components/common/Ornament'
import { Page } from '~/components/common/Page'
import { useGoBack } from '~/components/common/PageHeader'
import { StatusBanner } from '~/components/common/StatusBanner'
import { Button } from '~/components/ui/button'
import { useOwnProfile } from '~/features/profile-sections/queries'
import { type ClientFieldError, isApiError } from '~/lib/api'
import type { OwnProfile } from '~/lib/api-types'
import { focusFirstInvalid, useAppForm } from '~/lib/form'
import { applyServerErrors, focusField } from '~/lib/form-context'
import { formatPhone } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import {
  CONTACTS_NS,
  type ContactsValues,
  contactsFromProfile,
  contactsSchema,
  contactsToBody,
  FOCUSABLE_CONTACT_FIELDS,
  GUARDIAN_FIELDS,
  guardianGroupOpen,
} from './contacts'
import { useHasActiveContactShare, useSaveContacts } from './queries'

/**
 * The phone numbers, email and guardian contact the member may later share with a connection.
 * Search params (17 section 3.3): `focus` names the field to focus on open, and
 * `return_connection_id` sends the member back to that connection after saving (08 3.5).
 */
export function ContactsScreen() {
  const { t } = useTranslation('me')
  const profile = useOwnProfile()

  return (
    <Page title={t('contacts.title')} showBack width="form">
      {profile.isPending ? (
        <div role="status" aria-label={t('contacts.loading')}>
          <FormSkeleton fields={5} />
        </div>
      ) : profile.isError ? (
        <ErrorState
          error={profile.error}
          onRetry={() => void profile.refetch()}
          retrying={profile.isFetching}
        />
      ) : (
        <ContactsForm profile={profile.data} />
      )}
    </Page>
  )
}

function readSearch(search: Record<string, unknown>) {
  const focus = typeof search.focus === 'string' ? search.focus : undefined
  const returnId =
    typeof search.return_connection_id === 'string' && search.return_connection_id !== ''
      ? search.return_connection_id
      : undefined
  return {
    focus: (FOCUSABLE_CONTACT_FIELDS as readonly string[]).includes(focus ?? '')
      ? focus
      : undefined,
    returnConnectionId: returnId,
  }
}

function ContactsForm({ profile }: { profile: OwnProfile }) {
  const { t } = useTranslation(['me', 'common'])
  const me = useCurrentMe()
  const navigate = useNavigate()
  const goBack = useGoBack('/settings')
  const search = readSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const save = useSaveContacts()
  const sharing = useHasActiveContactShare()
  const initial = useMemo(() => contactsFromProfile(profile.contacts), [profile.contacts])
  const [guardianOpen, setGuardianOpen] = useState(
    () => guardianGroupOpen(initial) || search.focus === 'guardian_name',
  )
  const [serverErrors, setServerErrors] = useState<ClientFieldError[]>([])
  const [failed, setFailed] = useState(false)
  const saved = useRef(false)
  const managing =
    profile.account_for.managed_by !== null && profile.account_for.managed_by !== 'self'

  const form = useAppForm({
    defaultValues: initial,
    validators: { onSubmit: contactsSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setFailed(false)
      setServerErrors([])
      try {
        await save.mutateAsync(contactsToBody(value))
      } catch (error) {
        if (isApiError(error) && error.code === 'validation_failed') {
          setServerErrors(applyServerErrors(form, error, { namespace: CONTACTS_NS }))
        } else if (
          !isApiError(error) ||
          ['network_error', 'internal_error', 'service_unavailable'].includes(error.code)
        ) {
          setFailed(true)
        }
        return
      }
      saved.current = true
      toast.success(t('contacts.saved'))
      if (search.returnConnectionId) {
        void navigate({
          to: '/chats/$connectionId/details',
          params: { connectionId: search.returnConnectionId },
        })
      } else {
        goBack()
      }
    },
  })

  const dirty = useStore(form.store, (state) => state.isDirty)
  const values = useStore(form.store, (state) => state.values as ContactsValues)
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !saved.current,
    enableBeforeUnload: () => dirty && !saved.current,
    withResolver: true,
  })

  // 08 section 3.5: focus the field named by `focus` once the form is shown.
  useEffect(() => {
    if (search.focus) focusField(search.focus)
  }, [search.focus])

  const preferGuardian = values.preferred_contact === 'guardian'
  const showGuardian = guardianOpen || preferGuardian
  const suggestPhone =
    me.user.phone_verified && me.user.phone_e164 && !values.phone_e164 ? me.user.phone_e164 : null

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <p className="text-foreground-secondary">{t('contacts.intro')}</p>
      <form.AppForm>
        <form.FormErrorSummary serverErrors={serverErrors} />
      </form.AppForm>

      <div className="flex flex-col gap-2">
        <form.AppField name="phone_e164">
          {(field) => <field.PhoneField label={t('contacts.phone')} />}
        </form.AppField>
        {suggestPhone ? (
          <Button
            type="button"
            variant="link"
            className="self-start"
            onClick={() => form.setFieldValue('phone_e164', suggestPhone)}
          >
            {t('contacts.use_verified_phone', { phone: formatPhone(suggestPhone) })}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <form.AppField name="whatsapp_same">
          {(field) => <field.CheckboxField label={t('contacts.whatsapp_same')} />}
        </form.AppField>
        {values.whatsapp_same ? null : (
          <form.AppField name="whatsapp_e164">
            {(field) => <field.PhoneField label={t('contacts.whatsapp')} />}
          </form.AppField>
        )}
      </div>

      <form.AppField name="contact_email">
        {(field) => (
          <field.TextField
            label={t('contacts.email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
          />
        )}
      </form.AppField>

      <form.AppField
        name="preferred_contact"
        listeners={{
          onChange: ({ value }) => {
            if (value === 'guardian') setGuardianOpen(true)
          },
        }}
      >
        {(field) => (
          <field.RadioCardsField
            label={t('contacts.preferred')}
            required
            options={[
              { code: 'self', label: t('contacts.preferred_self') },
              { code: 'guardian', label: t('contacts.preferred_guardian') },
            ]}
          />
        )}
      </form.AppField>

      {showGuardian ? (
        <fieldset className="flex flex-col gap-5 pt-2">
          <legend className="mb-5 max-w-full text-title-md font-bold">
            <DiamondTitle>{t('contacts.guardian_group')}</DiamondTitle>
          </legend>
          {managing ? (
            <p className="text-caption text-muted-foreground">{t('contacts.managing_hint')}</p>
          ) : null}
          <form.AppField name="guardian_name">
            {(field) => (
              <field.TextField
                label={t('contacts.guardian_name')}
                required={preferGuardian}
                autoComplete="name"
                maxLength={80}
              />
            )}
          </form.AppField>
          <form.AppField name="guardian_relation">
            {(field) => (
              <field.SelectField
                label={t('contacts.guardian_relation')}
                list="guardian_relation"
                required={preferGuardian}
              />
            )}
          </form.AppField>
          <form.AppField name="guardian_phone_e164">
            {(field) => (
              <field.PhoneField label={t('contacts.guardian_phone')} required={preferGuardian} />
            )}
          </form.AppField>
        </fieldset>
      ) : (
        <Button
          type="button"
          variant="link"
          className="self-start"
          onClick={() => {
            setGuardianOpen(true)
            focusField(GUARDIAN_FIELDS[0])
          }}
        >
          <Plus aria-hidden="true" />
          {t('contacts.guardian_add')}
        </Button>
      )}

      <form.AppField name="best_time_to_call">
        {(field) => (
          <field.TextField
            label={t('contacts.best_time')}
            placeholder={t('contacts.best_time_placeholder')}
            maxLength={80}
          />
        )}
      </form.AppField>

      {sharing && dirty ? (
        <StatusBanner variant="warning">{t('contacts.shared_warning')}</StatusBanner>
      ) : null}

      {failed ? (
        <StatusBanner
          variant="danger"
          action={
            <Button type="button" variant="secondary" onClick={() => void form.handleSubmit()}>
              {t('contacts.retry')}
            </Button>
          }
        >
          {t('contacts.failed')}
        </StatusBanner>
      ) : null}

      <div className="flex flex-col gap-3">
        <form.AppForm>
          <form.SubmitButton label={t('contacts.save')} size="lg" fill="phone" />
        </form.AppForm>
        <Button type="button" variant="quiet" fill="phone" onClick={goBack}>
          {t('contacts.cancel')}
        </Button>
      </div>

      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset()
        }}
        title={t('discard.title')}
        description={t('discard.body')}
        confirmLabel={t('discard.discard')}
        cancelLabel={t('discard.keep')}
        tone="danger"
        onConfirm={() => {
          if (blocker.status === 'blocked') blocker.proceed()
        }}
      />
    </form>
  )
}

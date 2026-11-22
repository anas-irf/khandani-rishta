// The identity number form of ONB-10 (07 section 13) and ME-VERIFY-ID step 1 (16 section 6.23).
import { useStore } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { CircleAlert, ShieldCheck } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ErrorState } from '~/components/common/ErrorState'
import { FormSkeleton } from '~/components/common/FormSkeleton'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { inlineLinkClass, TextLink } from '~/components/common/TextLink'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  FormControlsProvider,
  FormShell,
  InlineFailure,
  useManagedForm,
} from '~/features/profile-sections/form-shell'
import { useOwnProfile } from '~/features/profile-sections/queries'
import { subjectOf, wordingContext } from '~/features/profile-sections/wording'
import { type ClientFieldError, isApiError } from '~/lib/api'
import type { IdentitySummary, OwnProfile } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'
import { useLabelOf } from '~/lib/reference'
import { useIdentity, useSaveIdentity } from './queries'
import {
  defaultDocumentType,
  IDENTITY_NS,
  type IdentityValues,
  identitySchema,
  numberComplete,
} from './schemas'

export type IdentityNumberFormProps = {
  /** `onboarding` on ONB-10; `me` on ME-VERIFY-ID (always shows the empty fields). */
  mode: 'onboarding' | 'me'
  /** Default "Continue". */
  submitLabel?: string
  /**
   * Called after `PUT /v1/me/identity` succeeded. On ONB-10, "Continue" on the read-only view of
   * a saved number (07 section 13.5) calls it with the saved summary without saving again.
   */
  onSaved?: (summary: IdentitySummary) => void | Promise<void>
  /** Rendered under the button (onboarding's Skip and Back). */
  footer?: ReactNode
  initialErrors?: ClientFieldError[]
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * Document type and number with the consent text of 12 section 2.2 and the input mask of
 * 12 section 3.7. Handles `identity_already_registered` (dialog), `invalid_state` (message,
 * or back to the basics step when the gender is missing) and the field errors of 12 3.3.
 */
export function IdentityNumberForm(props: IdentityNumberFormProps) {
  const identity = useIdentity()
  const profile = useOwnProfile()
  const query = identity.isError ? identity : profile
  if (identity.isError || profile.isError) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => {
          void identity.refetch()
          void profile.refetch()
        }}
        retrying={identity.isFetching || profile.isFetching}
      />
    )
  }
  if (identity.isPending || profile.isPending) return <FormSkeleton fields={2} />
  return <IdentityForm {...props} summary={identity.data} profile={profile.data} />
}

function IdentityForm({
  mode,
  submitLabel,
  onSaved,
  footer,
  initialErrors,
  onDirtyChange,
  summary,
  profile,
}: IdentityNumberFormProps & { summary: IdentitySummary | null; profile: OwnProfile }) {
  const { t } = useTranslation(IDENTITY_NS)
  const [changing, setChanging] = useState(mode === 'me' || summary == null)
  const label = submitLabel ?? t('common:actions.continue')

  if (!changing && summary) {
    return (
      <SavedIdentity
        summary={summary}
        label={label}
        footer={footer}
        onChange={() => setChanging(true)}
        onContinue={() => onSaved?.(summary)}
      />
    )
  }
  return (
    <NumberForm
      mode={mode}
      label={label}
      onSaved={onSaved}
      footer={footer}
      initialErrors={initialErrors}
      onDirtyChange={onDirtyChange}
      summary={summary}
      profile={profile}
    />
  )
}

/** 07 section 13.5: the saved number, read-only, with "Change". */
function SavedIdentity({
  summary,
  label,
  footer,
  onChange,
  onContinue,
}: {
  summary: IdentitySummary
  label: string
  footer?: ReactNode
  onChange: () => void
  onContinue: () => unknown
}) {
  const { t } = useTranslation(IDENTITY_NS)
  const labelOf = useLabelOf()
  const online = useOnlineStatus()
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)

  const run = async () => {
    if (running) return
    setRunning(true)
    setFailure(null)
    try {
      await onContinue()
    } catch (error) {
      setFailure(error)
    } finally {
      setRunning(false)
    }
  }

  return (
    <FormControlsProvider
      value={{ mode: 'onboarding', isDirty: false, isSubmitting: running, submit: run }}
    >
      <div className="flex flex-col gap-6">
        <div className="field-stack">
          <span className="text-label-lg">{t('saved_label')}</span>
          <div className="tonal flex min-h-touch-lg flex-wrap items-center justify-between gap-x-4 rounded-input px-4 py-1">
            <span dir="ltr" className="max-w-full py-1 tabular-nums">
              {t('saved_value', {
                document: labelOf('document_type', summary.document_type),
                number: summary.number_masked,
              })}
            </span>
            <Button type="button" variant="link" onClick={onChange}>
              {t('change')}
            </Button>
          </div>
        </div>
        {failure ? (
          <InlineFailure
            error={failure}
            text={t('failed_onboarding')}
            onRetry={() => void run()}
            retrying={running}
          />
        ) : null}
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            loading={running}
            disabled={!online}
            size="lg"
            fill="phone"
            onClick={() => void run()}
          >
            {label}
          </Button>
          {footer}
        </div>
      </div>
    </FormControlsProvider>
  )
}

function NumberForm({
  mode,
  label,
  onSaved,
  footer,
  initialErrors,
  onDirtyChange,
  summary,
  profile,
}: Omit<IdentityNumberFormProps, 'submitLabel'> & {
  label: string
  summary: IdentitySummary | null
  profile: OwnProfile
}) {
  const { t } = useTranslation(IDENTITY_NS)
  const me = useCurrentMe()
  const navigate = useNavigate()
  const save = useSaveIdentity()
  const [registered, setRegistered] = useState(false)
  const [stateError, setStateError] = useState(false)
  const [mismatch, setMismatch] = useState(false)
  const subject = subjectOf(profile.account_for.managed_by, profile.basics.gender)
  const draft = profile.status === 'draft'

  const [defaultValues] = useState<IdentityValues>(() => ({
    document_type:
      summary?.document_type ??
      defaultDocumentType(profile.location.nationality_code, profile.location.country_code),
    number: null,
  }))

  const managed = useManagedForm({
    namespace: IDENTITY_NS,
    mode: mode === 'onboarding' ? 'onboarding' : 'edit',
    step: 'identity',
    defaultValues,
    schema: identitySchema,
    initialErrors,
    onDirtyChange,
    // One code covers several rules, so the API's own message is shown (07 section 13.4).
    rewrite: (error) =>
      error.field === 'number' && error.code === 'invalid'
        ? { ...error, code: 'api_message' }
        : error,
    submit: async (values) => {
      setStateError(false)
      setMismatch(false)
      try {
        const saved = await save.mutateAsync({
          document_type: values.document_type,
          number: values.number ?? '',
        })
        await onSaved?.(saved)
      } catch (error) {
        if (isApiError(error) && error.code === 'identity_already_registered') {
          setRegistered(true)
          return
        }
        if (isApiError(error) && error.code === 'invalid_state') {
          // No gender yet during onboarding: the number is checked against it (07 13.6).
          if (draft && !profile.basics.gender) {
            await navigate({ to: '/onboarding/$step', params: { step: 'basics' } })
            return
          }
          setStateError(true)
          return
        }
        if (
          isApiError(error) &&
          error.fields.some((field) => field.field === 'number' && field.code === 'mismatch')
        ) {
          setMismatch(true)
        }
        throw error
      }
    },
  })
  const { form } = managed
  const complete = useStore(form.store, (state) => numberCompleteSelector(state.values))

  const numberLabel = (type: string) =>
    t(`number_label.${type}`, { context: wordingContext(subject) })

  return (
    <>
      <FormShell
        form={form}
        controls={managed.controls}
        unmatched={managed.unmatched}
        failure={managed.failure}
        submitLabel={label}
        footer={footer}
        failureText={t(mode === 'onboarding' ? 'failed_onboarding' : 'failed')}
        submitDisabled={!complete}
      >
        {stateError ? (
          <Alert variant="danger">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{t('invalid_state')}</AlertDescription>
          </Alert>
        ) : null}
        <form.AppField
          name="document_type"
          listeners={{ onChange: () => form.setFieldValue('number', null) }}
        >
          {(field) => (
            <field.SelectField
              label={t('document_label')}
              list="document_type"
              variant="native"
              required
            />
          )}
        </form.AppField>

        <section aria-labelledby="identity-consent-title" className="tonal panel gap-3">
          <h3
            id="identity-consent-title"
            className="flex items-start gap-3 text-title-md font-bold"
          >
            <span aria-hidden="true" className="flex h-[1lh] items-center">
              <ShieldCheck className="size-5 text-primary" />
            </span>
            <span className="min-w-0">{t('consent.title')}</span>
          </h3>
          <p>{t('consent.body')}</p>
          <ul className="bullet-list">
            <li>{t('consent.point_hidden')}</li>
            <li>{t('consent.point_encrypted')}</li>
            <li>{t('consent.point_not_shared')}</li>
            <li>{t('consent.point_deleted')}</li>
          </ul>
        </section>

        {mode === 'onboarding' && subject !== 'self' ? (
          <p className="font-semibold">
            {profile.basics.first_name
              ? t('managed_note', { name: profile.basics.first_name })
              : t('managed_note_unnamed')}
          </p>
        ) : null}

        <form.Subscribe selector={(state) => state.values.document_type}>
          {(documentType) => (
            <form.AppField name="number">
              {(field) => (
                <field.IdentityNumberField
                  label={numberLabel(documentType)}
                  documentType={documentType}
                  required
                />
              )}
            </form.AppField>
          )}
        </form.Subscribe>
        {mismatch && draft ? (
          <TextLink to="/onboarding/$step" params={{ step: 'basics' }} className="-mt-4 self-start">
            {t('go_basics')}
          </TextLink>
        ) : null}
      </FormShell>

      <Dialog open={registered} onOpenChange={setRegistered}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('registered.title')}</DialogTitle>
            <DialogDescription className="text-foreground">
              {t('registered.body')}
            </DialogDescription>
          </DialogHeader>
          <p>
            <Trans
              t={t}
              i18nKey="registered.support"
              values={{ email: me.config.support_email }}
              components={{
                mail: (
                  // biome-ignore lint/a11y/useAnchorContent: Trans puts the address inside.
                  <a href={`mailto:${me.config.support_email}`} className={inlineLinkClass} />
                ),
              }}
            />
          </p>
          <DialogFooter>
            <Button type="button" onClick={() => setRegistered(false)}>
              {t('registered.ok')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** "Continue" is enabled only at 13 digits for CNIC, NICOP and POC (12 section 3.7). */
function numberCompleteSelector(values: IdentityValues): boolean {
  return values.document_type === 'passport' ? true : numberComplete(values)
}

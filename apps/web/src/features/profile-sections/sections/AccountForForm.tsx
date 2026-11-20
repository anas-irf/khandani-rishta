// ONB-01 (07 section 3) and ME-EDIT `account_for` (08 section 2).
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ConsentLink } from '~/components/common/fields'
import type { ManagedBy } from '~/lib/api-types'
import { stepIndex } from '~/lib/gate'
import { FormShell, useLatest, useManagedForm } from '../form-shell'
import { useSaveSection } from '../queries'
import {
  type AccountForContext,
  accountForFromProfile,
  accountForSchema,
  accountForToBody,
  SECTION_NS,
  showsCandidateConsent,
} from '../schemas'
import type { SectionFormInnerProps } from './types'

const MANAGED_BY: ManagedBy[] = ['self', 'parent', 'sibling', 'relative', 'friend']

export function AccountForForm({
  profile,
  mode,
  submitLabel,
  onSaved,
  footer,
  initialErrors,
  onDirtyChange,
}: SectionFormInnerProps) {
  const { t } = useTranslation('profile_sections')
  const save = useSaveSection('account_for')
  const context = useLatest<AccountForContext>({
    mode,
    savedManagedBy: profile.account_for.managed_by,
  })
  const [schema] = useState(() => accountForSchema(() => context.current))
  // Consents of a step already continued were recorded (03 section 4.3): they start ticked.
  const [defaultValues] = useState(() =>
    accountForFromProfile(profile, {
      consentsRecorded: mode === 'onboarding' && stepIndex(profile.onboarding_step) > 0,
    }),
  )
  const managed = useManagedForm({
    namespace: SECTION_NS,
    mode,
    step: 'account_for',
    defaultValues,
    schema,
    aliases: { consents: 'consent_terms' },
    initialErrors,
    onDirtyChange,
    submit: async (values) => {
      const saved = await save.mutateAsync(accountForToBody(values, context.current))
      await onSaved?.(saved)
    },
  })
  const { form } = managed

  const choices = MANAGED_BY.map((code) => ({
    code,
    label: t(`account_for.choice.${code}`),
    description: t(`account_for.choice.${code}_help`),
  }))

  return (
    <FormShell
      form={form}
      controls={managed.controls}
      unmatched={managed.unmatched}
      failure={managed.failure}
      submitLabel={submitLabel}
      footer={footer}
      failureText={t(mode === 'onboarding' ? 'form.failed_onboarding' : 'form.failed')}
    >
      <form.AppField name="managed_by">
        {(field) => (
          <field.RadioCardsField
            label={t('account_for.managed_by_label')}
            options={choices}
            required
          />
        )}
      </form.AppField>

      <form.Subscribe selector={(state) => state.values}>
        {(values) => {
          const candidateConsent = showsCandidateConsent(values, context.current) ? (
            <form.AppField name="consent_candidate">
              {(field) => (
                <field.ConsentCheckbox required label={t('account_for.consent_candidate')} />
              )}
            </form.AppField>
          ) : null
          return (
            <>
              {values.managed_by && values.managed_by !== 'self' ? (
                <form.AppField name="manager_name">
                  {(field) => (
                    <field.TextField
                      label={t('account_for.manager_name_label')}
                      helpText={t('account_for.manager_name_help')}
                      autoComplete="name"
                      autoCapitalize="words"
                      maxLength={80}
                      required
                    />
                  )}
                </form.AppField>
              ) : null}

              {mode === 'onboarding' ? (
                <div className="flex flex-col gap-1">
                  <form.AppField name="consent_terms">
                    {(field) => (
                      <field.ConsentCheckbox
                        required
                        label={
                          <Trans
                            t={t}
                            i18nKey="account_for.consent_terms"
                            components={{
                              terms: <ConsentLink href="/terms" />,
                              privacy: <ConsentLink href="/privacy" />,
                              guidelines: <ConsentLink href="/community-guidelines" />,
                            }}
                          />
                        }
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="consent_age">
                    {(field) => (
                      <field.ConsentCheckbox
                        required
                        label={
                          values.managed_by === 'self' || values.managed_by == null
                            ? t('account_for.consent_age_self')
                            : t('account_for.consent_age_other')
                        }
                      />
                    )}
                  </form.AppField>
                  {candidateConsent}
                </div>
              ) : (
                candidateConsent
              )}
            </>
          )
        }}
      </form.Subscribe>

      {mode === 'onboarding' ? (
        <p className="text-sm text-muted-foreground">{t('account_for.marriage_only')}</p>
      ) : null}
    </FormShell>
  )
}

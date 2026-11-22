// SET-ACCOUNT (16 section 6.27, 06 sections 9, 10.1 and 12, 08 section 7)
import { Check } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Page } from '~/components/common/Page'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { useAuthSession } from '~/features/auth/session'
import type { Locale } from '~/lib/api-types'
import { formatPhone } from '~/lib/format'
import { SUPPORTED_LANGUAGES } from '~/lib/i18n'
import { useCurrentMe } from '~/lib/me'
import { type AccountDialog, AccountDialogs, canClose, canPause } from './AccountDialogs'
import { SettingSelect, SettingsGroup } from './controls'
import { DataExportCard } from './DataExportCard'
import { ProfileStatusCard } from './ProfileStatusCard'
import { useChangeLocale } from './queries'
import { SignOutButton } from './SignOutButton'
import { toastSaveFailure } from './save-errors'

export function AccountScreen() {
  const { t } = useTranslation('settings')
  const me = useCurrentMe()
  const online = useOnlineStatus()
  const [dialog, setDialog] = useState<AccountDialog>(null)

  // The gentler options come first when the profile can still be paused or closed (06 section 9.1).
  const hasGentlerOptions = canPause(me.profile.status) || canClose(me.profile.status)

  return (
    <Page title={t('account.title')} backTo="/settings" width="column" layout="bands">
      <SignInSecurityCard />
      <LanguageCard />
      <ProfileStatusCard onOpen={setDialog} />
      <DataExportCard />
      <SettingsGroup title={t('account.delete.title')}>
        <div>
          <Button
            variant="destructive"
            disabled={!online}
            onClick={() => setDialog(hasGentlerOptions ? 'gentle' : 'delete')}
          >
            {t('account.delete.action')}
          </Button>
        </div>
      </SettingsGroup>
      <SettingsGroup title={t('account.sign_out.title')}>
        <div>
          <SignOutButton />
        </div>
      </SettingsGroup>
      <AccountDialogs dialog={dialog} onDialogChange={setDialog} />
    </Page>
  )
}

/**
 * "Sign-in and security": the email and phone of the account, and the row that opens Clerk's
 * account window (email, linked Google account, devices; 06 section 12). Without Clerk (mock
 * mode) the row is replaced by a note.
 */
function SignInSecurityCard() {
  const { t } = useTranslation('settings')
  const me = useCurrentMe()
  const session = useAuthSession()
  const { email, email_verified: verified, phone_e164: phone } = me.user

  return (
    <SettingsGroup title={t('account.sign_in.title')}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span dir="auto" className="max-w-full min-w-0">
          {email ? t('account.sign_in.email', { email }) : t('account.sign_in.email_none')}
        </span>
        {/* Words with the tick, never the tick alone (DESIGN.md 6.3). */}
        {email && verified ? (
          <Badge variant="success">
            <Check aria-hidden="true" strokeWidth={2.8} />
            {t('account.sign_in.email_verified')}
          </Badge>
        ) : null}
      </p>
      {phone ? <p>{t('account.sign_in.phone', { phone: formatPhone(phone) })}</p> : null}
      {session.openUserProfile ? (
        <div>
          <Button variant="secondary" onClick={() => session.openUserProfile?.()}>
            {t('account.sign_in.manage')}
          </Button>
        </div>
      ) : (
        <p className="text-caption text-muted-foreground">{t('account.sign_in.unavailable')}</p>
      )}
    </SettingsGroup>
  )
}

/**
 * "Language": English, and Urdu once `locales/ur` exists (until then it is disabled with the
 * caption "Coming soon"). A change calls `PATCH /v1/me` and reloads the strings.
 */
function LanguageCard() {
  const { t } = useTranslation('settings')
  const me = useCurrentMe()
  const change = useChangeLocale()
  const urduReady = SUPPORTED_LANGUAGES.includes('ur')

  return (
    <SettingsGroup title={t('account.language.title')}>
      <SettingSelect
        label={t('account.language.label')}
        value={me.user.locale}
        state={change.isPending ? 'saving' : 'idle'}
        caption={urduReady ? undefined : t('account.language.coming_soon')}
        options={[
          { value: 'en', label: t('account.language.english') },
          { value: 'ur', label: t('account.language.urdu'), disabled: !urduReady },
        ]}
        onChange={(value) => {
          if (value === me.user.locale) return
          change.mutate(value as Locale, {
            onError: (error) => toastSaveFailure(error, t('saving.failed')),
          })
        }}
      />
    </SettingsGroup>
  )
}

import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { StatusBanner } from '~/components/common/StatusBanner'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { useOwnProfile } from '~/features/profile-sections/queries'
import { isApiError } from '~/lib/api'
import type { ContactShare, ContactShareBody, ContactsSection, OwnProfile } from '~/lib/api-types'
import { formatPhone } from '~/lib/format'
import { useLabelOf } from '~/lib/reference'
import { useShareContact } from './queries'

export type ShareKey = keyof ContactShareBody

/** The four items of the share dialog, their labels and the field `SET-CONTACTS` focuses. */
export const SHARE_ITEMS: readonly { key: ShareKey; label: string; focus: string }[] = [
  { key: 'share_phone', label: 'phone', focus: 'phone_e164' },
  { key: 'share_whatsapp', label: 'whatsapp', focus: 'whatsapp_e164' },
  { key: 'share_email', label: 'email', focus: 'contact_email' },
  { key: 'share_guardian', label: 'guardian', focus: 'guardian_name' },
]

const EMPTY: ContactShareBody = {
  share_phone: false,
  share_whatsapp: false,
  share_email: false,
  share_guardian: false,
}

/** The member's current value for an item, as shown in the dialog; null when missing. */
export function useContactValue() {
  const label = useLabelOf()
  return (contacts: ContactsSection, key: ShareKey): string | null => {
    switch (key) {
      case 'share_phone':
        return contacts.phone_e164 ? formatPhone(contacts.phone_e164) : null
      case 'share_whatsapp':
        return contacts.whatsapp_e164 ? formatPhone(contacts.whatsapp_e164) : null
      case 'share_email':
        return contacts.contact_email ?? null
      case 'share_guardian': {
        // The guardian item needs the guardian's name and phone number (08 section 3.5).
        if (!contacts.guardian_name || !contacts.guardian_phone_e164) return null
        const relation = contacts.guardian_relation
          ? ` (${label('guardian_relation', contacts.guardian_relation)})`
          : ''
        return `${contacts.guardian_name}${relation}, ${formatPhone(contacts.guardian_phone_e164)}`
      }
    }
  }
}

/** Whether first contact should go through the guardian (09 section 10.2). */
export function guardianFirst(profile: OwnProfile): boolean {
  const managedBy = profile.account_for.managed_by
  return (
    (managedBy !== null && managedBy !== 'self') ||
    profile.contacts.preferred_contact === 'guardian'
  )
}

function defaultSelection(
  profile: OwnProfile,
  current: ContactShare | null,
  contactValue: (contacts: ContactsSection, key: ShareKey) => string | null,
): ContactShareBody {
  if (current?.status === 'active') {
    return {
      share_phone: current.share_phone,
      share_whatsapp: current.share_whatsapp,
      share_email: current.share_email,
      share_guardian: current.share_guardian,
    }
  }
  const has = (key: ShareKey) => contactValue(profile.contacts, key) !== null
  if (guardianFirst(profile) && has('share_guardian')) return { ...EMPTY, share_guardian: true }
  if (has('share_phone')) return { ...EMPTY, share_phone: true }
  return EMPTY
}

const SELECTION_KEY = (connectionId: string) => `kr.chat.share_selection.${connectionId}`

/** The selection kept while the member adds a missing detail on `SET-CONTACTS` (08 section 3.5). */
export function takeSavedSelection(connectionId: string): ContactShareBody | null {
  try {
    const raw = window.sessionStorage.getItem(SELECTION_KEY(connectionId))
    if (!raw) return null
    window.sessionStorage.removeItem(SELECTION_KEY(connectionId))
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<ContactShareBody>) }
  } catch {
    return null
  }
}

function saveSelection(connectionId: string, selection: ContactShareBody) {
  try {
    window.sessionStorage.setItem(SELECTION_KEY(connectionId), JSON.stringify(selection))
  } catch {
    // Without storage the dialog starts from the defaults again.
  }
}

/**
 * "Share contact details with {name}" (16 section 6.12, 09 section 10): four checkboxes with
 * the member's current values, "Add" for a missing value (opens `SET-CONTACTS`), the guardian
 * preselected when families prefer it, and the fixed warning of 09 section 10.3.
 */
export function ContactShareDialog({
  open,
  onOpenChange,
  connectionId,
  name,
  current,
  initialSelection,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  name: string
  current: ContactShare | null
  /** A selection to restore (after adding a missing detail). */
  initialSelection?: ContactShareBody | null
}) {
  const { t } = useTranslation(['chat', 'common'])
  const profile = useOwnProfile()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent closeLabel={t('common:actions.close')} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t('chat:share.title', { name })}</DialogTitle>
          </DialogHeader>
          {profile.data ? (
            <ShareForm
              profile={profile.data}
              connectionId={connectionId}
              current={current}
              initialSelection={initialSelection ?? null}
              onClose={() => onOpenChange(false)}
            />
          ) : (
            <div className="flex justify-center py-6">
              <Spinner label={t('common:loading')} />
            </div>
          )}
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function ShareForm({
  profile,
  connectionId,
  current,
  initialSelection,
  onClose,
}: {
  profile: OwnProfile
  connectionId: string
  current: ContactShare | null
  initialSelection: ContactShareBody | null
  onClose: () => void
}) {
  const { t } = useTranslation(['chat', 'common'])
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const share = useShareContact()
  const contactValue = useContactValue()
  const [selection, setSelection] = useState<ContactShareBody>(
    () => initialSelection ?? defaultSelection(profile, current, contactValue),
  )
  const [missing, setMissing] = useState<ShareKey | null>(null)
  const anyTicked = Object.values(selection).some(Boolean)

  const addDetail = (key: ShareKey) => {
    const item = SHARE_ITEMS.find((entry) => entry.key === key)
    saveSelection(connectionId, selection)
    void navigate({
      to: '/settings/contacts',
      search: { focus: item?.focus, return_connection_id: connectionId },
    })
  }

  const submit = async () => {
    setMissing(null)
    try {
      await share.mutateAsync({ id: connectionId, body: selection })
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_failed') {
        const field = error.fields.find((entry) => entry.code === 'required')?.field
        const key = SHARE_ITEMS.find((entry) => entry.key === field)?.key
        setMissing(key ?? 'share_phone')
      }
      return
    }
    toast.success(t('chat:connection.my_contact.shared'))
    onClose()
  }

  return (
    <>
      {guardianFirst(profile) ? (
        <p className="text-body-sm text-muted-foreground">{t('chat:share.guardian_hint')}</p>
      ) : null}
      <fieldset className="grid gap-1">
        <legend className="sr-only">{t('chat:share.items_label')}</legend>
        {SHARE_ITEMS.map((item) => {
          const value = contactValue(profile.contacts, item.key)
          const label = t(`chat:connection.item.${item.label}`)
          return (
            <div key={item.key} className="flex flex-wrap items-center gap-x-2">
              <Label variant="option" className="min-w-0 flex-1 items-start py-[11px]">
                <Checkbox
                  checked={selection[item.key]}
                  disabled={value === null}
                  onCheckedChange={(checked) =>
                    setSelection((previous) => ({ ...previous, [item.key]: checked === true }))
                  }
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-body-md">{label}</span>
                  {value ? (
                    <span className="text-caption text-muted-foreground">{value}</span>
                  ) : null}
                </span>
              </Label>
              {value === null ? (
                <Button
                  variant="link"
                  className="px-2"
                  aria-label={t('chat:share.add_named', {
                    item: t(`chat:share.missing.${item.key}`),
                  })}
                  onClick={() => addDetail(item.key)}
                >
                  {t('chat:share.add')}
                </Button>
              ) : null}
            </div>
          )
        })}
      </fieldset>
      <StatusBanner variant="warning">{t('chat:share.warning')}</StatusBanner>
      {missing ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-caption font-semibold text-danger"
        >
          <span>{t('chat:share.add_first', { item: t(`chat:share.missing.${missing}`) })}</span>
          <Button variant="secondary" onClick={() => addDetail(missing)}>
            {t('chat:share.add_now')}
          </Button>
        </div>
      ) : null}
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={share.isPending}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          onClick={() => void submit()}
          loading={share.isPending}
          disabled={!anyTicked || !online}
        >
          {t('chat:share.submit')}
        </Button>
      </DialogFooter>
    </>
  )
}

// GATE-CONSENT (16 section 6.2)
import { ExternalLink } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Label } from '~/components/ui/label'
import { DeleteAccountDialog } from '~/features/settings/DeleteAccountDialog'
import type { ConsentDocument } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'
import { fallbackLabel } from '~/lib/reference'
import { GateLayout, PublicPageLink } from './GateLayout'
import { useAcceptConsents, useGateRefresh } from './queries'

/** The public page of each document a member can be asked to accept again (16 section 6.2). */
const DOCUMENT_PAGES: Partial<
  Record<ConsentDocument, '/terms' | '/privacy' | '/community-guidelines'>
> = {
  terms: '/terms',
  privacy: '/privacy',
  community_guidelines: '/community-guidelines',
}

export function ConsentScreen() {
  const { t } = useTranslation('gate')
  const me = useCurrentMe()
  const online = useOnlineStatus()
  const accept = useAcceptConsents()
  const checkId = useId()
  const [agreed, setAgreed] = useState(false)
  const [disagreeing, setDisagreeing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useGateRefresh()

  const documents = me.consents_required

  return (
    <GateLayout title={t('consent.title')} helpLink={false}>
      <ul aria-label={t('consent.list_label')} className="flex flex-col divide-y divide-border">
        {documents.map((document) => {
          const page = DOCUMENT_PAGES[document]
          const name = page ? t(`consent.documents.${document}`) : fallbackLabel(document)
          return (
            <li key={document} className="flex min-h-11 items-center justify-between gap-3 py-1">
              {page ? (
                <PublicPageLink to={page}>
                  {name}
                  <ExternalLink aria-hidden="true" className="ms-1.5 size-4" />
                </PublicPageLink>
              ) : (
                <span className="font-medium">{name}</span>
              )}
            </li>
          )
        })}
      </ul>

      <div className="flex min-h-11 items-start gap-3">
        <Checkbox
          id={checkId}
          checked={agreed}
          onCheckedChange={(checked) => setAgreed(checked === true)}
          className="mt-0.5"
        />
        <Label htmlFor={checkId} className="text-base font-normal leading-snug">
          {t('consent.agree')}
        </Label>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          disabled={!agreed || !online}
          loading={accept.isPending}
          onClick={() => accept.mutate(documents)}
        >
          {t('consent.accept')}
        </Button>
        <Button variant="outline" onClick={() => setDisagreeing(true)}>
          {t('consent.disagree')}
        </Button>
      </div>

      <AlertDialog open={disagreeing} onOpenChange={setDisagreeing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('consent.disagree_dialog.title')}</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground">
              {t('consent.disagree_dialog.text')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('consent.disagree_dialog.back')}</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setDisagreeing(false)
                setDeleting(true)
              }}
            >
              {t('consent.disagree_dialog.delete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
    </GateLayout>
  )
}

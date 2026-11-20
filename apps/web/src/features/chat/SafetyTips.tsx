import { ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog'

const TIP_KEYS = ['respect', 'money', 'phone', 'report'] as const

/** The "Before you start" tips of 13 section 11.2. */
function TipsList() {
  const { t } = useTranslation('chat')
  return (
    <ul className="list-disc space-y-1 ps-5">
      {TIP_KEYS.map((key) => (
        <li key={key}>{t(`tips.${key}`)}</li>
      ))}
    </ul>
  )
}

type TipsMemory = { connectionId: string; dismissed: boolean }

function storageKey(profileId: string) {
  return `kr.chat.first_tips.${profileId}`
}

function readMemory(profileId: string): TipsMemory | null {
  try {
    const raw = window.localStorage.getItem(storageKey(profileId))
    return raw ? (JSON.parse(raw) as TipsMemory) : null
  } catch {
    return null
  }
}

function writeMemory(profileId: string, memory: TipsMemory) {
  try {
    window.localStorage.setItem(storageKey(profileId), JSON.stringify(memory))
  } catch {
    // Storage may be unavailable (private mode); the card then shows again next time.
  }
}

/**
 * Whether the first-chat tips show in this conversation: only in the first conversation the
 * member ever opens, until dismissed. The dismissal is stored on the device (16 section 6.11).
 */
function useFirstChatTips(profileId: string, connectionId: string) {
  const [visible, setVisible] = useState(() => {
    const memory = readMemory(profileId)
    if (!memory) {
      writeMemory(profileId, { connectionId, dismissed: false })
      return true
    }
    return memory.connectionId === connectionId && !memory.dismissed
  })
  const dismiss = () => {
    writeMemory(profileId, { connectionId, dismissed: true })
    setVisible(false)
  }
  return { visible, dismiss }
}

/** The dismissible card at the top of the first conversation (13 section 11.2). */
export function FirstChatTips({
  profileId,
  connectionId,
}: {
  profileId: string
  connectionId: string
}) {
  const { t } = useTranslation('chat')
  const { visible, dismiss } = useFirstChatTips(profileId, connectionId)
  if (!visible) return null
  return (
    <section
      aria-labelledby="first-chat-tips"
      className="relative mx-auto my-2 w-full max-w-lg rounded-[var(--radius-card)] border border-primary/40 bg-primary-soft p-4 pe-12 text-sm"
    >
      <h2 id="first-chat-tips" className="mb-2 flex items-center gap-2 text-base font-semibold">
        <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
        {t('tips.title')}
      </h2>
      <TipsList />
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1 end-1"
        aria-label={t('tips.dismiss')}
        onClick={dismiss}
      >
        <X aria-hidden="true" />
      </Button>
    </section>
  )
}

/** The same tips, opened from the conversation menu ("Safety tips"). */
export function SafetyTipsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(['chat', 'common'])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common:actions.close')} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('chat:tips.title')}</DialogTitle>
        </DialogHeader>
        <TipsList />
      </DialogContent>
    </Dialog>
  )
}

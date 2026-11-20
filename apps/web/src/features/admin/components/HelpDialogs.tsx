import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { ScrollArea } from '~/components/ui/scroll-area'

type ShortcutGroup = { title: string; items: { keys: string; label: string }[] }

/** The list opened by `?` (18 section 3). */
export function ShortcutHelpDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('admin')
  const groups = t('shortcuts.groups', { returnObjects: true }) as ShortcutGroup[]
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('actions.close')} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pe-3">
          <div className="grid gap-4">
            {groups.map((group) => (
              <section key={group.title} aria-label={group.title}>
                <h3 className="mb-1 text-sm font-semibold">{group.title}</h3>
                <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
                  {group.items.map((item) => (
                    <div key={item.keys} className="contents">
                      <dt>
                        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {item.keys}
                        </kbd>
                      </dt>
                      <dd>{item.label}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button onClick={onClose}>{t('actions.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The ten rules of staff conduct (18 section 10), linked from the console's footer. */
export function ConductDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('admin')
  const rules = t('conduct.rules', { returnObjects: true }) as { title: string; text: string }[]
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('actions.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('conduct.title')}</DialogTitle>
          <DialogDescription>{t('conduct.description')}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pe-3">
          <ol className="grid list-decimal gap-3 ps-5 text-sm">
            {rules.map((rule) => (
              <li key={rule.title}>
                <span className="font-semibold">{rule.title}</span> {rule.text}
              </li>
            ))}
          </ol>
        </ScrollArea>
        <DialogFooter>
          <Button onClick={onClose}>{t('actions.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

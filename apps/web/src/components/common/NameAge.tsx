import { useTranslation } from 'react-i18next'

/** "Ayesha K., 26" (16 section 1.5). The age never starts a line of its own. */
export function NameAge({ name, age }: { name: string; age: number }) {
  const { t } = useTranslation('common')
  return <>{t('common:format.name_age', { name, age }).replace(/,\s(?=\d+$)/, ',\u00A0')}</>
}

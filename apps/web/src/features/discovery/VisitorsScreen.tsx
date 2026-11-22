// APP-VISITORS (16 section 6.14)
import { Link } from '@tanstack/react-router'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '~/components/common/EmptyState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { Page } from '~/components/common/Page'
import { ProfileCard } from '~/components/common/ProfileCard'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { Button } from '~/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import type { Visit } from '~/lib/api-types'
import { formatRelative } from '~/lib/format'
import { useVisited, useVisitors } from './queries'

type Tab = 'viewed_me' | 'i_viewed'

export function VisitorsScreen() {
  return (
    <ScreenAccess screen="APP-VISITORS">
      <VisitorsContent />
    </ScreenAccess>
  )
}

function VisitorsContent() {
  const { t } = useTranslation('discovery')
  const [tab, setTab] = useState<Tab>('viewed_me')

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as Tab)}
      className="min-w-0 flex-1 gap-0"
    >
      <Page
        title={t('visitors.title')}
        width="column"
        header={
          <TabsList aria-label={t('visitors.tabs_label')}>
            <TabsTrigger value="viewed_me">{t('visitors.viewed_me')}</TabsTrigger>
            <TabsTrigger value="i_viewed">{t('visitors.i_viewed')}</TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="viewed_me">
          <ViewedMe />
        </TabsContent>
        <TabsContent value="i_viewed">
          <IViewed />
        </TabsContent>
      </Page>
    </Tabs>
  )
}

function ViewedMe() {
  const { t } = useTranslation('discovery')
  const visitors = useVisitors()
  if (visitors.data?.pages[0]?.hidden_because_private) {
    return (
      <EmptyState
        icon={EyeOff}
        title={t('visitors.private.title')}
        text={t('visitors.private.text')}
        action={
          <Button asChild>
            <Link to="/settings/privacy">{t('visitors.private.action')}</Link>
          </Button>
        }
      />
    )
  }
  return (
    <InfiniteList
      query={visitors}
      getKey={(visit) => visit.profile.id}
      label={t('visitors.viewed_me')}
      renderItem={(visit) => <VisitRow visit={visit} />}
      empty={
        <EmptyState
          icon={Eye}
          title={t('visitors.empty_viewed_me_title')}
          text={t('visitors.empty_viewed_me_text')}
        />
      }
    />
  )
}

function IViewed() {
  const { t } = useTranslation('discovery')
  const visited = useVisited()
  return (
    <InfiniteList
      query={visited}
      getKey={(visit) => visit.profile.id}
      label={t('visitors.i_viewed')}
      renderItem={(visit) => <VisitRow visit={visit} />}
      empty={<EmptyState icon={Eye} title={t('visitors.empty_i_viewed_title')} />}
    />
  )
}

function VisitRow({ visit }: { visit: Visit }) {
  const { t } = useTranslation('discovery')
  return (
    <ProfileCard
      card={visit.profile}
      size="compact"
      actions={
        <p className="text-caption text-muted-foreground tabular-nums">
          {t('visitors.viewed_at', { time: formatRelative(visit.last_viewed_at) })}
          {visit.view_count > 1 ? ` · ${t('visitors.times', { count: visit.view_count })}` : null}
        </p>
      }
    />
  )
}

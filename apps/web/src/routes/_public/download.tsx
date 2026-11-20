import { createFileRoute } from '@tanstack/react-router'
import { DownloadPage } from '~/features/public/DownloadPage'
import { loadAndroidRelease } from '~/features/public/release'
import { pageHead } from '~/features/public/seo'

export const Route = createFileRoute('/_public/download')({
  // Runs on the Worker during server rendering. It never throws: a missing release or a failing
  // API becomes a result that the page explains.
  loader: () => loadAndroidRelease(),
  head: () => pageHead('download'),
  component: DownloadRoute,
})

function DownloadRoute() {
  return <DownloadPage result={Route.useLoaderData()} />
}

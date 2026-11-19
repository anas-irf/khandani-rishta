import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-4xl font-bold">Khandani Rishta</h1>
      <p className="text-gray-600 dark:text-gray-400">Coming soon.</p>
    </main>
  )
}

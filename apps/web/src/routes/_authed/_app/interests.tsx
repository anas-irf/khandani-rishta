import { createFileRoute } from '@tanstack/react-router'
import { InterestsScreen } from '~/features/interests/InterestsScreen'
import { interestsSearchSchema } from '~/features/interests/search'

export const Route = createFileRoute('/_authed/_app/interests')({
  validateSearch: interestsSearchSchema,
  component: InterestsScreen,
})

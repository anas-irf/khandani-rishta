import { setupServer } from 'msw/node'
import { handlers } from './handlers'

/** The mock API for Vitest (started in src/test/setup.ts). */
export const server = setupServer(...handlers)

import type { paths } from '@khandani/api-contract'
import createClient from 'openapi-fetch'

/** Base URL of the API. Set per environment at build time through `VITE_API_BASE_URL`. */
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

/** Typed API client. Request and response types come from `packages/api-contract`. */
export const api = createClient<paths>({ baseUrl: apiBaseUrl })

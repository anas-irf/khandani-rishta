/**
 * The build shown under "About" and added to support emails (16 sections 6.24 and 6.30).
 * `VITE_APP_VERSION` can be set per build; without it the environment name is shown.
 */
const configured = (import.meta.env as Record<string, string | undefined>).VITE_APP_VERSION

export const APP_VERSION: string = configured || `web ${import.meta.env.VITE_APP_ENV ?? 'local'}`

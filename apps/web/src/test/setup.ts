// Adds DOM matchers such as `toBeInTheDocument` to Vitest's `expect`.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Unmount whatever a test rendered, so tests can't affect each other.
afterEach(() => {
  cleanup()
})

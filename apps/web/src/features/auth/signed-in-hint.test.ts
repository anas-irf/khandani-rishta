import { describe, expect, it } from 'vitest'
import { readSignedInHint } from './signed-in-hint'

describe('readSignedInHint', () => {
  it('is true when Clerk recorded a sign-in', () => {
    expect(readSignedInHint('a=1; __client_uat=1763600000; b=2', null)).toBe(true)
    expect(readSignedInHint('__client_uat_AbCd=1763600000', null)).toBe(true)
  })

  it('is false when signed out or without the cookie', () => {
    expect(readSignedInHint('__client_uat=0', null)).toBe(false)
    expect(readSignedInHint('other=1', null)).toBe(false)
    expect(readSignedInHint('', null)).toBe(false)
  })
})

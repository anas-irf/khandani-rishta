/**
 * The SHA-256 of a text as lowercase hex, computed on its UTF-8 bytes (18 section 4.3). The
 * moderator's decision carries the hash of the text that was on screen, so a text that changed
 * after it was read is refused with `409 invalid_state`.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

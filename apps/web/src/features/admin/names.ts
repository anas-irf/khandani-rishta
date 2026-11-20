/** "Ayesha Khan", or the profile code when the profile has no name yet. */
export function fullName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback: string,
): string {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim()
  return name || fallback
}

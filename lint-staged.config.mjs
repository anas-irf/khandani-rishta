// Runs on staged files before each commit (.husky/pre-commit). Fixes what it can and stages
// the result; anything it can't fix stops the commit. CI runs the same checks on every file.
export default {
  // Lint, fix and format JavaScript, TypeScript, JSON and CSS with Biome.
  '*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,json,jsonc,css}':
    'biome check --write --no-errors-on-unmatched --error-on-warnings',

  // Format Rust with rustfmt (skipped with a warning when Rust isn't installed).
  'apps/api/**/*.rs': 'node scripts/hooks/format-rust.mjs',

  // Format Kotlin with ktlint through Spotless (skipped with a warning without a JDK).
  'apps/android/**/*.{kt,kts}': () => 'node scripts/hooks/format-kotlin.mjs',
}

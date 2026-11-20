// Formats the given Rust files with rustfmt. Used by the pre-commit hook (lint-staged).
//
//   node scripts/hooks/format-rust.mjs <file>...
//
// Runs from apps/api so rustup picks the toolchain pinned in rust-toolchain.toml, and rustfmt
// reads apps/api/rustfmt.toml. Without Rust installed it only warns: CI checks formatting too.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const apiDir = fileURLToPath(new URL('../../apps/api/', import.meta.url))
const files = process.argv.slice(2)

if (files.length === 0) process.exit(0)

const probe = spawnSync('rustfmt', ['--version'], { cwd: apiDir, stdio: 'ignore' })
if (probe.error || probe.status !== 0) {
  console.warn('rustfmt not found: skipping Rust formatting. CI still checks it.')
  process.exit(0)
}

const result = spawnSync('rustfmt', files, { cwd: apiDir, stdio: 'inherit' })
process.exit(result.status ?? 1)
